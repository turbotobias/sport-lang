/**
 * How long a fold takes, as the field grows.
 *
 * ```
 * node --expose-gc ts/scripts/bench.ts                 # 1 000, 10 000 and 30 000 entrants, median of 3
 * node --expose-gc ts/scripts/bench.ts 1000,10000 5    # other sizes, five runs each
 * ```
 *
 * To compare with an older engine, run this same file from a copy of that
 * engine's tree (`git archive <rev> | tar -x -C <dir>`, its core built with
 * the same command) under the same Node.
 *
 * One road race on the synthetic marathon (`corpus/courses/marathon.json`):
 * a mat every 5 km, a control at 20 km, and the five `athletics@1` kinds, over
 * a field simulated with seed 7. Each size runs in a process of its own, so
 * no size inherits the heap of the one before, and is timed four ways; every
 * timing starts from the JSON a host would receive:
 *
 * - **ts run**: `run(PACKS, document, log)` over the parsed JSON — decode
 *   both, plan, check the log, fold, encode every state (SPEC.md §4).
 * - **wasm run**: `run(document_json, log_json)` from `wasm/pkg-node`, answer
 *   parsed: the same work in the Rust engine, in the same shape. Skipped when the core has not been built (`wasm-pack build wasm
 *   --target nodejs --out-dir pkg-node --release`).
 * - **ts fold_until** and **ts positions_at**, at the median finisher's
 *   instant: the replay, from the decoded log.
 *
 * Next to each time is a digest of the answer — the first 12 hex digits of a
 * SHA-256 over its JSON — so a faster engine that answers differently is
 * visible in the same table, and the TypeScript and WebAssembly columns can be
 * checked against each other.
 *
 * @see SPEC.md §3.1
 */
import * as DateTime from 'effect/DateTime'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'

import {
  CourseFile,
  document_of,
  encode_document,
  fold_until,
  mats_along,
  Observation,
  PACKS,
  place,
  plan,
  positions_at,
  ROAD,
  RuleId,
  run,
  simulate,
  total_ms,
} from '../src/index.ts'
import type { TDocumentRule, TEntrantState } from '../src/index.ts'

const ROOT = join(import.meta.dirname, '../..')
const CORE = join(ROOT, 'wasm/pkg-node/sport_lang_wasm.js')

const sizes = (process.argv[2] ?? '1000,10000,30000').split(',').map(Number)
const runs = Number(process.argv[3] ?? '3')
/** Set on the child that measures one size; the parent only prints the header. */
const one_row = process.argv[4] === '--row'

const instant = Schema.decodeSync(Schema.DateTimeUtcFromString)
const encode_log = Schema.encodeSync(Schema.Array(Observation))

type TCore = { readonly run: (document_json: string, log_json: string) => string }

const load_core = (): TCore | null => {
  if (!existsSync(CORE)) return null
  const loaded: unknown = createRequire(import.meta.url)(CORE)
  if (typeof loaded !== 'object' || loaded === null || !('run' in loaded)) return null
  const bound = loaded.run
  return typeof bound === 'function'
    ? { run: (d, l) => String(Reflect.apply(bound, loaded, [d, l])) }
    : null
}

const digest = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12)

/** The replay's answer, digested: what the corpus asserts on. */
const outcomes = (states: ReadonlyArray<TEntrantState>) =>
  states.map((state) => ({
    entrant: state.entrant,
    standing: state.standing,
    total_ms: total_ms(state),
    adjustment_ms: state.adjustment_ms,
    awards: state.awards,
    laps: state.laps,
  }))

/** One call's wall time, after a full collection when `--expose-gc` allows one. */
const once = (work: () => unknown): { readonly ms: number; readonly answer: unknown } => {
  globalThis.gc?.()
  const began = performance.now()
  const answer = work()
  return { ms: performance.now() - began, answer }
}

/**
 * Median wall time of `runs` calls, and the digest of the last answer.
 *
 * The first call warms the JIT and grows the WebAssembly memory, so it is not
 * counted — unless it took two seconds or more, when there is nothing left for
 * a warm-up to hide and a quadratic engine would otherwise pay for it twice.
 */
const time = (work: () => unknown): { readonly ms: number; readonly digest: string } => {
  const first = once(work)
  const taken: Array<number> = first.ms >= 2_000 ? [first.ms] : []
  let answer = first.answer
  while (taken.length < runs) {
    const next = once(work)
    taken.push(next.ms)
    answer = next.answer
  }
  const sorted = taken.toSorted((a, b) => a - b)
  return { ms: sorted[Math.floor(sorted.length / 2)] ?? 0, digest: digest(answer) }
}

