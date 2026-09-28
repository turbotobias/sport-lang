/**
 * `triathlon@1` — zones, and things measured rather than timed.
 *
 * Here because it needs two parts of the kernel nothing else does: a **span**
 * of the course that has its own rules while you are inside it, and a
 * **quantity** — the water's temperature, a pack's weight — that decides
 * whether a rule applies at all. Both were in the kernel from the start for
 * exactly this reason, and neither needed a change to say a triathlon.
 */
import * as Schema from 'effect/Schema'

import { all_of, is, not, place } from '../kernel.ts'
import { costs, rule_kind, span, type TPack } from '../pack.ts'

export const triathlon: TPack = {
  name: 'triathlon',
  version: 1,
  modes: ['swim', 'ride', 'run', 'transition'],
  kinds: [
    /**
     * Sitting in the wheel in front for longer than the zone allows.
     *
     * *Not* overtaking is a flag rather than a measurement, because it is a
     * judgement a referee makes on a motorbike and the bridge's job is to carry
     * it as one — see `observe.ts`. The language never has to model a bicycle.
     *
     * Once per fold, whatever `each_time` says: the predicate has no `observed`
     * clause, so there are no occurrences to multiply by and §3.2 counts one.
     * The time through the zone is one split — the first read entering to the
     * first read leaving — so a second pass through it is not a second
     * offence. Counting offences would need a new kind, and the sentence says
     * what this one does.
     */
    rule_kind(
      'drafting',
      Schema.Struct({
        seconds_ms: Schema.Finite,
        penalty_ms: Schema.Finite,
        from_m: Schema.Finite,
        to_m: Schema.Finite,
      }),
      (p) => ({
        when: all_of(
          is({
            _tag: 'clock',
            measure: 'split',
            cmp: 'gt',
            value_ms: p.seconds_ms,
            value_at: null,
            from: place('draft-zone-enter', p.from_m),
            to: place('draft-zone-leave', p.to_m),
          }),
          not({ _tag: 'flag', name: 'overtaking' }),
        ),
        then: { _tag: 'adjust_time', by_ms: p.penalty_ms, each_time: true },
        sentence: `Taking more than ${span(p.seconds_ms)} through the draft zone without an overtaking flag ${costs(p.penalty_ms)}, once.`,
      }),
    ),

    /**
     * A wetsuit above the legal temperature. Measured, not declared — and a
     * measurement nobody took is false (SPEC.md §3.2), so with no water
     * temperature in the log the rule never fires.
     */
    rule_kind('wetsuit_limit', Schema.Struct({ max_c: Schema.Finite }), (p) => ({
      when: all_of(
        is({ _tag: 'quantity', name: 'water_c', cmp: 'gt', value: p.max_c }),
        is({ _tag: 'flag', name: 'wetsuit' }),
      ),
      then: {
        _tag: 'set_standing',
        standing: 'disqualified',
        reason: 'wetsuit above the legal temperature',
      },
      sentence: `A wetsuit disqualifies when the last water temperature taken is above ${p.max_c} °C.`,
    })),

    /** The clock does not run in transition, for events that neutralise it. */
    rule_kind(
      'transition_neutral',
      Schema.Struct({ from_m: Schema.Finite, to_m: Schema.Finite }),
      (p) => ({
        when: all_of(
          is({ _tag: 'observed', at: place('transition-in', p.from_m), kind: 'entered' }),
        ),
        then: {
          _tag: 'neutralise',
          from: place('transition-in', p.from_m),
          to: place('transition-out', p.to_m),
        },
        sentence: 'The clock stops from transition-in to transition-out.',
      }),
    ),
  ],
}
