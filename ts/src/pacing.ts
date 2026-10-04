/**
 * Pacing — a course, read as one runner's day at one pace.
 *
 * Two engine queries, and nothing a host computes for itself: every number in a
 * {@link TPlan} is either stated in the document or returned by `fold`. The
 * moment a host computes a number the engine also computes, there are two
 * answers, and the one on screen is the one nobody tested.
 *
 * ## One ghost, not a field
 *
 * {@link plan_at_pace} is `simulate` with every dial at zero — one entrant, no
 * spread, no dropped reads, no jitter, no withdrawals — folded by the same
 * engine that will judge them on the day. A simulated field runs through the
 * same function with the dials up, so a single-runner plan and a field cannot
 * disagree about where a runner is at a time.
 *
 * ## The cut-off question is asked, not calculated
 *
 * *"Will I make it?"* looks like a subtraction: the gate's instant minus the
 * arrival. It is not, and writing it that way would put dialect knowledge in
 * here — `cutoff_at` keeps its instant in `params.at`, `cutoff_within` keeps a
 * duration, and a dialect nobody has written yet will keep something else.
 *
 * {@link slowest_clear_pace} **asks the engine instead**, by bisection: run the
 * ghost slower and slower until the standing stops being clean. The answer is
 * a pace — *"7:12/km or faster finishes this"* — which is both the more useful
 * sentence and the one that needs no dialect at all. It generalises to a rule
 * that has not been invented yet, which a subtraction cannot.
 *
 * @see SPEC.md §3 — the evaluation both queries are made of
 */
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Order from 'effect/Order'

import { points_of, produces, type TCourseDocument } from './document.ts'
import { fold, total_ms, type TEntrantState } from './fold.ts'
import type { TKernelRule, TStanding } from './kernel.ts'
import type { TObservation } from './observe.ts'
import { fold_until } from './replay.ts'
import { simulate, type TFieldConfig } from './simulate.ts'

/* ── one runner's day ────────────────────────────────────────────────────── */

/** A rule, and whether it bit this runner. */
export type TStopRule = {
  readonly id: string
  /** The sentence as a person read it. Never a regenerated paraphrase. */
  readonly sentence: string
  /** Whether the fold applied it. */
  readonly fired: boolean
  /** What it added to the clock, in milliseconds. Zero for a gate. */
  readonly added_ms: number
}

/** One place, and what happens to you there at this pace. */
export type TStop = {
  readonly id: string
  readonly name: string
  readonly kind: string
  readonly along_m: number
  /** From the gun. */
  readonly elapsed_ms: number
  /** The wall clock, which is what a rule with a time is about. */
  readonly at: DateTime.Utc
  /** The rules the document places here, whether or not they fired. */
  readonly rules: ReadonlyArray<TStopRule>
}

/** One reading of a course at one pace — every number in it from the fold. */
export type TPlan = {
  readonly pace_s_per_km: number
  readonly stops: ReadonlyArray<TStop>
  readonly standing: TStanding
  /** Moving time plus every adjustment, or `null` for a day that did not finish. */
  readonly total_ms: number | null
  readonly adjustment_ms: number
  readonly awards: ReadonlyArray<string>
  /** Rules that apply to the whole day rather than to a place. */
  readonly day_rules: ReadonlyArray<TStopRule>
  /**
   * The stop at which the engine stopped calling the day clean, or `null`.
   *
   * Not "where the clock ran out". A timing system can only know anything at a
   * mat, and the fold has the same semantics: a runner over a two-hour limit at
   * 20.6 km is judged at the next place that sees them — here, the finish. So
   * this is *where the day was decided*, found by asking `fold_until` at each
   * stop in turn, and it needs no knowledge of which rule did the deciding.
   * Addressed by id **and** elapsed time, because on a lapped course the same
   * place is reached more than once.
   */
  readonly judged_at: { readonly id: string; readonly elapsed_ms: number } | null
}

/** A ghost with every dial at zero: one runner, clean reads, no spread. */
const alone = (start_at: DateTime.Utc, pace_s_per_km: number): TFieldConfig => ({
  seed: 1,
  entrants: 1,
  start_at,
  pace_s_per_km,
  pace_spread: 0,
  wave_gap_s: 0,
  wave_size: 1,
  mat_miss: 0,
  read_jitter_s: 0,
  dnf: 0,
  flags: [],
  quantities: [],
  corral_s: 0,
})

const rule_row = (rule: TKernelRule, state: TEntrantState): TStopRule => {
  const applied = state.applied.find((a) => a.id_rule === rule.id)
  return {
    id: rule.id,
    sentence: rule.sentence,
    fired: applied !== undefined,
    added_ms: applied?.added_ms ?? 0,
  }
}

/**
 * The day one runner has on this course at this pace.
 *
 * `rules` is what `plan(document, PACKS)` returned — a document that could not
 * be planned has no day, and the caller is the one that knows what to draw
 * instead. Where there is nothing to say, a host says so.
 */
