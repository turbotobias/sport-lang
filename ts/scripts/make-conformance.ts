/**
 * Conformance cases, generated from synthetic courses and a seeded field.
 *
 * The corpus started with four cases written by hand, which is the right way to
 * start — a person choosing what must be true is worth more than a machine
 * choosing what happens to be. It is the wrong way to *grow*: hand-written
 * cases only ever cover what somebody thought of, and the whole reason the
 * corpus exists is that a second implementation will diverge somewhere nobody
 * thought of.
 *
 * So these are generated. A course out of `corpus/courses/`, a seeded ghost
 * field, and whatever the rules made of it, recorded as the answer. The
 * expected states are not asserted to be *right*; they are asserted to be what
 * this implementation produces, which is exactly the contract a second
 * implementation has to meet. A case that is wrong is wrong in both, and the
 * hand-written four are what stop that being invisible.
 *
 * The fold never reads a coordinate and neither does the simulator: a log is a
 * function of the places' `along_m`, the dials and the seed. So a case depends
 * on its course only through `drawn_m`, and a course can be synthetic without
 * costing the corpus anything (SPEC.md §2.2 — everything is addressed by
 * `along_m`).
 *
 * Fields are deliberately small. A case with a hundred and fifty runners is not
 * reviewable, and a case nobody can read is a case nobody will fix.
 *
 * ```
 * node ts/scripts/make-courses.ts       # the courses, if they changed
 * node ts/scripts/make-conformance.ts
 * ```
 *
 * @see ts/scripts/make-courses.ts — where the courses come from
 * @see SPEC.md — §5, conforming
 */
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  DocumentRule,
  document_of,
  encode_document,
  fold,
  laps_along,
  mats_along,
  Observation,
  PACKS,
  plan,
  simulate,
  total_ms,
} from '../src/index.ts'
import type {
  TCourseDocument,
  TDocumentRule,
  TFieldConfig,
  TKernelRule,
  TPlaceSpec,
} from '../src/index.ts'
import { course } from '../test/support/courses.ts'
import { render } from './render.ts'

const ROOT = join(import.meta.dirname, '../..')
const OUT = join(ROOT, 'corpus/conformance')

const rule = Schema.decodeUnknownSync(DocumentRule)
const encode_log = Schema.encodeSync(Schema.Array(Observation))
const START = Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-21T18:30:00.000Z')

const BASE: Omit<TFieldConfig, 'start_at'> = {
  seed: 1,
  entrants: 10,
  pace_s_per_km: 330,
  pace_spread: 0.18,
  wave_gap_s: 0,
  wave_size: 1,
  mat_miss: 0.02,
  read_jitter_s: 3,
  dnf: 0.05,
  flags: [],
  quantities: [],
  corral_s: 0,
}

/** Every noise dial at zero: one runner, exactly the pace asked for, every read kept. */
const ALONE: Omit<TFieldConfig, 'start_at' | 'pace_s_per_km'> = {
  ...BASE,
  entrants: 1,
  pace_spread: 0,
  mat_miss: 0,
  read_jitter_s: 0,
  dnf: 0,
}

const hours = (h: number) => Math.round(h * 3_600_000)

const cutoff = (id: string, within_ms: number): TDocumentRule =>
  rule({
    id,
    dialect: 'athletics@1',
    kind: 'cutoff_within',
    ordinal: 0,
    at: null,
    params: { within_ms },
  })

type TShape = {
  readonly name: string
  readonly why: string
  readonly course: string
  readonly dialect: string
  readonly laps: number
  readonly mat_every_m: number
  readonly controls_at: ReadonlyArray<number>
  readonly rules: (drawn_m: number) => ReadonlyArray<TDocumentRule>
  readonly field: Partial<TFieldConfig>
}

