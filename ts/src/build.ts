/**
 * A course, assembled into a document a race can be run on.
 *
 * The courses in `corpus/courses/` are geometry and nothing else: a
 * line, its heights, and how far along each point is. A document needs places
 * to hang rules off, a path, a measurement with its method, and the provenance
 * of what it was made from. This is the assembly, and it is pure — the same
 * course and the same options give the same document, so two tools cannot
 * produce different files from one GPX.
 *
 * ## A lap is a place
 *
 * Everything else in pace-geojson follows from that, and it is settled here: a
 * course run four times is one line and four sets of places, at one loop, two
 * loops, three and four along. So `at_along` takes a distance past the end of
 * the line and wraps it, which is what makes a backyard ultra expressible in a
 * kernel that never learned to count.
 *
 * @see src/document.ts — what is being built
 * @see corpus/courses — what it is built from
 * @see SPEC.md — §2.2, a line has no spacing guarantee
 */
import { DocumentId, LineId, PointId, SegmentId, EventId, WayId } from './ids.ts'
import * as Schema from 'effect/Schema'

import { decode_document, FORMAT_VERSION } from './document.ts'
import type { TDocumentRule } from './pack.ts'

/** `[lon, lat, ele | null, along_m]` — one vertex, and how far along the line it falls. */
export const CourseVertex = Schema.Tuple([
  Schema.Finite,
  Schema.Finite,
  Schema.NullOr(Schema.Finite),
  Schema.Finite,
])

/** A course line as a course file stores it: vertices with their own `along_m`. */
export type TCourseLine = ReadonlyArray<typeof CourseVertex.Type>

/**
 * A course file, as `corpus/courses/*.json` holds one.
 *
 * `along_m` is carried per vertex because a line has no spacing guarantee
 * (SPEC.md §2.2): vertices cluster on bends and thin out on straights, and a
 * reader that assumed otherwise would put every mat in the wrong place.
 * `drawn_m` is the last vertex's `along_m` — the length of the line as drawn —
 * and `distance_m` the length of whatever it was drawn from, which is longer,
 * because a thinned line cuts corners.
 */
export const CourseFile = Schema.Struct({
  /** The file's own name. Not a row id: nothing outside the corpus refers to it. */
  id: Schema.NonEmptyString,
  name: Schema.String,
  race: Schema.String,
  country: Schema.String,
  discipline: Schema.String,
  /** Where the course came from, when the file says — `synthetic` for a made-up one. Free text. */
  source: Schema.optionalKey(Schema.String),
  /** Where the original lives. `null` when there is no original — a synthetic course. */
  origin_url: Schema.NullOr(Schema.String),
  /** The original's digest. `null` when there is no file to hash. */
  sha256: Schema.NullOr(Schema.String),
  distance_m: Schema.Finite,
  /** How `distance_m` and every `along_m` were measured, when not `wgs84-geodesic-2d`. */
  distance_method: Schema.optionalKey(Schema.String),
  drawn_m: Schema.Finite,
  elevation_gain_m: Schema.NullOr(Schema.Finite),
  points_original: Schema.Finite,
  line: Schema.Array(CourseVertex),
})
export type TCourseFile = typeof CourseFile.Type

/**
 * The coordinate at a distance along the course, wrapping past the end.
 *
 * Linear between the two survey points either side, which is the only
 * defensible answer and is well inside the error of the survey itself at any
 * spacing a course is drawn at.
 */
export const at_along = (
  line: TCourseLine,
  m: number,
): readonly [number, number, number | null] => {
  const last = line[line.length - 1]
  const total = last?.[3] ?? 0
  const first = line[0] ?? ([0, 0, null, 0] as const)
  if (line.length === 0) return [0, 0, null]
  if (total <= 0) return [first[0], first[1], first[2]]
  // Past the end is another lap of the same line.
  const wanted = ((m % total) + total) % total
  let i = 1
  while (i < line.length && (line[i]?.[3] ?? 0) < wanted) i += 1
  const a = line[i - 1] ?? first
  const b = line[i] ?? a
  const span = b[3] - a[3]
  const share = span <= 0 ? 0 : (wanted - a[3]) / span
  return [
    a[0] + (b[0] - a[0]) * share,
    a[1] + (b[1] - a[1]) * share,
    a[2] === null || b[2] === null ? (a[2] ?? b[2]) : a[2] + (b[2] - a[2]) * share,
  ]
}

/**
 * The coordinate at a distance along one pass of the line, **clamped** rather
 * than wrapped: at the line's own length it is the last vertex, not the first.
 * A stretch that ends at the finish ends there; `at_along` would draw it back
 * to the start, which is right for a place on a lap and wrong for a stretch.
 */
const on_line = (line: TCourseLine, m: number): readonly [number, number, number | null] => {
  const last = line[line.length - 1]
  if (last !== undefined && m >= last[3]) return [last[0], last[1], last[2]]
  return at_along(line, Math.max(0, m))
}

