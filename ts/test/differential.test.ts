/**
 * Two implementations, folding the same races, on fields nobody wrote down.
 *
 * The conformance corpus is cases somebody chose. This is the other half:
 * a sweep over the synthetic courses, seeds and dials, every one folded by the
 * TypeScript and by the Rust core compiled to WebAssembly, and the answers
 * compared. A corpus case is a disagreement somebody thought of; a swept field
 * is a disagreement nobody did.
 *
 * Compared on the whole answer each engine's `run` gives — every entrant's
 * state as SPEC.md §4 encodes it, the instants, the sentences of every rule
 * that fired — and, for documents and logs that must not run, on the verdict
 * and the structured reason. Not on internals: that would compare two
 * codebases rather than two answers, and the answers are what a race is.
 *
 * **Skipped when the Rust core has not been built.** `pkg-node/` is build
 * output and is not committed, so a fresh checkout has one engine and this
 * says so rather than failing. Build it with:
 *
 * ```
 * wasm-pack build wasm --target nodejs --out-dir pkg-node --release
 * ```
 *
 * @see wasm/src/lib.rs
 * @see SPEC.md — §5, conforming
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

import {
  document_of,
  encode_document,
  encode_log,
  laps_along,
  mats_along,
  PACKS,
  place,
  plan,
  ROAD,
  RuleId,
  run,
  simulate,
} from '../src/index.ts'
import type { TDocumentRule, TFieldConfig } from '../src/index.ts'
import { course } from './support/courses.ts'

const CORE = join(import.meta.dirname, '../../wasm/pkg-node/sport_lang_wasm.js')

type TCore = { readonly run: (document_json: string, log_json: string) => string }

const load_core = (): TCore | null => {
  if (!existsSync(CORE)) return null
  const loaded: unknown = createRequire(import.meta.url)(CORE)
  // Shaped rather than asserted: the module is built by a separate toolchain
  // and a checkout with a stale `pkg-node` should say so here, not later.
  return typeof loaded === 'object' &&
    loaded !== null &&
    'run' in loaded &&
    typeof loaded.run === 'function'
    ? { run: loaded.run as TCore['run'] }
    : null
}

const core: TCore | null = load_core()

/**
 * Whether a missing core is a skip or a failure.
 *
 * The skip below is right on a laptop that has never run wasm-pack: one engine
 * is a fact about the toolchain, not a broken build. It was **wrong
 * everywhere else.** CI never built the wasm, so this file passed having
 * compared nothing, on every run, for ever — the only check that would catch a
 * Rust divergence on a field nobody thought of, dark in the one place it would
 * have mattered.
 *
 * So the environment says which it is. CI sets this after building the core;
 * a checkout does not, and keeps the skip.
 */
const REQUIRE_CORE = process.env['SPORT_LANG_REQUIRE_CORE'] === '1'

const START = Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-21T18:30:00.000Z')

/** What either engine's `run` answers, read as data: the shape both promise. */
const Answer = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal('ran'),
    states: Schema.Array(Schema.Record(Schema.String, Schema.Unknown)),
  }),
  Schema.Struct({ kind: Schema.Literal('refused'), why: Schema.Unknown }),
  Schema.Struct({
    kind: Schema.Literal('malformed'),
    why: Schema.String,
    broken: Schema.Array(Schema.Unknown),
  }),
])
const read_answer = Schema.decodeUnknownResult(Answer)
const Json = Schema.Record(Schema.String, Schema.Unknown)

/** Both engines on the same bytes: the Rust's answer and the TypeScript's, as JSON values. */
const both = (core: TCore, document: unknown, log: unknown) => ({
  rust: read_answer(JSON.parse(core.run(JSON.stringify(document), JSON.stringify(log)))),
  ts: read_answer(JSON.parse(JSON.stringify(run(PACKS, document, log)))),
})

