/**
 * The course document — one file that is a programmable sporting event.
 *
 * It **is** GeoJSON. A `FeatureCollection` any tool on earth can open and draw,
 * with everything we add under a `pace:` prefix that other tools ignore. The
 * cost of that interoperability is zero and the benefit is that the file is
 * never a dead end: a runner can drop it into any map, and the same bytes carry
 * the rules the race is run under.
 *
 * One document per **way in** — per distance somebody buys — not per event.
 * That is the unit a runner runs, the unit a rule applies to, and the unit a
 * watch loads.
 *
 * ## Everything is addressed by `along_m`
 *
 * Never by coordinate. A course that doubles back has two places at the same
 * latitude and longitude and exactly one at 31 400 m, so a coordinate is
 * ambiguous precisely where a race is most likely to have a timing mat. It is
 * also the address every timing system already uses, and it is what makes a lap
 * a *place* rather than a repetition — which is why `backyard@1` can be said in
 * a kernel that never learned to count.
 *
 * ## A number without its method is not a measurement
 *
 * `pace:measure` carries how it was arrived at, because on a ride of about
 * 500 km a sphere of the mean radius and the WGS84 ellipsoid disagree by more
 * than a kilometre, and the same file's climb varies by a factor of almost four
 * on honest choices of smoothing and threshold alone (SPEC.md §2.4). Three distances are kept,
 * not one: `stated_m` is what the runner is buying and what the organiser advertises,
 * `certified_m` is what a record book uses, and `distance_m` is what a pacing
 * plan is computed from.
 *
 * ## Results are not in here
 *
 * A document rewritten on every position ping would be neither coherent nor
 * fast. Results are the fold's output — see `fold.ts` — and `pace:results` is
 * only ever a snapshot with an `as_of`, materialised for handing to somebody
 * offline and never the source of truth.
 *
 * @see SPEC.md §2
 */
import { DocumentId, LineId, PointId, SegmentId, EventId, WayId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as Option from 'effect/Option'
import * as Record from 'effect/Record'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { decodeResult, decodeUnknownResult } from 'effect/SchemaParser'

import type { TKernelRule } from './kernel.ts'
import { compile, DocumentRule, dialect_of, type TPack, type TRefusal } from './pack.ts'
import { JsonText } from './text.ts'

/* ── stricter than GeoJSON, on purpose ───────────────────────────────────── */

/**
 * A distance along the course, in metres.
 *
 * GeoJSON says nothing about this because it is ours. Nothing on a course is a
 * negative distance from the start, and letting one decode means a rule that
 * can never fire and a mat drawn before the start line.
 *
 * This file is a **profile** of GeoJSON: every document is valid GeoJSON and
 * any tool can draw it, but not every valid GeoJSON is a document. The spec
 * leaves `properties` free and geometry loosely coupled to meaning, which is
 * right for an interchange format and wrong for a file that decides who
 * finished. Where the spec permits and we require, we require — and the
 * requirements are here rather than in a reader's head.
 */
const Along = Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0))

/* ── features ────────────────────────────────────────────────────────────── */

/**
 * `[lon, lat]` or `[lon, lat, ele]`, in that order — GeoJSON's, not ours.
 *
 * The three-place form is tried first, because a union that matched the pair
 * first would silently drop every altitude in the file.
 */
const Longitude = Schema.Finite.check(Schema.isBetween({ minimum: -180, maximum: 180 }))
const Latitude = Schema.Finite.check(Schema.isBetween({ minimum: -90, maximum: 90 }))

export const GeoPosition = Schema.Union([
  Schema.Tuple([Longitude, Latitude, Schema.Finite]),
  Schema.Tuple([Longitude, Latitude]),
])
export type TGeoPosition = typeof GeoPosition.Type

