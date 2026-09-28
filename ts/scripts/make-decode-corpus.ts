/**
 * The decode corpus — the half of the specification that is about the *file*.
 *
 * `corpus/conformance/` asserts the fold and only the fold: standing, total,
 * adjustment, awards, laps. Nothing there asserts that two implementations
 * agree about which documents are *documents*. So every law in SPEC.md §2.1 —
 * the per-field group a reader must reject at parse time, and the
 * cross-document group it must refuse to run while still being able to draw —
 * would otherwise be enforced by whichever implementation happens to read the
 * file.
 *
 * ```
 * node ts/scripts/make-decode-corpus.ts
 * ```
 *
 * ## Three verdicts, not two
 *
 * The spec is specific and the split is the interesting part:
 *
 * - **accepts** — decodes and plans.
 * - **rejects** — not a document. Refused at parse, by a per-field law.
 * - **refuses** — a document, and not a runnable one. It **draws**: the
 *   geometry is fine, and a map must still render it while `plan` declines.
 *   This is the verdict nothing tested from the outside, and it is the one a
 *   map depends on, because a map draws first and runs second.
 *
 * ## Why the laws are asserted by name
 *
 * `TBrokenLaw.law` and `BrokenLaw.law` are byte-identical sentences in the two
 * implementations, so a `refuses` case can assert *which* law broke rather than
 * merely that something did — and a refused rule is named with its reason
 * (`unknown dialect`, `unknown kind`, `needs a place`, `parameters do not
 * fit`), byte-identical too. A document that is refused for the wrong reason is
 * a document the two implementations disagree about while appearing to agree.
 *
 * ## And the log
 *
 * A case may carry a `log` beside the document, and `expect.log` says what a
 * reader makes of it with the same three verdicts: `accepts`, `rejects` (an
 * observation that is not one — an instant in any other shape than SPEC.md
 * §2.3's, a member left out) and `refuses` (it decodes and breaks a log law:
 * an id used twice). A log is only judged beside a document that accepts.
 *
 * ## These are mutations of one valid document, on purpose
 *
 * Every case is {@link BASE} with exactly one thing wrong, so the diff between
 * a case and the accepting baseline *is* the law being tested. A corpus of
 * independently hand-written near-documents would test the author's typing.
 *
 * @see SPEC.md §2.1 — the laws
 * @see ts/test/decode.test.ts — the TypeScript runner
 * @see rust/tests/decode.rs — the Rust one
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { render } from './render.ts'

const OUT = join(import.meta.dirname, '../../corpus/decode')

type TJson = { [key: string]: unknown }

const is_object = (value: unknown): value is TJson =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
/** A member that should be an object; a fresh empty one when it is not, so a mutation of it is a no-op. */
const object = (value: unknown): TJson => (is_object(value) ? value : {})
/** A member that should be an array, live, so a push lands in the document. */
const array = (doc: TJson, key: string): Array<unknown> => {
  const value: unknown = doc[key]
  return Array.isArray(value) ? value : []
}

/**
 * The smallest document that accepts: one line, three places, one rule.
 *
 * Four positions rather than five hundred — the laws under test are about
 * shape, and a corpus case nobody can read is a case nobody will fix. The line
 * runs due east from 0.5° N 0.5° E, in open sea, for about 1 000 m, and the
 * path claims exactly 1 000 m — the document owns the length (SPEC.md §2.2) —
 * so a place at 1 001 m is over the end and a place at 1 000 m is not.
 */
