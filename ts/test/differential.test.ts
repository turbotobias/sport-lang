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

const CORE = join(import.meta.dirname, '../../wasm/pkg-node/pace_geojson_wasm.js')

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
const REQUIRE_CORE = process.env['PACE_GEOJSON_REQUIRE_CORE'] === '1'

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

/**
 * Both engines on the same bytes: the Rust's answer and the TypeScript's, as
 * JSON values. Each is handed the two files as text — the same two strings —
 * so what is compared is each engine's reading of a file, its parser included.
 */
const both_on = (core: TCore, document_json: string, log_json: string) => ({
  rust: read_answer(JSON.parse(core.run(document_json, log_json))),
  ts: read_answer(JSON.parse(JSON.stringify(run(PACKS, document_json, log_json)))),
})
const both = (core: TCore, document: unknown, log: unknown) =>
  both_on(core, JSON.stringify(document), JSON.stringify(log))

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

/**
 * The worked example (`examples/10k/`) as the text a host is handed, for the
 * tests that change one thing in a file and ask both engines what they read.
 */
const EXAMPLE = join(import.meta.dirname, '../../examples/10k')
const example = (file: string) =>
  JSON.stringify(JSON.parse(readFileSync(join(EXAMPLE, file), 'utf8')))

/** `text` with its first `was` replaced, and a failure if it has none. */
const with_ = (text: string, was: string, now: string): string => {
  assert.include(text, was, 'the example changed under this test')
  return text.replace(was, () => now)
}

/** Both answers, each as the raw JSON its engine wrote. */
const raw_on = (core: TCore, document_json: string, log_json: string) => ({
  ts: JSON.stringify(run(PACKS, document_json, log_json)),
  rust: core.run(document_json, log_json),
})

/** What the example's runner who missed the station was given, as its engine wrote it. */
const penalty = (answer: string) =>
  /"adjustment_ms":([^,]+),"neutralised_ms":0,"laps":1,"punches":0/.exec(answer)?.[1]

/**
 * Either side of where the doubles end. The largest is 2^1024 − 2^971, and a
 * decimal rounds to it until half a step past it — 2^1024 − 2^970, which
 * begins 1.797693134862315807937 — and from there on is no double at all.
 */
const STILL_THE_LARGEST = '1.79769313486231580793e308'
const PAST_THE_LARGEST = '1.79769313486231580794e308'

/**
 * A fixed stream of digits, so a sweep of decimals is the same decimals on
 * every run: a linear congruential step, read from its high bits.
 */