const position = (p: readonly [number, number, number | null]): ReadonlyArray<number> =>
  p[2] === null ? [p[0], p[1]] : [p[0], p[1], p[2]]

/**
 * The line between two distances along the path, as a LineString's positions:
 * the interpolated start, every vertex strictly between, the interpolated end.
 *
 * The path here is one line run `laps` times, each pass `lap_m` long, so a
 * stretch that crosses the end of a lap carries on from the line's start, the
 * way a runner does. It is never drawn past the last lap: the ends are clamped
 * to the path. Always at least two positions, so a stretch that ends before it
 * starts still draws and is refused by its law, not by its geometry.
 */
const stretch_along = (
  line: TCourseLine,
  lap_m: number,
  laps: number,
  from_m: number,
  to_m: number,
): ReadonlyArray<ReadonlyArray<number>> => {
  const end = lap_m * laps
  const from = Math.min(Math.max(0, from_m), end)
  const to = Math.min(Math.max(from, to_m), end)
  const lap_of = (m: number): number => Math.min(laps - 1, Math.floor(m / lap_m))
  const at = (m: number) => position(on_line(line, m - lap_of(m) * lap_m))
  const out: Array<ReadonlyArray<number>> = [at(from)]
  for (let lap = lap_of(from); lap <= lap_of(to); lap += 1) {
    for (const vertex of line) {
      const m = lap * lap_m + vertex[3]
      if (m > from && m < to) out.push(position([vertex[0], vertex[1], vertex[2]]))
    }
  }
  out.push(at(to))
  return out
}

/** A place to hang a rule off, before it becomes a feature. */
export type TPlaceSpec = {
  readonly id: string
  readonly kind: string
  readonly name: string | null
  readonly along_m: number
}

/**
 * A stretch of the course with something true of it, before it becomes a
 * feature: what is underfoot, a climb, a closed road. `from_m` and `to_m` are
 * path distances, like a place's `along_m`; past the line's end is the next
 * lap. `kind` is descriptive, and `surface:<material>` is the family SPEC.md
 * §2.2 defines.
 */
export type TSegmentSpec = {
  readonly id: string
  readonly kind: string
  readonly name: string | null
  readonly from_m: number
  readonly to_m: number
}

export type TBuildOptions = {
  readonly id: string
  readonly event: string
  readonly way: string | null
  readonly name: string
  readonly dialects: ReadonlyArray<string>
  readonly places: ReadonlyArray<TPlaceSpec>
  readonly rules: ReadonlyArray<TDocumentRule>
  /** How many times the line is run. Four is a backyard's first four hours. */
  readonly repeat: number
  /** What the organiser says the distance is, when they say one. */
  readonly stated_m: number | null
  /**
   * Where the course came from, when the caller knows.
   *
   * Never inferred from the URL: where a file is hosted says nothing about who
   * drew it. A caller that knows says; then the course file's own `source`;
   * and otherwise `unstated`, which is the truth.
   */
  readonly source?: string | undefined
  /** `gpx` · `kml` · `geojson` · `fit`. Same argument as `source`. */
  readonly format?: string | undefined
  /**
   * Where the heights came from, or **null when there are none**.
   *
   * This was hardcoded to `'file'`, so a course with no altitude at all — an
   * encoded polyline off a map — published `elevation_source: 'file'` beside a
   * null ascent. A source for a measurement that does not exist is worse than
   * silence: it is the difference SPEC.md §2.4 exists to keep straight.
   */
  readonly elevation_source?: string | null | undefined
  /**
   * What the course measures and by what method, when the caller knows better
   * than the line does.
   *
   * The default is the course file's own measurement, which is right for a GPX
   * and wrong for a thinned copy of one: a drawing cuts corners. A
   * caller holding a better survey passes its length and says where it came
   * from — or `null` for both, because a stated distance nobody measured is not
   * a measurement (`pace:measure` keeps the claim in `stated_m`).
   */
  readonly measured?:
    | { readonly distance_m: number | null; readonly method: string | null }
    | undefined
  /** Where the original lives, when the caller knows. `null` when there is no file to point at. */
  readonly origin_url?: string | null | undefined
  /** The original's digest, when the caller knows. `null` when there is no file to hash. */
  readonly sha256?: string | null | undefined
  /**
   * Stretches with something true of them, each drawn as the slice of the line
   * between its ends. Nothing folds them (SPEC.md §2.2): a map colours by
   * them, a profile shades under them. None when the caller has none.
   */
  readonly segments?: ReadonlyArray<TSegmentSpec> | undefined
}

/**
 * Assemble, then **decode** — so a document this produced is one the laws have
 * already passed, and a caller cannot be handed something that draws but will
 * not run.
 */