const PointGeometry = Schema.Struct({ type: Schema.Literal('Point'), coordinates: GeoPosition })
const LineGeometry = Schema.Struct({
  type: Schema.Literal('LineString'),
  // A line needs two points. GeoJSON says so; this makes it a decode failure
  // rather than something the drawing code discovers.
  coordinates: Schema.Array(GeoPosition).check(Schema.isMinLength(2)),
})
const AreaGeometry = Schema.Struct({
  type: Schema.Literal('Polygon'),
  coordinates: Schema.Array(Schema.Array(GeoPosition)),
})

/**
 * A feature, typed by the role it plays.
 *
 * Four roles, discriminated on `properties.role`, and each pinned to the
 * geometry it can actually have — a zone is a polygon, a point is a point.
 * Which is worth stating because the obvious way to write this file is
 * `features: Array<unknown>`: GeoJSON's own spec leaves `properties` free, so a
 * schema that mirrors the spec accepts anything and checks nothing.
 *
 * The features are also the **only** copy. An earlier draft carried the points
 * both here and in a `pace:points` array, which is two sources of truth for the
 * same place and exactly the sort of thing that drifts silently: a rule would
 * fire at 31 400 m while the map drew the mat somewhere else. A foreign tool
 * reads these as ordinary GeoJSON and draws them; we read `properties.role` and
 * `properties.along_m` off the same objects.
 */
export const CourseFeature = Schema.Union([
  Schema.Struct({
    type: Schema.Literal('Feature'),
    properties: Schema.Struct({
      role: Schema.Literal('line'),
      id: LineId,
      /** An encoded polyline of the same line, for a client that draws one; null when absent. */
      polyline: Schema.NullOr(Schema.String),
    }),
    geometry: LineGeometry,
  }),
  Schema.Struct({
    type: Schema.Literal('Feature'),
    properties: Schema.Struct({
      role: Schema.Literal('point'),
      id: PointId,
      /** start · finish · mat · aid · gate · summit · hazard · water · turn · corral. */
      kind: Schema.String,
      name: Schema.NullOr(Schema.String),
      /** The address. Never the coordinates — see the note at the top of this file. */
      along_m: Along,
    }),
    geometry: PointGeometry,
  }),
  Schema.Struct({
    type: Schema.Literal('Feature'),
    properties: Schema.Struct({
      role: Schema.Literal('segment'),
      id: SegmentId,
      kind: Schema.String,
      name: Schema.NullOr(Schema.String),
      from_m: Along,
      to_m: Along,
    }),
    geometry: LineGeometry,
  }),
  Schema.Struct({
    type: Schema.Literal('Feature'),
    properties: Schema.Struct({
      role: Schema.Literal('zone'),
      id: SegmentId,
      kind: Schema.String,
      name: Schema.NullOr(Schema.String),
    }),
    geometry: AreaGeometry,
  }),
])
export type TCourseFeature = typeof CourseFeature.Type

/* ── the members beside the features ─────────────────────────────────────── */

/**
 * A lapped or nested course, as a playlist over one stored line.
 *
 * Four laps of a 10.5 km loop is one geometry and four entries, not four
 * copies; the 10 km, the half and the full of one race are three documents over
 * one line.
 */
export const PathEntry = Schema.Struct({
  line: LineId,
  from_m: Along,
  to_m: Along,
  /** At least once. A slice run zero times is not part of the way in. */
  repeat: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
})
export type TPathEntry = typeof PathEntry.Type

export const CourseMeasure = Schema.Struct({
  distance_m: Schema.NullOr(Schema.Finite),
  distance_method: Schema.NullOr(Schema.String),
  /** What the source said. What a runner is buying. */
  stated_m: Schema.NullOr(Schema.Finite),
  /** An AIMS or World Athletics certificate outranks both of the others. */
  certified_m: Schema.NullOr(Schema.Finite),
  ascent_m: Schema.NullOr(Schema.Finite),
  descent_m: Schema.NullOr(Schema.Finite),
  elevation_source: Schema.NullOr(Schema.String),
  elevation_smoothing: Schema.NullOr(Schema.String),
  ascent_threshold_m: Schema.NullOr(Schema.Finite),
})
export type TCourseMeasure = typeof CourseMeasure.Type