const digits_from = (seed: number) => {
  let state = seed >>> 0
  return (lowest: number): string => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return String(lowest + Math.floor((state / 4294967296) * (10 - lowest)))
  }
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
        'PACE_GEOJSON_REQUIRE_CORE=1 and there is no core — the wasm build did not produce ' +
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

  /**
   * The text, not the value: what a file may not do before any member of it
   * is read (SPEC.md §2). The same lawful document and log, written out with
   * every member of every object named twice in turn, and with every string
   * a member holds cut to half a surrogate pair. A value cannot carry either
   * — no JSON writer will write them — which is why the sweep above, built
   * from values, could never reach them, and why for as long as it could not
   * one engine kept the last of two members and the other refused the file.
   */
  it.skipIf(core === null)('agrees on a text that breaks a law of the text', () => {
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
    type TPath = ReadonlyArray<string | number>
    type TMember = { readonly file: 'document' | 'log'; readonly path: TPath }
    // Every member of every object, in both files, and which of them hold a string.
    const members: Array<TMember> = []
    const strings: Array<TMember> = []
    const walk = (file: TMember['file'], value: unknown, path: TPath) => {
      if (Array.isArray(value)) value.forEach((v, i) => walk(file, v, [...path, i]))
      else if (typeof value === 'object' && value !== null)
        for (const [key, v] of Object.entries(value)) {
          const member = { file, path: [...path, key] }
          members.push(member)
          if (typeof v === 'string') strings.push(member)
          walk(file, v, member.path)
        }
    }
    walk('document', kase.document, [])
    walk('log', kase.log, [])

    /**
     * `value` as JSON text, with the member at `path` written as `bend` says:
     * it is given the member's name and its value, both already as text.
     */
    const text_of = (
      value: unknown,
      path: TPath | null,
      bend: (name: string, value: string) => string,
    ): string => {
      const [head, ...rest] = path ?? []
      if (Array.isArray(value))
        return `[${value.map((v, i) => text_of(v, i === head ? rest : null, bend)).join(',')}]`
      if (typeof value !== 'object' || value === null) return JSON.stringify(value)
      return `{${Object.entries(value)
        .map(([k, v]) => {
          const name = JSON.stringify(k)
          const said = text_of(v, k === head ? rest : null, bend)
          return k === head && rest.length === 0 ? bend(name, said) : `${name}:${said}`
        })
        .join(',')}}`
    }
    const plain = (name: string, value: string) => `${name}:${value}`
    const document_json = text_of(kase.document, null, plain)
    const log_json = text_of(kase.log, null, plain)
    assert.strictEqual(document_json, JSON.stringify(kase.document), 'the writer writes JSON')

    /** The name with its first character as an escape: another spelling of the same name. */
    const escaped = (name: string) =>
      `"\\u${name.charCodeAt(1).toString(16).padStart(4, '0')}${name.slice(2)}`
    const TWICE = 'a member is named twice'
    const HALF = 'a string holds half a surrogate pair'
    const bent = (
      label: string,
      { file, path }: TMember,
      bend: (name: string, value: string) => string,
      law: string,
    ) => ({
      label: `${label} ${file}.${path.join('.')}`,
      file,
      law,
      document: file === 'document' ? text_of(kase.document, path, bend) : document_json,
      log: file === 'log' ? text_of(kase.log, path, bend) : log_json,
    })
    const cases = [
      // Twice with the same value, so the only thing wrong is that there are two.
      ...members.map((member) => bent('twice', member, (n, v) => `${n}:${v},${n}:${v}`, TWICE)),
      // Twice, the second time under an escape: one name, spelled two ways.
      ...members.map((member) =>
        bent('twice, escaped', member, (n, v) => `${n}:${v},${escaped(n)}:${v}`, TWICE),
      ),
      // Every string a member holds, cut to the high half of a pair.
      ...strings.map((member) => bent('half a pair in', member, (n) => `${n}:"\\ud83d"`, HALF)),
    ]

    const disagreements: Array<string> = []
    for (const { label, file, law, document, log } of cases) {
      const { rust, ts } = both_on(core, document, log)
      if (Result.isFailure(rust) || Result.isFailure(ts)) {
        disagreements.push(`${label}: an answer is not the promised shape`)
        continue
      }
      // The same kind, and the same reason: the law's own sentence, which both
      // engines say, where the rest of a malformed `why` is each one's own.
      const reason = `the ${file} did not decode: ${law}: `
      for (const [engine, answer] of [
        ['ts', ts.success],
        ['rust', rust.success],
      ] as const)
        if (answer.kind !== 'malformed' || !answer.why.startsWith(reason))
          disagreements.push(`${label}: ${engine} ${JSON.stringify(answer).slice(0, 160)}`)
    }

    // And the other way about: none of this refuses a lawful text for how it
    // is written. Spaced out, or with every name spelled under an escape, it
    // is the same file and gets the same answer.
    const spelled = (value: unknown): string =>
      Array.isArray(value)
        ? `[${value.map(spelled).join(',')}]`
        : typeof value !== 'object' || value === null
          ? JSON.stringify(value)
          : `{${Object.entries(value)
              .map(([k, v]) => `${escaped(JSON.stringify(k))}:${spelled(v)}`)
              .join(',')}}`
    const lawful = both_on(core, document_json, log_json)
    for (const [label, document, log] of [
      ['spaced out', JSON.stringify(kase.document, null, 2), JSON.stringify(kase.log, null, '\t')],
      ['every name under an escape', spelled(kase.document), spelled(kase.log)],
    ] as const) {
      const { rust, ts } = both_on(core, document, log)
      assert.deepStrictEqual(ts, lawful.ts, `${label}: the reference reads another file`)
      assert.deepStrictEqual(rust, lawful.rust, `${label}: the Rust reads another file`)
    }
    assert.isTrue(Result.isSuccess(lawful.ts) && lawful.ts.success.kind === 'ran', 'it runs')

    assert.isAbove(members.length, 100, 'the sweep over members found too few to mean anything')
    assert.isAbove(strings.length, 40, 'the sweep over strings found too few to mean anything')
    assert.deepStrictEqual(
      disagreements.slice(0, 8),
      [],
      `${disagreements.length} of ${cases.length} texts judged differently`,
    )
    // The counts SPEC.md §5b gives.
    assert.deepStrictEqual([members.length, strings.length, cases.length], [171, 77, 419])
  })

  /**
   * A number is the double nearest to what is written, in both engines.
   *
   * SPEC.md §1 rests on it: a fraction is one IEEE 754 operation and "rounds
   * the same everywhere" only if both engines start from the same double. The
   * Rust's parser once took its quicker path, which reads a neighbour of the
   * nearest double from sixteen significant digits on, and §5a listed that as
   * a difference outside anything a producer writes. It was more than a last
   * digit. A step apart is a different number wherever one is written back —
   * a penalty added to a time — and a different *standing* wherever a
   * measurement is held against its limit: water written a hair over the
   * legal temperature disqualified in one engine and not in the other.
   *
   * The core is built to read a decimal exactly now (`float_roundtrip`, in
   * the workspace `Cargo.toml`), and this is what fails the day that is
   * dropped: with the quicker path, 276 of the 1 800 decimals below came back
   * a step apart, 183 of the 400 temperatures as two standings, and the
   * largest double, written either way, as a file that is not one.
   */
  it.skipIf(core === null)('reads a decimal longer than a double as the same number', () => {
    if (core === null) return
    const document_json = example('document.json')
    const log_json = example('log.json')
    const raw = (document: string, log: string = log_json) => raw_on(core, document, log)
    const Ran = Schema.Struct({
      kind: Schema.Literal('ran'),
      states: Schema.Array(Schema.Struct({ entrant: Schema.String, standing: Schema.String })),
    })
    const read_ran = Schema.decodeUnknownSync(Ran)
    const digit = digits_from(20261004)

    // 1. The decimal §5a gave: 730.6517261421845 to the reference, and once
    //    730.6517261421847 to the Rust. One answer now, byte for byte.
    const once = raw(with_(document_json, '"penalty_ms":120000', '"penalty_ms":730.65172614218456'))
    assert.strictEqual(penalty(once.ts), '730.6517261421845')
    assert.strictEqual(once.rust, once.ts)

    // 2. A sweep through a rule's parameter, which the Rust keeps as generic
    //    JSON until a dialect reads it: thirteen to twenty-one significant
    //    digits, two hundred of each, one to four of them before the point.
    //    The reference's answer is checked to carry the nearest double, so
    //    this is not two engines agreeing on a number neither was given.
    const decimal = (significant: number): string => {
      const all = Array.from({ length: significant }, (_, at) =>
        digit(at === 0 || at === significant - 1 ? 1 : 0),
      ).join('')
      const whole = 1 + (significant % 4)
      return `${all.slice(0, whole)}.${all.slice(whole)}`
    }
    const apart: Array<string> = []
    let swept = 0
    for (const significant of [13, 14, 15, 16, 17, 18, 19, 20, 21]) {
      for (let nth = 0; nth < 200; nth++) {
        const text = decimal(significant)
        const { ts, rust } = raw(
          with_(document_json, '"penalty_ms":120000', `"penalty_ms":${text}`),
        )
        swept++
        if (penalty(ts) !== String(Number(text)))
          apart.push(`${text}: the reference wrote ${penalty(ts)}`)
        if (rust !== ts) apart.push(`${text}: ts=${penalty(ts)} rs=${penalty(rust)}`)
      }
    }
    assert.deepStrictEqual(apart, [], `${apart.length} of ${swept} decimals read differently`)
    assert.strictEqual(swept, 1800)

    // 3. A measurement at its limit, which serde reads straight into a number
    //    — the other of the Rust's two ways in. A wetsuit disqualifies above
    //    22.5 °C. The next double above 22.5 is 22.500000000000004, and water
    //    written between the two is whichever is nearer: past half-way it is
    //    over the limit, and up to half-way — the tie goes to the even one,
    //    which is 22.5 — it is the limit itself, and legal.
    const wetsuit = with_(
      document_json,
      '"dialect":"athletics@1","kind":"no_outside_help","ordinal":2,"at":null,"params":{}',
      '"dialect":"triathlon@1","kind":"wetsuit_limit","ordinal":2,"at":null,"params":{"max_c":22.5}',
    )
    const water = (value: string) =>
      with_(
        log_json,
        '"quantity_name":null,"quantity_value":null,"flags":[]',
        `"quantity_name":"water_c","quantity_value":${value},"flags":["wetsuit"]`,
      )
    /** Both engines on that water; the wearer's standing, once they agree to the byte. */
    const swum_in = (value: string): string | undefined => {
      const { ts, rust } = raw(wetsuit, water(value))
      assert.strictEqual(rust, ts, `water at ${value}`)
      return read_ran(JSON.parse(ts)).states.find((state) => state.entrant === 'ent_ana')?.standing
    }
    const HALF_WAY = '22.5000000000000017763568394002504646778106689453125'
    assert.deepStrictEqual(
      [
        '22.5',
        '22.500000000000001549',
        `${HALF_WAY.slice(0, -1)}4`,
        HALF_WAY,
        `${HALF_WAY.slice(0, -1)}6`,
        '22.500000000000002',
        '22.500000000000004',
      ].map(swum_in),
      ['clean', 'clean', 'clean', 'clean', 'disqualified', 'disqualified', 'disqualified'],
    )
    //    And four hundred temperatures across the half-way point, of two to
    //    five more digits than `22.500000000000001`: both standings, no
    //    disagreement. `swum_in` fails on the first answer that differs.
    const standings = [2, 3, 4, 5].flatMap((more) =>
      Array.from({ length: 100 }, () =>
        swum_in(
          `22.500000000000001${Array.from({ length: more }, (_, at) =>
            digit(at === more - 1 ? 1 : 0),
          ).join('')}`,
        ),
      ),
    )
    const count = (standing: string) => standings.filter((s) => s === standing).length
    assert.strictEqual(count('clean') + count('disqualified'), 400)
    assert.isAbove(count('clean'), 100, 'water under the half-way point')
    assert.isAbove(count('disqualified'), 50, 'water over it')

    // 4. The largest double, written with more digits than it has. The
    //    nearest double is still it, where a quicker reader calls the number
    //    out of range and the file malformed. Read by both, each way in: a
    //    member of the document, and a member the Rust keeps as generic JSON.
    for (const value of ['1.7976931348623158e308', STILL_THE_LARGEST]) {
      const as_member = raw(with_(document_json, '"distance_m":10000', `"distance_m":${value}`))
      assert.strictEqual(read_ran(JSON.parse(as_member.ts)).kind, 'ran', `distance_m ${value}`)
      assert.strictEqual(as_member.rust, as_member.ts, `distance_m ${value}`)
      const as_kept = raw(with_(document_json, '"params":{', `"params":{"x:f":${value},`))
      assert.strictEqual(as_kept.rust, as_kept.ts, `a foreign parameter ${value}`)
      assert.strictEqual(as_kept.ts, raw(document_json).ts, 'a foreign parameter changes nothing')
    }
    //    One digit on there is no double to be nearest to. As a member the
    //    document reads, both call the file malformed; §5a has the rest.
    const past = raw(with_(document_json, '"distance_m":10000', `"distance_m":${PAST_THE_LARGEST}`))
    assert.deepStrictEqual(
      [past.ts, past.rust].map(
        (answer) => Schema.decodeUnknownSync(Json)(JSON.parse(answer))['kind'],
      ),
      ['malformed', 'malformed'],
    )
  })

  /**
   * What SPEC.md §5a says the two engines still read differently, held to it.
   *
   * Each row is the same bytes and two answers, today. None is in the corpus,
   * because none is a file a producer writes: a number no double holds, a
   * member nested a hundred and twenty-eight deep, an id from the last corner
   * of the Basic Multilingual Plane. They are here so that the specification's
   * list is a fact and not a memory: when a row stops differing this fails,
   * and §5a and `docs/known-gaps.md` are what change with it — and beside
   * each difference is the same file one step nearer the ordinary, where the
   * engines agree, so the list says where each one ends.
   */
  it.skipIf(core === null)('differs only where SPEC.md §5a says it does', () => {
    if (core === null) return
    const document_json = example('document.json')
    const log_json = example('log.json')
    const raw = (document: string, log: string = log_json) => raw_on(core, document, log)
    const Brief = Schema.Struct({
      kind: Schema.String,
      why: Schema.optionalKey(Schema.Unknown),
      states: Schema.optionalKey(Schema.Array(Schema.Struct({ entrant: Schema.String }))),
    })
    const Refused = Schema.Struct({ refused: Schema.Array(Schema.Struct({ why: Schema.String })) })
    /** An answer in a line: its kind, and what a refusal or a run says first. */
    const brief = (answer: string): string => {
      const { kind, why, states } = Schema.decodeUnknownSync(Brief)(JSON.parse(answer))
      if (kind === 'refused')
        return `refused: ${Schema.decodeUnknownSync(Refused)(why)
          .refused.map((r) => r.why)
          .join(', ')}`
      return kind === 'ran' ? `ran: ${(states ?? []).map((s) => s.entrant).join(' ')}` : kind
    }
    const both_brief = (document: string, log: string = log_json) => {
      const { ts, rust } = raw(document, log)
      return { ts: brief(ts), rust: brief(rust) }
    }
    const ran = brief(raw(document_json).ts)
    assert.match(ran, /^ran: ent_ana /, 'the example runs')
    const same = { ts: ran, rust: ran }

    // 1. A number too large for a double. Where a member is read as a number
    //    both call the file malformed, and where nothing reads it both step
    //    over it — except in the four members the Rust keeps as generic JSON
    //    until it knows what they are, where its parser has to read the number
    //    to keep it and cannot.
    const foreign = (opening: string, value: string, text: string = document_json) =>
      with_(text, opening, `${opening}"x:f":${value},`)
    const KEPT = ['"at":{', '"params":{', '"geometry":{', '"properties":{']
    const STEPPED_OVER = [
      '{',
      '"pace:measure":{',
      '"pace:path":[{',
      '"pace:rules":[{',
      '"features":[{',
    ]
    for (const opening of KEPT)
      assert.deepStrictEqual(
        both_brief(foreign(opening, '1e999')),
        { ts: ran, rust: 'malformed' },
        `1e999 in a foreign member of ${opening}`,
      )
    for (const opening of STEPPED_OVER)
      assert.deepStrictEqual(both_brief(foreign(opening, '1e999')), same, `1e999 in ${opening}`)
    assert.deepStrictEqual(both_brief(document_json, foreign('[{', '1e999', log_json)), same)
    //    It begins at the same decimal in both: half a step past the largest
    //    double. Anything nearer is the largest double, to both, and is read.
    for (const opening of KEPT) {
      assert.deepStrictEqual(
        both_brief(foreign(opening, PAST_THE_LARGEST)),
        { ts: ran, rust: 'malformed' },
        `the first decimal no double holds, in ${opening}`,
      )
      assert.deepStrictEqual(
        both_brief(foreign(opening, STILL_THE_LARGEST)),
        same,
        `the last decimal a double holds, in ${opening}`,
      )
    }
    //    As a dialect's parameter the reference reads it as a parameter that
    //    does not fit, and refuses the rule; the Rust never gets that far.
    assert.deepStrictEqual(
      both_brief(with_(document_json, '"penalty_ms":120000', '"penalty_ms":1e999')),
      { ts: 'refused: parameters do not fit', rust: 'malformed' },
    )
    //    As any member the document's own schema reads, both: malformed.
    assert.deepStrictEqual(
      both_brief(with_(document_json, '"distance_m":10000', '"distance_m":1e999')),
      { ts: 'malformed', rust: 'malformed' },
    )

    // 2. Nesting. The Rust's parser stops at 128 arrays and objects deep, and
    //    only reaches that depth inside the same four members: anywhere else
    //    it steps over a foreign member without descending. The reference has
    //    no limit. Each of the four is itself the fourth level down — the
    //    document, its list of rules or features, one of them, the member —
    //    so 124 more is 128.
    const nested = (depth: number) => `${'['.repeat(depth)}${']'.repeat(depth)}`
    for (const opening of KEPT) {
      assert.deepStrictEqual(both_brief(foreign(opening, nested(123))), same, `127 in ${opening}`)
      assert.deepStrictEqual(
        both_brief(foreign(opening, nested(124))),
        { ts: ran, rust: 'malformed' },
        `128 deep in ${opening}`,
      )
    }
    for (const opening of STEPPED_OVER)
      assert.deepStrictEqual(both_brief(foreign(opening, nested(500))), same, `deep in ${opening}`)

    // 3. A number past 2^53 − 1, where a double stops holding every whole
    //    number. Both fold the same double and write it differently. Up to
    //    there — 285 000 years of milliseconds — a whole number is written
    //    whole by both, the total it is added into included.
    const past = raw(with_(document_json, '"penalty_ms":120000', '"penalty_ms":9007199254740994'))
    assert.deepStrictEqual(
      [penalty(past.ts), penalty(past.rust)],
      ['9007199254740994', '9007199254740994.0'],
    )
    const within = raw(with_(document_json, '"penalty_ms":120000', '"penalty_ms":9007199244740992'))
    assert.strictEqual(penalty(within.ts), '9007199244740992')
    assert.strictEqual(within.ts, within.rust)

    // 4. The order of two ids. The reference compares UTF-16 code units and
    //    the Rust UTF-8 bytes, which agree unless one id holds a character
    //    from U+E000 to U+FFFF and the other one past U+FFFF. Two starts at
    //    one instant, so the id is all that orders them, and the order of the
    //    states is the order entrants are first seen in.
    const corner = with_(
      with_(log_json, '"id":"obs_01"', '"id":"obs_～"'),
      '"id":"obs_02"',
      '"id":"obs_\u{1f600}"',
    )
    assert.deepStrictEqual(both_brief(document_json, corner), {
      ts: 'ran: ent_cy ent_dee ent_eve ent_ben ent_ana',
      rust: 'ran: ent_cy ent_dee ent_eve ent_ana ent_ben',
    })
    const plane = with_(
      with_(log_json, '"id":"obs_01"', '"id":"obs_～"'),
      '"id":"obs_02"',
      '"id":"obs_é"',
    )
    assert.strictEqual(raw(document_json, plane).ts, raw(document_json, plane).rust)
  })
})