const SHAPES: ReadonlyArray<TShape> = [
  {
    name: 'marathon-cutoff-cuts-the-tail',
    why: 'A marathon — 42 044 m of line — with a four-hour cut-off and mats every 5 km. The middle of the field is inside it and the tail is not, which is what a cut-off is for: nine finish inside four hours, two finish outside it and are gated, and one withdraws at 25 km and stays clean — withdrawing is not a standing, and a cut-off it never reached does not gate it.',
    course: 'marathon',
    dialect: 'athletics@1',
    laps: 1,
    mat_every_m: 5_000,
    controls_at: [],
    rules: () => [cutoff('rul_cutoff', hours(4))],
    field: { entrants: 12, seed: 21, pace_s_per_km: 330, pace_spread: 0.22, dnf: 0.08 },
  },
  {
    name: 'station-required-with-dropped-reads',
    why: 'A hilly half — 20 868 m with about 500 m of climb — where a station at 10 km has to be punched, and one read in six is dropped. The rule catches the runner the station simply missed and costs them five minutes, which is the failure mode a timing system actually has.',
    course: 'half-hilly',
    dialect: 'athletics@1',
    laps: 1,
    mat_every_m: 5_000,
    controls_at: [10_000],
    rules: () => [
      rule({
        id: 'rul_station',
        dialect: 'athletics@1',
        kind: 'station_required',
        ordinal: 0,
        at: { point: 'control-10k', along_m: 10_000 },
        params: { penalty_ms: 300_000, each_time: false },
      }),
    ],
    field: { entrants: 12, seed: 7, pace_s_per_km: 300, pace_spread: 0.16, mat_miss: 0.17, dnf: 0 },
  },
  {
    name: 'backyard-five-laps-corralled-hourly',
    why: 'A 6.72 km loop, five times, corralled on the hour. A lap is a place rather than a repetition, so the kernel says this without learning to count. Three run all five inside the hour, four are gated for losing it, one stops before the first lap closes — and nobody is the last one standing: three are still going when the laps run out, so the field aggregate holds for nobody and the award goes unclaimed.',
    course: 'loop-6720',
    dialect: 'backyard@1',
    laps: 5,
    mat_every_m: 0,
    controls_at: [],
    rules: (drawn_m) => [
      ...Array.from({ length: 5 }, (_, i) =>
        rule({
          id: `rul_lap_${i + 1}`,
          dialect: 'backyard@1',
          kind: 'lap_within',
          ordinal: i,
          at: null,
          params: {
            within_ms: hours(1),
            from_m: i * drawn_m,
            to_m: (i + 1) * drawn_m,
            lap: i + 1,
          },
        }),
      ),
      rule({
        id: 'rul_last',
        dialect: 'backyard@1',
        kind: 'last_standing',
        ordinal: 99,
        at: null,
        params: { award: 'last one standing' },
      }),
    ],
    field: {
      entrants: 8,
      seed: 13,
      pace_s_per_km: 500,
      pace_spread: 0.2,
      dnf: 0.12,
      corral_s: 3_600,
      mat_miss: 0,
    },
  },
  {
    name: 'ultra-wide-field-eight-hour-cutoff',
    why: 'A 49.17 km trail loop with 2 100 m of climb, and a spread wide enough that an eight-hour cut-off separates the field rather than passing over it: five finish inside it, seven are gated — five of them out for more than ten hours — and two stop early and stay clean, one by withdrawing and one who is simply never read again. Elapsed time runs to the last read, so a runner who vanishes at 2 h 24 is not over an eight-hour limit.',
    course: 'trail-50k',
    dialect: 'athletics@1',
    laps: 1,
    mat_every_m: 10_000,
    controls_at: [],
    rules: () => [cutoff('rul_cutoff', hours(8))],
    field: { entrants: 14, seed: 3, pace_s_per_km: 620, pace_spread: 0.3, dnf: 0.14 },
  },
  {
    name: 'long-day-millisecond-arithmetic',
    why: 'A 497.37 km ride under a twenty-four-hour cut-off, with mats every 50 km. Here for the arithmetic: the slowest finisher is out for more than twenty-three hours, and a day in milliseconds is a number an implementation can get wrong quietly. The whole field finishes clean.',
    course: 'ride-500k',
    dialect: 'athletics@1',
    laps: 1,
    mat_every_m: 50_000,
    controls_at: [],
    rules: () => [cutoff('rul_cutoff', hours(24))],
    field: { entrants: 8, seed: 5, pace_s_per_km: 140, pace_spread: 0.18, dnf: 0.1 },
  },
  {
    name: 'half-flat-field-inside-cutoff',
    why: 'A flat half — 21 326 m, and every height on the line is zero — under a two-and-a-half-hour cut-off the whole field is inside. A profile of nothing and a rule that fires for nobody are both cases an implementation should not special-case.',
    course: 'half-flat',
    dialect: 'athletics@1',
    laps: 1,
    mat_every_m: 5_000,
    controls_at: [],
    rules: () => [cutoff('rul_cutoff', hours(2.5))],
    field: { entrants: 10, seed: 9, pace_s_per_km: 320, pace_spread: 0.2, dnf: 0.05 },
  },
]

/**
 * The edge of a cut-off, in both engines.
 *
 * `cutoff_within` gates on elapsed *greater than* the limit, so finishing on
 * the limit to the millisecond is inside it. 44 km at 7:30/km is exactly
 * 19 800 000 ms — five and a half hours — and one second a kilometre slower is
 * 44 s over. One ghost each, every noise dial at zero, so the log is two lines
 * and the only thing under test is the comparison.
 */