/** Every original this document was made from, in order, with where it came from. */
export const Provenance = Schema.Struct({
  source: Schema.String,
  origin_url: Schema.NullOr(Schema.String),
  sha256: Schema.NullOr(Schema.String),
  format: Schema.NullOr(Schema.String),
  verified_by: Schema.NullOr(Schema.String),
  verified_at: Schema.NullOr(Schema.String),
})
export type TProvenance = typeof Provenance.Type

/* ── the document ────────────────────────────────────────────────────────── */

/**
 * The format version this build runs. SPEC.md §7.
 *
 * Decoding and running are separate questions. Any positive whole number is a
 * version (a per-field law — `1.5`, `0` and `-1` are not documents); only this
 * one is a version this build can *run*. A document of any other version is
 * readable but not runnable, exactly like one naming a dialect this build does
 * not ship: it draws, and {@link plan} refuses it by name.
 */
export const FORMAT_VERSION = 1

/** A format version: a whole number, at least 1. */
export const FormatVersion = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)).annotate({
  description:
    'The format version, a whole number from 1. This specification is version 1 (SPEC.md §7).',
})

export const CourseDocument = Schema.Struct({
  type: Schema.Literal('FeatureCollection'),
  'pace-geojson': FormatVersion,
  'pace:id': DocumentId,
  'pace:event': EventId,
  /**
   * The way in this document is the course *of* — the entry option an entrant
   * signs up for: a distance, a category. Opaque to the fold; null when the
   * event has one.
   */
  'pace:way': Schema.NullOr(WayId),
  'pace:name': Schema.String,
  /** Which dialects the rules are written in — `["backyard@1"]`. */
  'pace:dialects': Schema.Array(Schema.String),
  'pace:measure': CourseMeasure,
  'pace:provenance': Schema.Array(Provenance),
  'pace:path': Schema.Array(PathEntry),
  'pace:rules': Schema.Array(DocumentRule),
  /**
   * The course itself: the line, and every place, stretch and zone on it.
   *
   * Ordinary GeoJSON, so anything can open and draw this file; `properties.role`
   * is what makes each one mean something to us. There is no second copy of any
   * of it — see {@link CourseFeature}.
   */
  features: Schema.Array(CourseFeature),
})
export type TCourseDocument = typeof CourseDocument.Type

/**
 * A document from **its text**: SPEC.md §4.2's `parse_document`.
 *
 * The whole of what makes a file a document: it is JSON, it keeps the laws of
 * the text (`text.ts` — no member named twice, no half of a surrogate pair),
 * and its members keep the per-field laws. This is the call for a file.
 */
export const parse_document = decodeResult(JsonText.pipe(Schema.decodeTo(CourseDocument)))

/**
 * A document from a value some JSON parser already made: the per-field laws,
 * and **not** the text's.
 *
 * A value cannot show that its text named a member twice — the parser kept one
 * and the other is gone — so nothing here can check it. For a host that only
 * ever has the value: an editor's own state, a row from a database that
 * stores JSON. A host that has the file hands {@link parse_document} the text.
 */
export const decode_document = decodeUnknownResult(CourseDocument)
export const encode_document = Schema.encodeSync(CourseDocument)

/* ── what a place produces ───────────────────────────────────────────────── */

/**
 * The observation kind a place of this `kind` yields when somebody reaches it.
 *
 * A point's `kind` is descriptive to the fold — no rule names a kind, they name
 * places — and **operational to producers**: a simulator, a timing bridge and a
 * map all have to agree on what a `control` is for, or a rule requiring a punch
 * sits at a place that only ever emits `passed` and can never fire.
 *
 * It lives here rather than in the simulator because that failure has now
 * happened three times: once in the hand-written corpus, once on the first
 * run with a generated field, and once again generating cases. Twice is a
 * mistake; three times is a missing law.
 */