const BASE: TJson = {
  type: 'FeatureCollection',
  'sport:version': 1,
  'sport:id': 'crs_decode-base',
  'sport:event': 'evt_decode-base',
  'sport:way': null,
  'sport:name': 'The decode corpus base',
  'sport:dialects': ['athletics@1'],
  'sport:measure': {
    distance_m: 1000,
    distance_method: 'wgs84-geodesic-2d',
    stated_m: 1000,
    certified_m: null,
    ascent_m: 0,
    descent_m: null,
    elevation_source: 'file',
    elevation_smoothing: null,
    ascent_threshold_m: null,
  },
  'sport:provenance': [
    {
      source: 'hand',
      origin_url: null,
      sha256: null,
      format: null,
      verified_by: null,
      verified_at: null,
    },
  ],
  'sport:path': [{ line: 'ln_base', from_m: 0, to_m: 1000, repeat: 1 }],
  'sport:rules': [
    {
      id: 'rul_cutoff',
      dialect: 'athletics@1',
      kind: 'cutoff_within',
      ordinal: 0,
      at: null,
      params: { within_ms: 600_000 },
    },
  ],
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [0.5, 0.5, 0],
          [0.503, 0.5, 0],
          [0.506, 0.5, 0],
          [0.509, 0.5, 0],
        ],
      },
      properties: { role: 'line', id: 'ln_base', polyline: null },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0.5, 0.5, 0] },
      properties: { role: 'point', id: 'start', kind: 'start', name: 'Start', along_m: 0 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0.5045, 0.5, 0] },
      properties: { role: 'point', id: 'mat-500', kind: 'mat', name: '500 m', along_m: 500 },
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [0.509, 0.5, 0] },
      properties: { role: 'point', id: 'finish', kind: 'finish', name: 'Finish', along_m: 1000 },
    },
  ],
}

/** A feature by its id, in a cloned document. */
const feature = (doc: TJson, id: string): TJson =>
  array(doc, 'features')
    .map(object)
    .find((f) => object(f['properties'])['id'] === id) ?? {}

const props = (doc: TJson, id: string): TJson => object(feature(doc, id)['properties'])

/** The document's one path slice. */
const slice = (doc: TJson): TJson => object(array(doc, 'sport:path')[0])

/** A lawful log for {@link BASE}: one runner, start to finish, in both instant shapes. */
const LOG: ReadonlyArray<TJson> = [
  ['obs_1', 'start', 0, 'started', '2027-05-02T07:00:00.000Z'],
  ['obs_2', 'mat-500', 500, 'passed', '2027-05-02T07:02:30Z'],
  ['obs_3', 'finish', 1000, 'finished', '2027-05-02T07:05:00.250Z'],
].map(([id, point, along_m, kind, t]) => ({
  id,
  entrant: 'ent_1',
  at: { point, along_m },
  kind,
  t,
  quantity_name: null,
  quantity_value: null,
  flags: [],
  source: 'transponder',
  device: null,
  confidence: 1,
  supersedes: null,
}))

/** A rule that needs a punch, which only a `control` produces. */
const STATION_RULE = {
  id: 'rul_station',
  dialect: 'athletics@1',
  kind: 'station_required',
  ordinal: 1,
  at: { point: 'mat-500', along_m: 500 },
  params: { penalty_ms: 60_000, each_time: false },
}

/** A rule that would not compile: its id, and the reason in the words both engines use. */
type TRefused = { readonly id: string; readonly why: string }

/** What a reader makes of the log, when the case carries one. */
type TLogExpect =
  | { readonly verdict: 'accepts' }
  | { readonly verdict: 'rejects' }
  | { readonly verdict: 'refuses'; readonly laws: ReadonlyArray<string> }

type TExpect = (
  | { readonly verdict: 'accepts' }
  | { readonly verdict: 'rejects' }
  | {
      readonly verdict: 'refuses'
      /** The law sentences, sorted. Byte-identical in both implementations. */
      readonly laws: ReadonlyArray<string>
      /** Dialects the document names and the reader does not ship. */
      readonly missing_dialects: ReadonlyArray<string>
      /** Every rule that would not compile, sorted by id. */
      readonly refused: ReadonlyArray<TRefused>
      /** The `sport:version` this build does not run, when that is a reason. Absent otherwise. */
      readonly unknown_version?: number
    }
) & { readonly log?: TLogExpect }