const EDGE = {
  course: 'road-44k',
  within_ms: hours(5.5),
  cases: [
    {
      name: 'cutoff-edge-exact-pace-finishes',
      why: 'A 44 km course under a five-and-a-half-hour cut-off, and one runner at exactly 7:30/km: 19 800 000 ms, the limit to the millisecond. The gate is elapsed greater than the limit, so arriving on it is inside it and the runner is clean.',
      pace: 450,
    },
    {
      name: 'cutoff-edge-one-second-slower-is-gated',
      why: 'The same document, one second per kilometre slower: 7:31/km is 19 844 000 ms, forty-four seconds over. It has to be the difference between finishing and being gated — otherwise the edge is a rounding, not an edge.',
      pace: 451,
    },
  ],
} as const

/* ── writing a case ──────────────────────────────────────────────────────── */

const write_case = (
  name: string,
  why: string,
  generated: Record<string, unknown>,
  document: TCourseDocument,
  kernel: ReadonlyArray<TKernelRule>,
  config: TFieldConfig,
) => {
  const log = simulate(document, config)
  const states = fold(kernel, log)
  const case_file = {
    name,
    why,
    /* Generated. The expected states are what this implementation produces, which
       is the contract — not a claim that they are independently right. The four
       hand-written cases are what stop that being invisible. */
    generated,
    document: encode_document(document),
    // The wire form: an instant is its ISO string.
    log: encode_log(log),
    expect: states.map((state) => ({
      entrant: state.entrant,
      standing: state.standing,
      total_ms: total_ms(state),
      adjustment_ms: state.adjustment_ms,
      awards: [...state.awards],
      laps: state.laps,
    })),
  }
  writeFileSync(join(OUT, `${name}.json`), render(case_file))
  const tally = ['clean', 'penalised', 'gated', 'disqualified'].map(
    (s) => `${states.filter((x) => x.standing === s).length} ${s}`,
  )
  process.stdout.write(
    `${name.padEnd(40)} ${String(log.length).padStart(4)} obs · ${tally.join(' · ')}\n`,
  )
}

/** Build and plan, or say which step refused and write nothing. */
const built = (
  name: string,
  course_id: string,
  dialect: string,
  laps: number,
  places: (drawn_m: number) => ReadonlyArray<TPlaceSpec>,
  rules: (drawn_m: number) => ReadonlyArray<TDocumentRule>,
) => {
  const from = course(course_id)
  const document = document_of(from, {
    id: `crs_${name}`,
    event: `evt_${name}`,
    way: null,
    name: from.name,
    dialects: [dialect],
    places: places(from.drawn_m),
    rules: rules(from.drawn_m),
    repeat: laps,
    stated_m: null,
  })
  if (Result.isFailure(document)) {
    process.stderr.write(`${name}: did not build\n`)
    process.exitCode = 1
    return null
  }
  const planned = plan(document.success, PACKS)
  if (Result.isFailure(planned)) {
    process.stderr.write(`${name}: will not run — ${JSON.stringify(planned.failure)}\n`)
    process.exitCode = 1
    return null
  }
  return { document: document.success, kernel: planned.success }
}

for (const shape of SHAPES) {
  const ready = built(
    shape.name,
    shape.course,
    shape.dialect,
    shape.laps,
    (drawn_m) =>
      shape.laps > 1
        ? laps_along(drawn_m, shape.laps)
        : mats_along(drawn_m, 1, shape.mat_every_m, shape.controls_at),
    shape.rules,
  )
  if (ready === null) continue
  write_case(
    shape.name,
    shape.why,
    {
      from: `corpus/courses/${shape.course}.json`,
      seed: shape.field.seed ?? BASE.seed,
      entrants: shape.field.entrants ?? BASE.entrants,
    },
    ready.document,
    ready.kernel,
    { ...BASE, start_at: START, ...shape.field },
  )
}

const edge = built(
  'cutoff-edge',
  EDGE.course,
  'athletics@1',
  1,
  // A start and a finish and nothing between: a mat every 44 km places none.
  (drawn_m) => mats_along(drawn_m, 1, drawn_m),
  () => [cutoff('rul_cutoff', EDGE.within_ms)],
)
if (edge !== null) {
  for (const way of EDGE.cases) {
    write_case(
      way.name,
      way.why,
      { from: `corpus/courses/${EDGE.course}.json`, pace_s_per_km: way.pace, entrants: 1 },
      edge.document,
      edge.kernel,
      { ...ALONE, start_at: START, pace_s_per_km: way.pace },
    )
  }
}