const PRODUCES: Record.ReadonlyRecord<string, string> = {
  start: 'started',
  corral: 'passed',
  mat: 'passed',
  lap: 'finished',
  finish: 'finished',
  control: 'punched',
  aid: 'passed',
  gate: 'passed',
  check: 'checked',
  transition_in: 'entered',
  transition_out: 'left',
  zone_in: 'entered',
  zone_out: 'left',
}

/**
 * An own-property lookup, never an index: `kind` is whatever the file says, and
 * indexing an object literal with `"constructor"`, `"toString"` or `"__proto__"`
 * answers with a member of `Object.prototype` — a function, not an observation
 * kind — where every other reader answers `passed`.
 */
export const produces = (kind: string): string =>
  Option.getOrElse(Record.get(PRODUCES, kind), () => 'passed')

/* ── laws a field check cannot see ───────────────────────────────────────── */

/** A document that decoded but does not hold together. */
export type TBrokenLaw = {
  readonly law:
    | 'a rule requires an observation the place never produces'
    | 'a feature id is used twice'
    | 'a segment ends before it starts'
    | 'a path slice ends before it starts'
    | 'the path names a line the document does not carry'
    | 'a place is beyond the end of the course'
    | 'a rule names a point the document does not carry'
    | 'the document carries no line'
  readonly what: string
}

/**
 * Everything true of a document that a per-field check cannot express.
 *
 * These are all *cross-references*, and each one is a way for a file to decode
 * cleanly and still be wrong in a manner that surfaces as a wrong result rather
 * than an error: a rule pointing at a mat that is not in the document never
 * fires, and a race is scored as though the gate did not exist.
 *
 * Separate from decoding on purpose. A document that breaks a law is still
 * *drawable* — the geometry is fine — and the split lets a map render it while
 * {@link plan} refuses to run it.
 */
export const broken_laws = (document: TCourseDocument): ReadonlyArray<TBrokenLaw> => {
  const broken: Array<TBrokenLaw> = []
  const ids = document.features.map((f) => f.properties.id)
  for (const id of Arr.dedupe(ids)) {
    if (ids.filter((other) => other === id).length > 1)
      broken.push({ law: 'a feature id is used twice', what: id })
  }

  const lines = document.features
    .filter((f) => f.properties.role === 'line')
    .map((f) => f.properties.id)
  if (lines.length === 0)
    broken.push({ law: 'the document carries no line', what: document['pace:name'] })

  for (const entry of document['pace:path']) {
    if (entry.to_m <= entry.from_m)
      broken.push({ law: 'a path slice ends before it starts', what: entry.line })
    if (!lines.includes(entry.line))
      broken.push({ law: 'the path names a line the document does not carry', what: entry.line })
  }

  for (const segment of segments_of(document)) {
    if (segment.to_m <= segment.from_m)
      broken.push({ law: 'a segment ends before it starts', what: segment.id })
  }

  // Beyond the end of the way in is beyond where anybody can be observed, so a
  // rule bound there is a rule that cannot fire.
  const length = path_length_m(document)
  const points = points_of(document)
  for (const point of points) {
    if (point.along_m > length)
      broken.push({ law: 'a place is beyond the end of the course', what: point.id })
  }

  const named = points.map((p) => p.id)
  for (const rule of document['pace:rules']) {
    const at = rule.at
    if (at !== null && 'along_m' in at && at.point !== null && !named.includes(at.point)) {
      broken.push({
        law: 'a rule names a point the document does not carry',
        what: `${rule.id} → ${at.point}`,
      })
    }
  }
  return broken
}

/**
 * The law that needs the compiled rules, so it cannot live with the others.
 *
 * A rule asking for a `punched` at a place that only ever emits `passed` can
 * never fire, and every check above passes it: the point exists, the id is
 * unique, the distance is in range. It is only wrong once you know what the
 * place is *for*, which is {@link produces} — and it has now bitten three
 * times, most recently as twelve of twelve runners penalised for missing a
 * station nobody could ever have punched.
 */