/** Every member of every entrant's state that differs, named. */
const differences_in = (
  label: string,
  ours: ReadonlyArray<Readonly<Record<string, unknown>>>,
  theirs: ReadonlyArray<Readonly<Record<string, unknown>>>,
): ReadonlyArray<string> => {
  if (ours.length !== theirs.length)
    return [`${label}: ${ours.length} states, rust ${theirs.length}`]
  return ours.flatMap((mine, i) => {
    const other = theirs[i] ?? {}
    const keys = [...Object.keys(mine), ...Object.keys(other)].filter(
      (key, at, all) => all.indexOf(key) === at,
    )
    return keys.flatMap((key) => {
      const a = JSON.stringify(mine[key])
      const b = JSON.stringify(other[key])
      return a === b ? [] : [`${label} ${String(mine['entrant'])} ${key}: ts=${a} rs=${b}`]
    })
  })
}

/**
 * The sweep.
 *
 * Chosen to cross the parts of the kernel the dialects actually reach: a road
 * race under a cut-off, a station, a qualifying time, an official's flag and a
 * measured limit; a lapped course with a corral and a field aggregate; a
 * course with no climb, and the longest ride in the corpus for the arithmetic
 * of a day measured in tens of millions of milliseconds. Every course is run
 * both ways — once as a road race, once as laps.
 */
const COURSES_UNDER_TEST = [
  'marathon',
  'loop-6720',
  'half-hilly',
  'half-flat',
  'ride-500k',
  'trail-50k',
] as const

const DIALS: ReadonlyArray<Partial<TFieldConfig>> = [
  { pace_s_per_km: 330, pace_spread: 0.18, mat_miss: 0.02, dnf: 0.05 },
  { pace_s_per_km: 620, pace_spread: 0.34, mat_miss: 0.12, dnf: 0.2 },
  { pace_s_per_km: 200, pace_spread: 0.05, mat_miss: 0, dnf: 0 },
  // Every read dropped: the field exists but nothing was ever seen of it, which
  // is where dormancy and "a measurement nobody took" both bite.
  { pace_s_per_km: 400, pace_spread: 0.2, mat_miss: 1, dnf: 0 },
]

const race = (course_id: string, as_laps: boolean, seed: number, dials: Partial<TFieldConfig>) => {
  const from = course(course_id)
  const repeat = as_laps ? 4 : 1
  const built = document_of(from, {
    id: `crs_${course_id}`,
    event: `evt_${course_id}`,
    way: null,
    name: from.name,
    dialects: as_laps ? ['backyard@1'] : ['athletics@1', 'triathlon@1'],
    places: as_laps
      ? laps_along(from.drawn_m, repeat)
      : mats_along(from.drawn_m, 1, 10_000, [10_000]),
    rules: as_laps
      ? [
          ...Array.from({ length: repeat }, (_, i): TDocumentRule => ({
            id: RuleId.make(`rul_lap_${i + 1}`),
            dialect: 'backyard@1',
            kind: 'lap_within',
            ordinal: i,
            at: null,
            params: {
              within_ms: 3_600_000,
              from_m: i * from.drawn_m,
              to_m: (i + 1) * from.drawn_m,
              lap: i + 1,
            },
          })),
          {
            id: RuleId.make('rul_last'),
            dialect: 'backyard@1',
            kind: 'last_standing',
            ordinal: 99,
            at: null,
            params: { award: 'last one standing' },
          },
        ]
      : [
          {
            id: RuleId.make('rul_cutoff'),
            dialect: 'athletics@1',
            kind: 'cutoff_within',
            ordinal: 0,
            at: null,
            params: { within_ms: 4 * 3_600_000 },
          },
          {
            id: RuleId.make('rul_station'),
            dialect: 'athletics@1',
            kind: 'station_required',
            ordinal: 1,
            at: place('control-10k', 10_000),
            params: { penalty_ms: 300_000, each_time: false },
          },
          // Bound to the finish: a runner who stops inside the time is where
          // "a finish" and "elapsed" part.
          {
            id: RuleId.make('rul_sub'),
            dialect: 'athletics@1',
            kind: 'qualifies_within',
            ordinal: 2,
            at: place('finish', from.drawn_m),
            params: { within_ms: 3.5 * 3_600_000, award: 'sub-3:30' },
          },
          {
            id: RuleId.make('rul_help'),
            dialect: 'athletics@1',
            kind: 'no_outside_help',
            ordinal: 3,
            at: null,
            params: {},
          },
          {
            id: RuleId.make('rul_wetsuit'),
            dialect: 'triathlon@1',
            kind: 'wetsuit_limit',
            ordinal: 4,
            at: null,
            params: { max_c: 22 },
          },
        ],
    repeat,
    stated_m: null,
  })
  if (Result.isFailure(built)) return null
  const planned = plan(built.success, PACKS)
  if (Result.isFailure(planned)) return null

  const config: TFieldConfig = {
    ...ROAD,
    start_at: START,
    entrants: 25,
    seed,
    read_jitter_s: 4,
    corral_s: as_laps ? 3_600 : 0,
    // Flags and a measurement, so the kinds that read them are compared too:
    // an official's flag, a wetsuit, and water either side of the limit.
    flags: [
      { name: 'outside_help', chance: 0.002 },
      { name: 'wetsuit', chance: 0.05 },
    ],
    quantities: [{ name: 'water_c', mean: 22, spread: 2 }],
    ...dials,
  }
  const log = simulate(built.success, config)
  return { document: encode_document(built.success), log: encode_log(log) }
}