export const plan_at_pace = (
  document: TCourseDocument,
  rules: ReadonlyArray<TKernelRule>,
  args: { readonly start_at: DateTime.Utc; readonly pace_s_per_km: number },
): TPlan | null => {
  const log: ReadonlyArray<TObservation> = simulate(
    document,
    alone(args.start_at, args.pace_s_per_km),
  )
  const state = fold(rules, log)[0]
  if (state === undefined) return null

  const places = points_of(document)
  const gun = DateTime.toEpochMillis(args.start_at)

  // One stop per observation the fold consumed, in the order it consumed them.
  // Not one per place: a lap is a place *visited again*, and a plan that
  // collapsed the two would print a four-lap race as one lap.
  const stops: Array<TStop> = []

  /*
    The start, which is not in `seen` under a place.

    `simulate` says why in one line — *"the start line is already recorded by
    the gun"* — and the gun's observation carries no point, so a plan built
    only from the log begins at the first mat and a runner reads a race that
    starts 5 km in. The instant is still the fold's (`started_at`) and the
    place is still the document's; only the pairing happens here.
  */
  const line = points_of(document).find((p) => p.along_m === 0 && produces(p.kind) === 'started')
  if (state.started_at !== null && line !== undefined) {
    stops.push({
      id: line.id,
      name: line.name ?? line.id,
      kind: line.kind,
      along_m: 0,
      elapsed_ms: 0,
      at: state.started_at,
      rules: rules
        .filter((rule) => rule.at !== null && 'point' in rule.at && rule.at.point === line.id)
        .map((rule) => rule_row(rule, state)),
    })
  }

  for (const seen of state.seen) {
    const id = seen.at.point
    if (id === null) continue
    const place = places.find((p) => p.id === id)
    stops.push({
      id,
      name: place?.name ?? id,
      kind: place?.kind ?? 'mat',
      along_m: seen.at.along_m,
      elapsed_ms: DateTime.toEpochMillis(seen.t) - gun,
      at: seen.t,
      rules: rules
        .filter((rule) => rule.at !== null && 'point' in rule.at && rule.at.point === id)
        .map((rule) => rule_row(rule, state)),
    })
  }

  const ordered = Arr.sort(
    stops,
    Order.mapInput(Order.Number, (s: TStop) => s.elapsed_ms),
  )

  // The first stop after which the engine no longer calls the day clean. One
  // fold per stop over a log of twenty-odd observations: nothing, next to what
  // a wrong mark on a profile would cost.
  const judged = ordered.find(
    (stop) => (fold_until(rules, log, stop.at)[0]?.standing ?? 'clean') !== 'clean',
  )

  return {
    pace_s_per_km: args.pace_s_per_km,
    stops: ordered,
    standing: state.standing,
    total_ms: total_ms(state),
    adjustment_ms: state.adjustment_ms,
    awards: state.awards,
    day_rules: rules
      .filter((rule) => rule.at === null || !('point' in rule.at) || rule.at.point === null)
      .map((rule) => rule_row(rule, state)),
    judged_at: judged === undefined ? null : { id: judged.id, elapsed_ms: judged.elapsed_ms },
  }
}

/* ── the question a runner actually has ──────────────────────────────────── */

/**
 * The slowest pace searched. 25 min/km is slower than walking a marathon, so
 * {@link slowest_clear_pace} answering this means *any pace finishes*.
 */
export const SLOWEST_S_PER_KM = 1_500

/** The fastest. 2:00/km is faster than the mile record and safely outside. */
const FASTEST_S_PER_KM = 120
/** Sixteen halvings of that range settle to under a tenth of a second per km. */
const STEPS = 16

/**
 * The slowest pace that still finishes clean — asked of the engine, by bisection.
 *
 * `null` when no pace in the range finishes clean, which is the honest answer
 * for a course whose rules cut everybody (and for one whose rules cut nobody it
 * is {@link SLOWEST_S_PER_KM}, meaning *any pace*).
 *
 * Sixteen folds of a twenty-observation log, so a few hundred microseconds. The
 * reason this is a search rather than a subtraction is at the top of the file:
 * a subtraction would have to know what a `cutoff_at` keeps in its params, and
 * then it would have to know what every future dialect keeps in its own.
 */
export const slowest_clear_pace = (
  document: TCourseDocument,
  rules: ReadonlyArray<TKernelRule>,
  start_at: DateTime.Utc,
): number | null => {
  const clean = (pace: number): boolean =>
    plan_at_pace(document, rules, { start_at, pace_s_per_km: pace })?.standing === 'clean'

  if (!clean(FASTEST_S_PER_KM)) return null
  if (clean(SLOWEST_S_PER_KM)) return SLOWEST_S_PER_KM

  let fast = FASTEST_S_PER_KM
  let slow = SLOWEST_S_PER_KM
  for (let i = 0; i < STEPS; i += 1) {
    const middle = (fast + slow) / 2
    if (clean(middle)) fast = middle
    else slow = middle
  }
  return fast
}