type TCase = {
  readonly name: string
  readonly why: string
  readonly expect: TExpect
  readonly mutate: (doc: TJson) => void
  /** A log to judge beside the document, changed from {@link LOG}; absent for a document-only case. */
  readonly log?: (log: Array<TJson>) => void
}

const refuses = (
  laws: ReadonlyArray<string>,
  over: {
    missing_dialects?: ReadonlyArray<string>
    refused?: ReadonlyArray<TRefused>
    unknown_version?: number
  } = {},
): TExpect => ({
  verdict: 'refuses',
  laws: [...laws].sort(),
  missing_dialects: over.missing_dialects ?? [],
  refused: [...(over.refused ?? [])].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  ...(over.unknown_version === undefined ? {} : { unknown_version: over.unknown_version }),
})

/** The base document accepts, and the log gets this verdict. */
const log_gets = (log: TLogExpect): TExpect => ({ verdict: 'accepts', log })

/** The first observation of a cloned log. */
const first = (log: Array<TJson>): TJson => object(log[0])

const CASES: ReadonlyArray<TCase> = [
  /* ── accepts ───────────────────────────────────────────────────────────── */
  {
    name: 'the-base-accepts',
    why: 'Without this, every rejection below could be a rejection of the base rather than of the mutation.',
    expect: { verdict: 'accepts' },
    mutate: () => {},
  },
  {
    name: 'accepts-a-lap-run-three-times',
    why: '§2.1 — `repeat` ≥ 1, and the course is then 3 000 m long: a lap is a place, so a mat at 2 500 m is on the third lap and not past the end.',
    expect: { verdict: 'accepts' },
    mutate: (doc) => {
      slice(doc)['repeat'] = 3
      props(doc, 'finish')['along_m'] = 3000
    },
  },
  {
    name: 'accepts-a-control-that-produces-a-punch',
    why: 'The counterpart to `refuses-a-rule-needing-a-punch-at-a-mat`: the same rule at a `control` is fine, so the law is about the producer table and not about the rule.',
    expect: { verdict: 'accepts' },
    mutate: (doc) => {
      props(doc, 'mat-500')['kind'] = 'control'
      array(doc, 'sport:rules').push(STATION_RULE)
    },
  },

  /* ── rejects: the per-field laws ───────────────────────────────────────── */
  {
    name: 'rejects-a-longitude-past-180',
    why: '§2.1 — longitude ∈ [−180, 180]. A reader that accepts 181 draws the course somewhere that does not exist.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      object(feature(doc, 'ln_base')['geometry'])['coordinates'] = [
        [181, 0.5, 0],
        [0.503, 0.5, 0],
      ]
    },
  },
  {
    name: 'rejects-a-latitude-past-90',
    why: '§2.1 — latitude ∈ [−90, 90].',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      object(feature(doc, 'start')['geometry'])['coordinates'] = [0.5, -91, 0]
    },
  },
  {
    name: 'rejects-a-line-of-one-position',
    why: '§2.1 — a `LineString` has ≥ 2 positions. One position is a point wearing a line’s role, and every distance along it is zero.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      object(feature(doc, 'ln_base')['geometry'])['coordinates'] = [[0.5, 0.5, 0]]
    },
  },
  {
    name: 'rejects-a-line-role-with-a-point-geometry',
    why: '§2.2 — each role is pinned to the geometry it may have. GeoJSON leaves the two loosely coupled, which is right for an interchange format and wrong for a file that decides who finished.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      feature(doc, 'ln_base')['geometry'] = { type: 'Point', coordinates: [0.5, 0.5, 0] }
    },
  },
  {
    name: 'rejects-a-place-at-a-negative-distance',
    why: '§2.1 — every `along_m` is ≥ 0. Nothing on a course is a negative distance from the start, and a reader that accepts one draws a mark before the start line.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      props(doc, 'mat-500')['along_m'] = -5
    },
  },
  {
    name: 'rejects-a-path-slice-starting-before-zero',
    why: '§2.1 — every `from_m` is ≥ 0.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      slice(doc)['from_m'] = -1
    },
  },
  {
    name: 'rejects-a-fractional-version',
    why: '§2.1, §7 — `sport:version` is a whole number from 1. Version 1.5 is not a version of anything, and a reader that ran it as 1 would run a document written against rules it has never seen.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      doc['sport:version'] = 1.5
    },
  },
  {
    name: 'rejects-a-version-of-zero',
    why: '§2.1, §7 — `sport:version` is at least 1. Zero is a number every integer type accepts and no version of this format has.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      doc['sport:version'] = 0
    },
  },
  {
    name: 'rejects-a-slice-run-zero-times',
    why: '§2.1 — `repeat` ≥ 1. A slice run zero times is not part of the way in, and saying so with a number is how a course silently loses a lap.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      slice(doc)['repeat'] = 0
    },
  },

  /* ── refuses: the cross-document laws ──────────────────────────────────── */
  {
    name: 'refuses-two-features-with-one-id',
    why: '§2.1 — no feature id is used twice. A rule naming the id would reach whichever the reader happened to index.',
    expect: refuses(['a feature id is used twice']),
    mutate: (doc) => {
      props(doc, 'mat-500')['id'] = 'finish'
    },
  },
  {
    name: 'refuses-a-segment-ending-before-it-starts',
    why: '§2.1 — a segment’s `to_m` > `from_m`. A backwards segment contains no course.',
    expect: refuses(['a segment ends before it starts']),
    mutate: (doc) => {
      array(doc, 'features').push({
        type: 'Feature',
        geometry: {
          type: 'LineString',
          coordinates: [
            [0.503, 0.5, 0],
            [0.506, 0.5, 0],
          ],
        },
        properties: {
          role: 'segment',
          id: 'seg_backwards',
          kind: 'neutral',
          name: 'Backwards',
          from_m: 800,
          to_m: 200,
        },
      })
    },
  },
  {
    name: 'refuses-a-path-slice-ending-before-it-starts',
    why: '§2.1 — a path slice’s `to_m` > `from_m`. The same law one level up, and the one that decides how long the course is.',
    // Three, not one, and the other two are the interesting part: a slice that
    // ends where it starts makes the course 0 m long, so both the mat and the
    // finish are past the end. The law is listed once per place that broke it,
    // which is a multiplicity the two implementations also have to agree on.
    expect: refuses([
      'a path slice ends before it starts',
      'a place is beyond the end of the course',
      'a place is beyond the end of the course',
    ]),
    mutate: (doc) => {
      slice(doc)['to_m'] = 0
    },
  },
  {
    name: 'refuses-a-path-naming-a-line-that-is-not-here',
    why: '§2.1 — every `sport:path[].line` names a `line` feature present in the document. Otherwise the course has no geometry and the reader cannot say so.',
    // Only the one law: the slice still runs 0 → 1 000, so the course is still
    // 1 000 m long and every place is still on it. The document has lost its
    // geometry and not its length, which is exactly the shape that draws
    // nothing and scores fine.
    expect: refuses(['the path names a line the document does not carry']),
    mutate: (doc) => {
      slice(doc)['line'] = 'ln_somewhere_else'
    },
  },
  {
    name: 'refuses-a-place-past-the-end-of-the-course',
    why: '§2.1 — no place is beyond `path_length`. A rule bound past the end can never fire, and a race scored under it is scored as though the gate were not there.',
    expect: refuses(['a place is beyond the end of the course']),
    mutate: (doc) => {
      props(doc, 'finish')['along_m'] = 1001
    },
  },
  {
    name: 'refuses-a-rule-naming-a-point-that-is-not-here',
    why: '§2.1 — every rule’s `at.point`, when it names one, is present. Otherwise the race is scored as though the gate were not there.',
    expect: refuses(['a rule names a point the document does not carry']),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        ...STATION_RULE,
        at: { point: 'mat-9000', along_m: 500 },
      })
    },
  },
  {
    name: 'refuses-a-document-with-no-line',
    why: '§2.1 — at least one `line` feature. There is nothing to draw and nothing to be along.',
    expect: refuses([
      'the document carries no line',
      'the path names a line the document does not carry',
    ]),
    mutate: (doc) => {
      doc['features'] = array(doc, 'features').filter(
        (f) => object(object(f)['properties'])['role'] !== 'line',
      )
    },
  },
  {
    name: 'refuses-a-rule-needing-a-punch-at-a-mat',
    why: '§2.2, the producer table — a `mat` produces `passed` and never `punched`, so a rule requiring a punch there can never fire. This is the law that is normative and invisible: the document decodes, draws, and quietly scores everybody as having missed the station.',
    expect: refuses(['a rule requires an observation the place never produces']),
    mutate: (doc) => {
      array(doc, 'sport:rules').push(STATION_RULE)
    },
  },
  {
    name: 'refuses-a-dialect-this-build-does-not-ship',
    why: '§3.3 — a document naming a dialect the reader does not have is readable and not runnable. A fold that skipped the rule would report a finisher who was cut.',
    expect: refuses([], {
      missing_dialects: ['nordic@9'],
      refused: [{ id: 'rul_foreign', why: 'unknown dialect' }],
    }),
    mutate: (doc) => {
      array(doc, 'sport:dialects').push('nordic@9')
      array(doc, 'sport:rules').push({
        id: 'rul_foreign',
        dialect: 'nordic@9',
        kind: 'whatever',
        ordinal: 1,
        at: null,
        params: {},
      })
    },
  },
  {
    name: 'refuses-a-version-this-build-does-not-run',
    why: '§3.3, §7 — a well-formed version this build does not run is readable and not runnable, like a dialect it does not ship: the course draws, and `plan` names the version. Running a version 2 document as version 1 is running what it happened to understand.',
    expect: refuses([], { unknown_version: 2 }),
    mutate: (doc) => {
      doc['sport:version'] = 2
    },
  },
  {
    name: 'refuses-a-lap-that-is-not-a-whole-number',
    why: '§3.4 — `lap_within`’s `lap` is a whole number from 1, because it names the lap’s two places, `lap-N-start` and `lap-N-finish`. A lap of 1.5 names places no course has, so its parameters do not fit and the rule is refused rather than run against nothing.',
    expect: refuses([], { refused: [{ id: 'rul_half_a_lap', why: 'parameters do not fit' }] }),
    mutate: (doc) => {
      array(doc, 'sport:dialects').push('backyard@1')
      array(doc, 'sport:rules').push({
        id: 'rul_half_a_lap',
        dialect: 'backyard@1',
        kind: 'lap_within',
        ordinal: 1,
        at: null,
        params: { within_ms: 3_600_000, from_m: 0, to_m: 1000, lap: 1.5 },
      })
    },
  },
  {
    name: 'refuses-a-kind-the-dialect-does-not-define',
    why: 'A dialect is code that ships with the implementation, not data that arrives with the file — so an unknown kind inside a known dialect is refused by name rather than dropped.',
    expect: refuses([], { refused: [{ id: 'rul_invented', why: 'unknown kind' }] }),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_invented',
        dialect: 'athletics@1',
        kind: 'must_wear_a_hat',
        ordinal: 1,
        at: null,
        params: {},
      })
    },
  },
  {
    name: 'refuses-a-station-bound-to-no-place',
    why: '§3.4 — `station_required` means nothing without a place. Bound to `null` it used to be read as the start line, so every runner who punched the real station was penalised for missing it: a rule nobody could satisfy, run. It needs a place, and is refused without one.',
    expect: refuses([], { refused: [{ id: 'rul_station', why: 'needs a place' }] }),
    mutate: (doc) => {
      props(doc, 'mat-500')['kind'] = 'control'
      array(doc, 'sport:rules').push({ ...STATION_RULE, at: null })
    },
  },
  {
    name: 'refuses-a-qualifying-time-bound-to-no-place',
    why: '§3.4 — `qualifies_within` is a finish inside the time, and the finish is the place it is bound to. On a lapped course every lap line produces `finished`, so without a place a runner who stopped after two laps of four qualified. It needs a place, and is refused without one.',
    expect: refuses([], { refused: [{ id: 'rul_sub', why: 'needs a place' }] }),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_sub',
        dialect: 'athletics@1',
        kind: 'qualifies_within',
        ordinal: 1,
        at: null,
        params: { within_ms: 600_000, award: 'sub-10' },
      })
    },
  },
  {
    name: 'accepts-a-qualifying-time-bound-to-the-finish',
    why: 'The counterpart to the two around it: bound to a place that produces `finished`, the rule plans.',
    expect: { verdict: 'accepts' },
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_sub',
        dialect: 'athletics@1',
        kind: 'qualifies_within',
        ordinal: 1,
        at: { point: 'finish', along_m: 1000 },
        params: { within_ms: 600_000, award: 'sub-10' },
      })
    },
  },
  {
    name: 'refuses-a-qualifying-time-bound-to-a-mat',
    why: '§2.2, the producer table — a qualifying time is bound to a finish, and a `mat` produces `passed`, never `finished`. The same law as a punch at a mat, reached through a different kind.',
    expect: refuses(['a rule requires an observation the place never produces']),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_sub',
        dialect: 'athletics@1',
        kind: 'qualifies_within',
        ordinal: 1,
        at: { point: 'mat-500', along_m: 500 },
        params: { within_ms: 600_000, award: 'sub-10' },
      })
    },
  },
  {
    name: 'refuses-a-cutoff-at-an-offset',
    why: '§2.3 — every instant a dialect’s `params` carries is in the one UTC shape. `07:40:00+02:00` is not converted and not read as UTC, so `cutoff_at`’s parameters do not fit.',
    expect: refuses([], { refused: [{ id: 'rul_gate', why: 'parameters do not fit' }] }),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_gate',
        dialect: 'athletics@1',
        kind: 'cutoff_at',
        ordinal: 1,
        at: { point: 'mat-500', along_m: 500 },
        params: { at: '2027-05-02T07:40:00+02:00', says: '07:40' },
      })
    },
  },
  {
    name: 'refuses-parameters-that-are-not-an-object',
    why: '§3.4 — a kind’s `params` are an object, even for a kind that takes none. One reader let `[]` fit an empty set of parameters and the other refused it.',
    expect: refuses([], { refused: [{ id: 'rul_help', why: 'parameters do not fit' }] }),
    mutate: (doc) => {
      array(doc, 'sport:rules').push({
        id: 'rul_help',
        dialect: 'athletics@1',
        kind: 'no_outside_help',
        ordinal: 1,
        at: null,
        params: [],
      })
    },
  },
  {
    name: 'rejects-a-measure-missing-a-member',
    why: '§2.1 — a nullable member is written `null`, never left out. A reader that read a missing `ascent_threshold_m` as null ran a file the other reader rejected.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      Reflect.deleteProperty(object(doc['sport:measure']), 'ascent_threshold_m')
    },
  },
  {
    name: 'rejects-a-line-missing-its-polyline',
    why: '§2.2 — the same law on a feature: `polyline` is `null` when there is none, and present either way.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      Reflect.deleteProperty(props(doc, 'ln_base'), 'polyline')
    },
  },
  {
    name: 'rejects-a-rule-missing-its-place',
    why: '§2.1 — a rule’s `at` is `null` for the whole day, and present either way: a rule with no `at` is not a rule about the whole day, it is a rule somebody did not finish writing.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      Reflect.deleteProperty(object(array(doc, 'sport:rules')[0]), 'at')
    },
  },
  {
    name: 'rejects-a-collection-that-is-not-one',
    why: '§2.1 — a document is a GeoJSON `FeatureCollection`, and says so in `type`.',
    expect: { verdict: 'rejects' },
    mutate: (doc) => {
      doc['type'] = 'Feature'
    },
  },

  /* ── the log ───────────────────────────────────────────────────────────── */
  {
    name: 'accepts-a-log-in-both-instant-shapes',
    why: '§2.3 — an instant with milliseconds and one without are the same shape, and a lawful log beside a lawful document is judged as neither.',
    expect: log_gets({ verdict: 'accepts' }),
    mutate: () => {},
    log: () => {},
  },
  {
    name: 'rejects-a-log-instant-with-an-offset',
    why: '§2.3 — offset always `Z`. `+02:00` was converted by one reader and read as UTC by the other: two hours apart on the same bytes. Neither now: it is not an instant.',
    expect: log_gets({ verdict: 'rejects' }),
    mutate: () => {},
    log: (log) => {
      first(log)['t'] = '2027-05-02T09:00:00+02:00'
    },
  },
  {
    name: 'rejects-a-log-instant-that-is-not-one',
    why: '§2.3 — a reader that read garbage as 1970 ran the log and reported a total of minus fifty-seven years.',
    expect: log_gets({ verdict: 'rejects' }),
    mutate: () => {},
    log: (log) => {
      first(log)['t'] = 'not a time'
    },
  },
  {
    name: 'rejects-a-log-instant-on-a-day-that-does-not-exist',
    why: '§2.3 — the shape alone passes 30 February, and a date parser then rolls it into March or refuses it depending on whose it is.',
    expect: log_gets({ verdict: 'rejects' }),
    mutate: () => {},
    log: (log) => {
      first(log)['t'] = '2027-02-30T07:00:00.000Z'
    },
  },
  {
    name: 'rejects-an-observation-missing-a-member',
    why: '§2.3 — as in the document, a nullable member is written `null` and never left out.',
    expect: log_gets({ verdict: 'rejects' }),
    mutate: () => {},
    log: (log) => {
      Reflect.deleteProperty(first(log), 'device')
    },
  },
  {
    name: 'refuses-a-log-with-an-id-used-twice',
    why: '§2.3 — an id is unique within a log. It is the tie-break and what a `supersedes` names, so two rows sharing one make the result depend on the order they arrived in, and a correction naming it removes both. A reader numbering reads per device, or merging two feeds, produces exactly this.',
    expect: log_gets({ verdict: 'refuses', laws: ['an observation id is used twice'] }),
    mutate: () => {},
    log: (log) => {
      log.push({ ...first(log), t: '2027-05-02T07:00:01.000Z' })
    },
  },
]

mkdirSync(OUT, { recursive: true })
for (const kase of CASES) {
  // A structural clone, so a mutation cannot reach back into BASE.
  const document = structuredClone(BASE)
  kase.mutate(document)
  document['sport:id'] = `crs_${kase.name}`
  document['sport:name'] = kase.name
  const log = kase.log === undefined ? undefined : structuredClone([...LOG])
  if (log !== undefined) kase.log?.(log)
  writeFileSync(
    join(OUT, `${kase.name}.json`),
    render({ name: kase.name, why: kase.why, expect: kase.expect, document, log }),
  )
}

const counted = (verdict: string) => CASES.filter((c) => c.expect.verdict === verdict).length
process.stdout.write(
  `decode corpus: ${CASES.length} cases → ${OUT}\n` +
    `  ${counted('accepts')} accepts · ${counted('rejects')} rejects · ${counted('refuses')} refuses\n`,
)
