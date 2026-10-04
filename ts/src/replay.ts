/**
 * Where everybody was, at a moment.
 *
 * A scrubber over a race needs two things and this is both of them: where each
 * entrant is on the course at time *t*, and what the rules had made of them by
 * then.
 *
 * ## The second one is free
 *
 * The state at *t* is the fold over the observations up to *t*. Not an
 * approximation of it — it *is* it, because the fold is a function of the log
 * and nothing else. So a replay needs no new engine concept, no event
 * timestamps bolted onto a firing, and no risk of the scrubbed view and the
 * final view disagreeing: dragging to the end of a race gives back exactly the
 * result the race had.
 *
 * That is the same property that lets a mat upload an hour late (`observe.ts`)
 * and a protest be re-run rather than re-argued. It is worth noticing that all
 * three fall out of one decision.
 *
 * ## The first one is interpolation, and is honest about it
 *
 * Between two mats nobody knows where a runner is. This puts them proportionally
 * along, which is the only defensible guess, and says so — `between` is true
 * exactly when the position is inferred rather than observed. A UI that draws
 * those differently is telling the truth; one that does not is inventing a
 * runner's position and calling it data.
 *
 * @see src/fold.ts
 */
import type { TEntrantId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'

import { by_entrant, fold, type TEntrantState } from './fold.ts'
import type { TKernelRule } from './kernel.ts'
import { settle, type TObservation } from './observe.ts'

/** Where one entrant is, and how much of that is known rather than guessed. */
export type TAtTime = {
  readonly entrant: TEntrantId
  readonly along_m: number
  /** True when the position is interpolated between two observations. */
  readonly between: boolean
  /** The last thing actually seen of them at or before this moment. */
  readonly last: TObservation | null
  /** They have finished, withdrawn, or there is simply nothing more of them. */
  readonly done: boolean
}

/** The first and last instant anything happened. What a scrubber's ends are. */
export const window_of = (
  log: ReadonlyArray<TObservation>,
): { readonly from: DateTime.Utc; readonly to: DateTime.Utc } | null => {
  const ordered = settle(log)
  const first = Arr.head(ordered)
  const last = Arr.last(ordered)
  return Option.isNone(first) || Option.isNone(last)
    ? null
    : { from: first.value.t, to: last.value.t }
}

const ms = (t: DateTime.Utc) => DateTime.toEpochMillis(t)

/**
 * Everybody's position at `t`.
 *
 * One settle, one partition by entrant, then one pass per entrant over their
 * own observations: a frame costs a sort of the log and nothing quadratic —
 * cheap enough to do on every drag rather than caching frames that could go
 * stale.
 */
export const positions_at = (
  log: ReadonlyArray<TObservation>,
  t: DateTime.Utc,
): ReadonlyArray<TAtTime> => {
  const when = ms(t)

  return by_entrant(settle(log)).map(({ entrant, seen: theirs }) => {
    let before: TObservation | null = null
    let after: TObservation | null = null
    for (const o of theirs) {
      if (ms(o.t) <= when) before = o
      else {
        after = o
        break
      }
    }

    // Before their own first observation they are not on the course at all.
    if (before === null) {
      return { entrant, along_m: 0, between: false, last: null, done: false }
    }
    // Nothing after: they are wherever they were last seen, and that is the end
    // of their day whether they finished it or stopped.
    if (after === null) {
      return { entrant, along_m: before.at.along_m, between: false, last: before, done: true }
    }

    const span = ms(after.t) - ms(before.t)
    const share = span <= 0 ? 1 : (when - ms(before.t)) / span
    const along_m = before.at.along_m + (after.at.along_m - before.at.along_m) * share
    return { entrant, along_m, between: share > 0 && share < 1, last: before, done: false }
  })
}

/**
 * The race as it stood at `t`.
 *
 * A prefix of the log, folded. Deliberately not a cached or incremental thing:
 * the whole argument for the fold is that a result is a function of the log, and
 * an incremental replay is a second implementation of it that can disagree.
 */
export const fold_until = (
  rules: ReadonlyArray<TKernelRule>,
  log: ReadonlyArray<TObservation>,
  t: DateTime.Utc,
): ReadonlyArray<TEntrantState> =>
  fold(
    rules,
    log.filter((o) => ms(o.t) <= ms(t)),
  )

/**
 * Who is in front, at a moment.
 *
 * By distance along the course, then by who reached their last mat first — a
 * tie on `along_m` between two people interpolated over the same stretch is
 * broken by the one who was seen at it earlier, which is the order they are
 * actually in.
 */
export const order_at = (positions: ReadonlyArray<TAtTime>): ReadonlyArray<TAtTime> =>
  Arr.sort(
    positions,
    Order.combine(
      Order.mapInput(Order.Number, (p: TAtTime) => -p.along_m),
      Order.mapInput(Order.Number, (p: TAtTime) =>
        p.last === null ? Number.POSITIVE_INFINITY : ms(p.last.t),
      ),
    ),
  )