// The sweep folds 1 100 entrant states twice; on a loaded machine that is
// seconds, not the 5 s vitest allows by default.
describe('two engines, one language', { timeout: 120_000 }, () => {
  it('has a Rust core to compare against', () => {
    if (core === null) {
      // Not a failure on a checkout that has never run wasm-pack — one engine
      // is a fact about the toolchain. It *is* a failure wherever the
      // environment says a core was built.
      assert.isFalse(
        REQUIRE_CORE,
        'SPORT_LANG_REQUIRE_CORE=1 and there is no core — the wasm build did not produce ' +
          'wasm/pkg-node/. This test comparing nothing is how two engines drift.',
      )
      assert.isNull(core, 'the Rust core is not built — see the file header')
      return
    }
    assert.isFunction(core.run)
  })

  it.skipIf(core === null)('agrees on every swept field, to the millisecond', () => {
    if (core === null) return
    let swept = 0
    let compared = 0
    const differences: Array<string> = []
    // What the sweep reached, so a dial change that stopped a kind firing
    // fails here instead of comparing two engines on a rule that never ran.
    const reached: Array<string> = []

    for (const course_id of COURSES_UNDER_TEST) {
      for (const as_laps of [false, true]) {
        for (const [i, dials] of DIALS.entries()) {
          const ran = race(course_id, as_laps, 100 + i, dials)
          if (ran === null) continue
          swept += 1
          const label = `${course_id} ${as_laps ? 'laps' : 'road'} #${i}`
          const { rust, ts } = both(core, ran.document, ran.log)
          if (Result.isFailure(rust) || Result.isFailure(ts)) {
            differences.push(`${label}: an answer is not the promised shape`)
            continue
          }
          if (rust.success.kind !== 'ran' || ts.success.kind !== 'ran') {
            differences.push(`${label}: ts ${ts.success.kind}, rust ${rust.success.kind}`)
            continue
          }
          compared += ts.success.states.length
          for (const state of ts.success.states)
            reached.push(
              String(state['standing']),
              ...Schema.decodeUnknownSync(Schema.Array(Schema.String))(state['awards']),
            )
          differences.push(...differences_in(label, ts.success.states, rust.success.states))
        }
      }
    }

    assert.isAbove(swept, 20, 'the sweep swept nothing')
    assert.isAbove(compared, 500, 'the sweep compared too little to mean anything')
    // Not `last one standing`: four laps end with several still going, so the
    // swept fields never crown anybody. The corpus's backyard cases do.
    for (const outcome of ['penalised', 'gated', 'disqualified', 'sub-3:30'])
      assert.include(reached, outcome, `the sweep never reached ${outcome}`)
    // Any difference here is a conformance case waiting to be written, and the
    // message is the case.
    assert.deepStrictEqual(
      differences.slice(0, 8),
      [],
      `${differences.length} disagreements over ${compared} states`,
    )
  })

  /**
   * The file, not the fold: the same verdict on documents and logs that must
   * not run. Each case is one lawful document and log with one thing taken
   * away or bent — every member of every object left out in turn, and the
   * instants the two engines once read differently. A document one engine
   * rejected and the other ran was two engines disagreeing about what a
   * document is, and the decode corpus only held the cases somebody wrote.
   */
  it.skipIf(core === null)('agrees on which files are not documents or not logs', () => {
    if (core === null) return
    const kase = Schema.decodeUnknownSync(
      Schema.Struct({ document: Json, log: Schema.Array(Json) }),
    )(
      JSON.parse(
        readFileSync(
          join(import.meta.dirname, '../../corpus/conformance/athletics-cutoff-and-station.json'),
          'utf8',
        ),
      ),
    )
    // Every path to an object member, found by walking the JSON itself.
    const paths: Array<ReadonlyArray<string | number>> = []
    const walk = (value: unknown, path: ReadonlyArray<string | number>) => {
      if (Array.isArray(value)) value.forEach((v, i) => walk(v, [...path, i]))
      else if (typeof value === 'object' && value !== null)
        for (const [key, v] of Object.entries(value)) {
          paths.push([...path, key])
          walk(v, [...path, key])
        }
    }
    const files = { document: kase.document, log: kase.log }
    walk(files, [])
    // Not the whole document or the whole log: a host never has half a call.
    const members = paths.filter((path) => path.length > 1)
    const without = (value: unknown, path: ReadonlyArray<string | number>): unknown => {
      const [head, ...rest] = path
      if (head === undefined) return value
      if (Array.isArray(value)) return value.map((v, i) => (i === head ? without(v, rest) : v))
      if (typeof value !== 'object' || value === null) return value
      return Object.fromEntries(
        Object.entries(value).flatMap(([k, v]) =>
          k !== head ? [[k, v]] : rest.length === 0 ? [] : [[k, without(v, rest)]],
        ),
      )
    }
    const Files = Schema.decodeUnknownSync(
      Schema.Struct({ document: Schema.Unknown, log: Schema.Unknown }),
    )
    const bent = (t: string) => ({
      document: kase.document,
      log: kase.log.map((o, i) => (i === 0 ? { ...o, t } : o)),
    })
    const cases = [
      ...members.map((path) => ({
        label: `without ${path.join('.')}`,
        ...Files(without(files, path)),
      })),
      { label: 'an offset', ...bent('2027-05-02T09:00:00+02:00') },
      { label: 'not a time', ...bent('not a time') },
      { label: 'a day that does not exist', ...bent('2027-02-30T07:00:00Z') },
      { label: 'no milliseconds', ...bent('2027-05-02T07:00:00Z') },
      { label: 'an id used twice', document: kase.document, log: [...kase.log, kase.log[0]] },
    ]
    const disagreements: Array<string> = []
    const verdicts: Array<string> = []
    for (const { label, document, log } of cases) {
      const { rust, ts } = both(core, document, log)
      if (Result.isFailure(rust) || Result.isFailure(ts)) {
        disagreements.push(`${label}: an answer is not the promised shape`)
        continue
      }
      verdicts.push(ts.success.kind)
      const same =
        ts.success.kind === rust.success.kind &&
        (ts.success.kind === 'malformed' && rust.success.kind === 'malformed'
          ? JSON.stringify(ts.success.broken) === JSON.stringify(rust.success.broken)
          : JSON.stringify(ts.success) === JSON.stringify(rust.success))
      if (!same)
        disagreements.push(
          `${label}: ts ${JSON.stringify(ts.success).slice(0, 160)} · rust ${JSON.stringify(rust.success).slice(0, 160)}`,
        )
    }
    assert.isAbove(cases.length, 100, 'the sweep over members found too few to mean anything')
    for (const verdict of ['ran', 'refused', 'malformed']) assert.include(verdicts, verdict)
    assert.deepStrictEqual(
      disagreements,
      [],
      `${disagreements.length} of ${cases.length} files judged differently`,
    )
  })
})
