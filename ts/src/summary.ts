/**
 * A course at a glance — how long it is, how much it climbs, its heights from
 * the start to the finish, what is underfoot, and where its places are — read
 * from the document and from nothing else.
 *
 * A list row, a map's preview, a share card, a watch face: everything that
 * shows a course in miniature asks the same few questions of it, and each
 * answering them its own way is how two apps come to show one course two ways.
 * This is the one answer, over the one file, for any reader that holds it.
 *
 * ## Where a vertex falls
 *
 * A line has no spacing guarantee (SPEC.md §2.2), so each vertex's distance is
 * measured from the geometry — horizontally, on the WGS84 ellipsoid
 * (`geodesic.ts`) — and laid on the document's own metres. The document owns
 * how long the course is; the geometry, only where inside that length each
 * vertex falls. So a line that the path runs whole — every slice of it from its
 * start to one same end, once or as laps — is stretched or shrunk so that its
 * measured length is that end: a thinned line that cuts corners still reaches
 * the finish. A line the path runs only part of says nothing of where its own
 * end is in the document's metres, and is read in its measured metres, as far
 * as it goes.
 *
 * ## What it does not invent
 *
 * - **The climb** is `pace:measure`'s, or null. The same file's climb varies
 *   by a factor of almost four on honest choices of smoothing and threshold
 *   (§2.4); the writer made them, and said which.
 * - **Heights** only where every position of the line the path runs carries
 *   one. A line with some heights and not others is a line nobody surveyed.
 * - **Ground** only where the `surface:` segments cover the course, in order,
 *   with no gap and no overlap — the writer's promise, which a reader that
 *   finds it broken reads as saying nothing about the ground (§2.2). A
 *   material not in the family is `unknown`; `:inferred` is dropped, because
 *   a summary draws the ground and does not argue it.
 *
 * Pure: a document in, a summary out, the same on every runtime.
 */
import * as Schema from 'effect/Schema'

import { path_length_m, points_of, segments_of, type TCourseDocument } from './document.ts'
import { alongs_m } from './geodesic.ts'
import { PointId } from './ids.ts'

/** The `surface:` family (SPEC.md §2.2): what is underfoot, never the kind of way. */
export const Material = Schema.Literals([
  'paved',
  'cobbles',
  'gravel',
  'trail',
  'sand',
  'track',
  'water',
  'unknown',
])
export type TMaterial = typeof Material.Type

/** One place on the course, by its address. */
export const SummaryPlace = Schema.Struct({
  id: PointId,
  /** `start`, `finish`, `aid`, `gate`, … — open, as the document's own. */
  kind: Schema.String,
  name: Schema.NullOr(Schema.String),
  along_m: Schema.Finite,
})
export type TSummaryPlace = typeof SummaryPlace.Type

/** A course at a glance. */
export const DocumentSummary = Schema.Struct({
  /** `path_length`: the course's length as far as any rule is concerned (§2.1). */
  length_m: Schema.Finite,
  /** What the entrant bought, as `pace:measure` says it; null when unsaid. */
  stated_m: Schema.NullOr(Schema.Finite),
  /** The climb and the descent as `pace:measure` says them, by the writer's method; null when unsaid. */
  ascent_m: Schema.NullOr(Schema.Finite),
  descent_m: Schema.NullOr(Schema.Finite),
  /**
   * Heights, metres as the positions carry them, at even steps from the start
   * (the first) to the finish (the last), to a tenth of a metre. Empty when
   * the line carries no heights.
   */
  heights: Schema.Array(Schema.Finite),
  /** `[from_m, to_m, material]` in order, neighbours of one material joined. Empty when the ground is not said. */
  ground: Schema.Array(Schema.Tuple([Schema.Finite, Schema.Finite, Material])),
  /** Every place, nearest the start first. */
  places: Schema.Array(SummaryPlace),
})
export type TDocumentSummary = typeof DocumentSummary.Type

/** How many heights a summary has unless asked for another number. */
export const SUMMARY_HEIGHTS = 48

/** What a cover may be out by at a join, for a writer that rounded: half a metre. */
const JOIN_M = 0.5

const is_material = Schema.is(Material)

/** `surface:gravel:inferred` → `gravel`; a material outside the family → `unknown`. */
const material_of = (kind: string): TMaterial => {
  const said = kind.split(':')[1]
  return is_material(said) ? said : 'unknown'
}

/** A line as the summary reads it: its positions' heights, and each position's metres along it. */
type TLaidLine = {
  readonly id: string
  readonly heights: ReadonlyArray<number> | null
  readonly along: ReadonlyArray<number>
}

/**
 * Each line's positions laid on the document's metres: measured, then
 * stretched to the one end every slice of it runs to, when there is one.
 */