const course = Schema.decodeUnknownSync(CourseFile)(
  JSON.parse(readFileSync(join(ROOT, 'corpus/courses/marathon.json'), 'utf8')),
)
const START = '2027-06-20T06:00:00.000Z'
const rules: ReadonlyArray<TDocumentRule> = [
  {
    id: RuleId.make('rul_gate'),
    dialect: 'athletics@1',
    kind: 'cutoff_at',
    ordinal: 0,
    at: place('control-20k', 20_000),
    params: { at: '2027-06-20T08:45:00.000Z', says: '08:45' },
  },
  {
    id: RuleId.make('rul_station'),
    dialect: 'athletics@1',
    kind: 'station_required',
    ordinal: 1,
    at: place('control-20k', 20_000),
    params: { penalty_ms: 120_000, each_time: false },
  },
  {
    id: RuleId.make('rul_help'),
    dialect: 'athletics@1',
    kind: 'no_outside_help',
    ordinal: 2,
    at: null,
    params: {},
  },
  {
    id: RuleId.make('rul_within'),
    dialect: 'athletics@1',
    kind: 'cutoff_within',
    ordinal: 3,
    at: null,
    params: { within_ms: 6 * 3_600_000 },
  },
  {
    id: RuleId.make('rul_sub4'),
    dialect: 'athletics@1',
    kind: 'qualifies_within',
    ordinal: 4,
    at: place('finish', course.drawn_m),
    params: { within_ms: 4 * 3_600_000, award: 'sub-4' },
  },
]
const built = document_of(course, {
  id: 'crs_bench',
  event: 'evt_bench',
  way: null,
  name: course.name,
  dialects: ['athletics@1'],
  places: mats_along(course.drawn_m, 1, 5_000, [20_000]),
  rules,
  repeat: 1,
  stated_m: null,
})
if (Result.isFailure(built)) {
  process.stderr.write(`the bench document did not build: ${JSON.stringify(built.failure)}\n`)
  process.exit(1)
}
const document = built.success
const document_json = JSON.stringify(encode_document(document))
const core = load_core()

const measure = (entrants: number) => {
  const log = simulate(document, {
    ...ROAD,
    start_at: instant(START),
    entrants,
    seed: 7,
    flags: [{ name: 'outside_help', chance: 0.001 }],
  })
  const log_json = JSON.stringify(encode_log(log))

  const ts = time(() => {
    const answer = run(PACKS, JSON.parse(document_json), JSON.parse(log_json))
    return answer.kind === 'ran' ? answer.states : answer
  })
  const wasm =
    core === null
      ? null
      : time(() => {
          const answer: unknown = JSON.parse(core.run(document_json, log_json))
          return typeof answer === 'object' && answer !== null && 'states' in answer
            ? answer.states
            : answer
        })

  const planned = plan(document, PACKS)
  if (Result.isFailure(planned)) {
    process.stderr.write(`the bench document will not run: ${JSON.stringify(planned.failure)}\n`)
    process.exit(1)
  }
  const finishes = log
    .filter((o) => o.kind === 'finished')
    .map((o) => o.t)
    .toSorted((a, b) => DateTime.toEpochMillis(a) - DateTime.toEpochMillis(b))
  const middle = finishes[Math.floor(finishes.length / 2)] ?? instant(START)
  const until = time(() => outcomes(fold_until(planned.success, log, middle)))
  const where = time(() => positions_at(log, middle))

  const cell = (t: { readonly ms: number; readonly digest: string } | null) =>
    t === null ? 'no core' : `${(t.ms / 1000).toFixed(3)} s \`${t.digest}\``
  process.stdout.write(
    `| ${entrants} | ${log.length} | ${cell(ts)} | ${cell(wasm)} | ${cell(until)} | ${cell(where)} |\n`,
  )
}

if (one_row) {
  for (const entrants of sizes) measure(entrants)
} else {
  process.stdout.write(
    `| entrants | observations | ts run | wasm run | ts fold_until | ts positions_at |\n` +
      `| ---: | ---: | ---: | ---: | ---: | ---: |\n`,
  )
  for (const entrants of sizes) {
    const child = spawnSync(
      process.execPath,
      [...process.execArgv, import.meta.filename, String(entrants), String(runs), '--row'],
      { stdio: 'inherit' },
    )
    if (child.status !== 0) process.exit(child.status ?? 1)
  }
}