export const mismatched_kinds = (
  document: TCourseDocument,
  rules: ReadonlyArray<TKernelRule>,
): ReadonlyArray<TBrokenLaw> => {
  const places = points_of(document)
  const broken: Array<TBrokenLaw> = []
  for (const rule of rules) {
    for (const clause of rule.when.clauses) {
      if (clause.atom._tag !== 'observed') continue
      const point = clause.atom.at.point
      if (point === null) continue
      const place = places.find((p) => p.id === point)
      if (place === undefined) continue
      const yields = produces(place.kind)
      if (yields !== clause.atom.kind) {
        broken.push({
          law: 'a rule requires an observation the place never produces',
          what: `${rule.id} wants ${clause.atom.kind} at ${point}, a ${place.kind} which produces ${yields}`,
        })
      }
    }
  }
  return broken
}

/* ── can it be run? ──────────────────────────────────────────────────────── */

/** Why a document that draws cannot also be run. */
export type TNotRunnable = {
  /** The document's `pace-geojson` when this build does not run it, else null. */
  readonly unknown_version: number | null
  readonly missing_dialects: ReadonlyArray<string>
  readonly refused: ReadonlyArray<TRefusal>
  readonly broken: ReadonlyArray<TBrokenLaw>
}

/**
 * The rules this document runs under, or the reason it cannot be run.
 *
 * Two outcomes and no third, because the third — *run what you understood* — is
 * how a timing system disqualifies the wrong person. A caller that only wants
 * to **draw** the course never calls this; the geometry is always readable.
 */
export const plan = (
  document: TCourseDocument,
  packs: ReadonlyArray<TPack>,
): Result.Result<ReadonlyArray<TKernelRule>, TNotRunnable> => {
  const version = document['pace-geojson']
  const unknown_version = version === FORMAT_VERSION ? null : version
  const shipped = packs.map(dialect_of)
  const missing_dialects = document['pace:dialects'].filter((d) => !shipped.includes(d))
  const { rules, refused } = compile(packs, document['pace:rules'])
  const broken = [...broken_laws(document), ...mismatched_kinds(document, rules)]
  return unknown_version !== null ||
    missing_dialects.length > 0 ||
    refused.length > 0 ||
    broken.length > 0
    ? Result.fail({ unknown_version, missing_dialects, refused, broken })
    : Result.succeed(rules)
}

/**
 * Every place on the course, in the order the file lists them.
 *
 * The geometry is narrowed alongside the role rather than trusted to follow
 * from it — the union is discriminated on `properties.role` and TypeScript will
 * not carry that across to `geometry`, so a `lon` read off a `LineString`'s
 * coordinates would be an array where a number was wanted.
 */
export const points_of = (document: TCourseDocument) =>
  Arr.getSomes(
    document.features.map((f) =>
      f.properties.role === 'point' && f.geometry.type === 'Point'
        ? Option.some({
            ...f.properties,
            lon: f.geometry.coordinates[0],
            lat: f.geometry.coordinates[1],
          })
        : Option.none(),
    ),
  )

/** Every stretch with something true of it. */
export const segments_of = (document: TCourseDocument) =>
  Arr.getSomes(
    document.features.map((f) =>
      f.properties.role === 'segment' ? Option.some(f.properties) : Option.none(),
    ),
  )

/** A named point's address, for building rules and for reading a result. */
export const point_at = (document: TCourseDocument, id: string): number | null =>
  points_of(document).find((p) => p.id === id)?.along_m ?? null

/** How long the way in is, following the playlist. `pace:path` is the truth, not the line. */
export const path_length_m = (document: TCourseDocument): number =>
  Arr.reduce(
    document['pace:path'],
    0,
    (total, entry) => total + (entry.to_m - entry.from_m) * entry.repeat,
  )