const laid_lines = (document: TCourseDocument): ReadonlyArray<TLaidLine> => {
  const laid: Array<TLaidLine> = []
  for (const feature of document.features) {
    if (feature.properties.role !== 'line' || feature.geometry.type !== 'LineString') continue
    const positions = feature.geometry.coordinates
    const measured = alongs_m(positions)
    const total = measured[measured.length - 1] ?? 0
    const slices = document['pace:path'].filter((slice) => slice.line === feature.properties.id)
    const end = slices[0]?.to_m
    const whole =
      end !== undefined &&
      total > 0 &&
      slices.every((slice) => slice.from_m <= JOIN_M && Math.abs(slice.to_m - end) <= JOIN_M)
    const scale = whole ? end / total : 1
    const heights = positions.every((position) => position.length === 3)
      ? positions.map((position) => position[2] ?? 0)
      : null
    laid.push({ id: feature.properties.id, heights, along: measured.map((m) => m * scale) })
  }
  return laid
}

/** The height at `m` metres along a laid line: between its two nearest positions. */
const height_on = (
  line: TLaidLine & { readonly heights: ReadonlyArray<number> },
  m: number,
): number => {
  const { along, heights } = line
  const last = along.length - 1
  if (last < 0) return 0
  if (m <= (along[0] ?? 0)) return heights[0] ?? 0
  if (m >= (along[last] ?? 0)) return heights[last] ?? 0
  // The first position at or past `m`, by halving.
  let low = 0
  let high = last
  while (high - low > 1) {
    const middle = (low + high) >> 1
    if ((along[middle] ?? 0) < m) low = middle
    else high = middle
  }
  const a = along[low] ?? 0
  const b = along[high] ?? a
  const share = b - a <= 0 ? 0 : (m - a) / (b - a)
  return (heights[low] ?? 0) + ((heights[high] ?? 0) - (heights[low] ?? 0)) * share
}

/**
 * The heights at `steps` even steps along the path: each step's slice, the
 * lap it is in, and the place on that slice's line. Empty when a line the
 * path runs has no heights, or there is no path to step along.
 */
const heights_of = (
  document: TCourseDocument,
  lines: ReadonlyArray<TLaidLine>,
  steps: number,
): ReadonlyArray<number> => {
  const path = document['pace:path']
  const length = path_length_m(document)
  if (steps < 2 || length <= 0 || path.length === 0) return []
  // Found by id in a list, never looked up in an object: a line called
  // `constructor` is a line like any other (§2.2, the producer table).
  const runs = path.map((slice) => ({ slice, line: lines.find((line) => line.id === slice.line) }))
  const surveyed: Array<{
    readonly from_m: number
    readonly span_m: number
    readonly repeat: number
    readonly line: TLaidLine & { readonly heights: ReadonlyArray<number> }
  }> = []
  for (const { slice, line } of runs) {
    if (line === undefined || line.heights === null) return []
    surveyed.push({
      from_m: slice.from_m,
      span_m: slice.to_m - slice.from_m,
      repeat: slice.repeat,
      line: { ...line, heights: line.heights },
    })
  }
  return Array.from({ length: steps }, (_, step) => {
    let wanted = (length * step) / (steps - 1)
    for (const [index, run] of surveyed.entries()) {
      const run_m = run.span_m * run.repeat
      const final = index === surveyed.length - 1
      if (wanted < run_m || final) {
        // Inside this slice: which lap, and how far into it. The very end of
        // the last slice is its end, not the start of a lap nobody runs.
        const into = final && wanted >= run_m ? run.span_m : wanted % run.span_m
        return Math.round(height_on(run.line, run.from_m + into) * 10) / 10
      }
      wanted -= run_m
    }
    return 0
  })
}

/**
 * The ground, from the `surface:` segments — when they cover the course in
 * order with no gap and no overlap, and otherwise nothing (§2.2).
 */
const ground_of = (document: TCourseDocument): TDocumentSummary['ground'] => {
  const length = path_length_m(document)
  const stretches = segments_of(document)
    .filter((segment) => segment.kind.startsWith('surface:'))
    .toSorted((a, b) => a.from_m - b.from_m)
  if (stretches.length === 0) return []
  let reached = 0
  for (const stretch of stretches) {
    if (Math.abs(stretch.from_m - reached) > JOIN_M) return []
    reached = stretch.to_m
  }
  if (Math.abs(reached - length) > JOIN_M) return []
  const joined: Array<readonly [number, number, TMaterial]> = []
  for (const stretch of stretches) {
    const material = material_of(stretch.kind)
    const last = joined[joined.length - 1]
    if (last !== undefined && last[2] === material)
      joined[joined.length - 1] = [last[0], stretch.to_m, material]
    else joined.push([stretch.from_m, stretch.to_m, material])
  }
  return joined
}

/** A course at a glance, from its document: `steps` heights unless said otherwise. */
export const summary_of = (
  document: TCourseDocument,
  steps: number = SUMMARY_HEIGHTS,
): TDocumentSummary => {
  const measure = document['pace:measure']
  return {
    length_m: path_length_m(document),
    stated_m: measure.stated_m,
    ascent_m: measure.ascent_m,
    descent_m: measure.descent_m,
    heights: heights_of(document, laid_lines(document), steps),
    ground: ground_of(document),
    places: points_of(document)
      .map(({ id, kind, name, along_m }) => ({ id, kind, name, along_m }))
      .toSorted((a, b) => a.along_m - b.along_m),
  }
}
