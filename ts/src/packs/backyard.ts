/**
 * `backyard@1` — a lap every hour, until one is left.
 *
 * Here as the hardest case for the design rather than the most common: a
 * backyard ultra has no distance, no cutoff and no finish line in the ordinary
 * sense. A runner is out the moment they fail to start a lap on the hour, the
 * winner is whoever is still going when everyone else has stopped, and the
 * result is decided *by the field* rather than by the clock.
 *
 * Two things make it expressible without touching the kernel:
 *
 * - **A lap is a place, not a repetition.** A document's path (SPEC.md §2.1)
 *   stores a lapped course as a playlist of slices over one line, so lap 3's finish sits at
 *   three loops along and is a distinct `along_m`. The kernel's *"was there an
 *   observation here"* then means what it should. Nothing in the language has to
 *   learn to count.
 * - **Last-one-standing is a `field` predicate**, so it lands in stratum 1 and
 *   reads the field the per-entrant rules left behind.
 */
import * as Schema from 'effect/Schema'

import { all_of, is, not, place } from '../kernel.ts'
import { rule_kind, span, type TPack } from '../pack.ts'

export const backyard: TPack = {
  name: 'backyard',
  version: 1,
  modes: ['run'],
  kinds: [
    /**
     * The corral: this lap has to be finished inside the hour.
     *
     * One instance per lap in the document, each with its own two places. The
     * places *are* the lap; `lap` only names them (`lap-N-start`, `lap-N-finish`).
     */
    rule_kind(
      'lap_within',
      Schema.Struct({
        within_ms: Schema.Finite,
        from_m: Schema.Finite,
        to_m: Schema.Finite,
        // A whole number from 1: the lap names its two places, and
        // `lap-1.5-start` is no lap's.
        lap: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      }),
      (p) => ({
        when: all_of(
          is({
            _tag: 'clock',
            measure: 'split',
            cmp: 'gt',
            value_ms: p.within_ms,
            value_at: null,
            from: place(`lap-${p.lap}-start`, p.from_m),
            to: place(`lap-${p.lap}-finish`, p.to_m),
          }),
        ),
        then: {
          _tag: 'set_standing',
          standing: 'gated',
          reason: `lap ${p.lap} not closed in the hour`,
        },
        // A split needs both ends, so a lap never closed is not over time: the
        // runner who stops mid-lap has withdrawn, and this rule is silent.
        sentence: `Closing lap ${p.lap} more than ${span(p.within_ms)} after it starts ends the day.`,
      }),
    ),

    /**
     * The last one going wins, and there is no second place.
     *
     * `remaining` counts entrants who have neither withdrawn nor been gated nor
     * disqualified — which is exactly the sport's own definition of *still in
     * it*, and which only has an answer after every per-entrant rule has run.
     */
    rule_kind('last_standing', Schema.Struct({ award: Schema.String }), (p) => ({
      when: all_of(
        // Still in it — both halves. `remaining` says how many are left and
        // never who, so without these two the rule crowned the runner who had
        // just been put out, and then the one who had walked off two laps ago.
        is({ _tag: 'standing', is: 'clean' }),
        not({ _tag: 'withdrawn' }),
        is({ _tag: 'field', aggregate: 'remaining', cmp: 'lte', value: 1, ratio: null }),
      ),
      then: { _tag: 'award', name: p.award },
      sentence: `A clean runner still in when every other runner has withdrawn, been gated or been disqualified is ${p.award}.`,
    })),
  ],
}