export const document_of = (course: TCourseFile, options: TBuildOptions) => {
  const line = LineId.make(`ln_${course.id}`)
  const geometry = course.line.map((p) => (p[2] === null ? [p[0], p[1]] : [p[0], p[1], p[2]]))
  const lap_m = Math.max(1, course.drawn_m)
  const laps = Math.max(1, options.repeat)

  const features = [
    {
      type: 'Feature',
      properties: { role: 'line', id: line, polyline: null },
      geometry: { type: 'LineString', coordinates: geometry },
    },
    ...options.places.map((place) => {
      const at = at_along(course.line, place.along_m)
      return {
        type: 'Feature',
        properties: {
          role: 'point',
          id: PointId.make(place.id),
          kind: place.kind,
          name: place.name,
          along_m: place.along_m,
        },
        geometry: {
          type: 'Point',
          coordinates: at[2] === null ? [at[0], at[1]] : [at[0], at[1], at[2]],
        },
      }
    }),
    ...(options.segments ?? []).map((segment) => ({
      type: 'Feature',
      properties: {
        role: 'segment',
        id: SegmentId.make(segment.id),
        kind: segment.kind,
        name: segment.name,
        from_m: segment.from_m,
        to_m: segment.to_m,
      },
      geometry: {
        type: 'LineString',
        coordinates: stretch_along(course.line, lap_m, laps, segment.from_m, segment.to_m),
      },
    })),
  ]

  return decode_document({
    type: 'FeatureCollection',
    'pace-geojson': FORMAT_VERSION,
    'pace:id': DocumentId.make(options.id),
    'pace:event': EventId.make(options.event),
    'pace:way': options.way === null ? null : WayId.make(options.way),
    'pace:name': options.name,
    'pace:dialects': options.dialects,
    'pace:measure': {
      distance_m: options.measured === undefined ? course.distance_m : options.measured.distance_m,
      distance_method:
        options.measured === undefined
          ? (course.distance_method ?? 'wgs84-geodesic-2d')
          : options.measured.method,

      stated_m: options.stated_m,
      certified_m: null,
      ascent_m: course.elevation_gain_m,
      descent_m: null,
      // The file's own heights, not a DEM — said plainly, because the two are
      // not the same claim and the difference is a factor of nearly four. And
      // null when there are no heights, because a source for a measurement
      // that does not exist is worse than silence.
      elevation_source:
        options.elevation_source !== undefined
          ? options.elevation_source
          : course.elevation_gain_m === null
            ? null
            : 'file',
      elevation_smoothing: null,
      ascent_threshold_m: null,
    },
    'pace:provenance': [
      {
        source: options.source ?? course.source ?? 'unstated',
        origin_url: options.origin_url === undefined ? course.origin_url : options.origin_url,
        sha256: options.sha256 === undefined ? course.sha256 : options.sha256,
        // No original, no format: a synthetic course was never a file.
        format:
          options.format ??
          (course.origin_url === null ? null : course.origin_url.endsWith('.fit') ? 'fit' : 'gpx'),
        verified_by: null,
        verified_at: null,
      },
    ],
    'pace:path': [{ line, from_m: 0, to_m: lap_m, repeat: laps }],
    'pace:rules': options.rules,
    features,
  })
}

/**
 * Mats every `every_m`, plus a start and a finish. The shape of a road race.
 *
 * `controls_at` names the ones that are *punched* rather than passed. It is a
 * parameter and not a guess because a rule requiring a punch at a place that
 * only emits `passed` can never fire — a mistake made three times before
 * `mismatched_kinds` was written to catch it, and one a builder should simply
 * not be able to make.
 */
export const mats_along = (
  drawn_m: number,
  repeat: number,
  every_m: number,
  controls_at: ReadonlyArray<number> = [],
): ReadonlyArray<TPlaceSpec> => {
  const total = drawn_m * Math.max(1, repeat)
  const places: Array<TPlaceSpec> = [{ id: 'start', kind: 'start', name: 'Start', along_m: 0 }]
  for (let m = every_m; m < total - every_m / 2; m += every_m) {
    const control = controls_at.some((c) => Math.abs(c - m) < 1)
    places.push({
      id: `${control ? 'control' : 'mat'}-${Math.round(m / 1000)}k`,
      kind: control ? 'control' : 'mat',
      name: `${Math.round(m / 1000)} km`,
      along_m: m,
    })
  }
  places.push({ id: 'finish', kind: 'finish', name: 'Finish', along_m: total })
  return places
}

/** A corral and a mat per lap. The shape of a backyard ultra. */
export const laps_along = (drawn_m: number, laps: number): ReadonlyArray<TPlaceSpec> =>
  Array.from({ length: laps }, (_, i) => [
    { id: `lap-${i + 1}-start`, kind: 'corral', name: `Lap ${i + 1} corral`, along_m: i * drawn_m },
    { id: `lap-${i + 1}-finish`, kind: 'lap', name: `Lap ${i + 1}`, along_m: (i + 1) * drawn_m },
  ]).flat()
