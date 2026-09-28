/**
 * `athletics@1` — the road and the trail.
 *
 * The five rules road and trail racing use — a wall-clock cut-off at a place,
 * a time limit, a qualifying time, a required station, no outside help — said
 * in the kernel rather than hard-coded, so a sixth is a new kind and not a new
 * evaluator.
 *
 * A cutoff is *arriving at a place after a time*, which is why every kind here
 * takes its place from the rule rather than naming one: a document says where,
 * the pack says what happens there. Two kinds mean nothing without a place — a
 * station, and the finish a qualifying time is run to — and are refused
 * without one (SPEC.md §3.4).
 */
import type * as DateTime from 'effect/DateTime'
import * as Schema from 'effect/Schema'

import type { TWhere } from '../kernel.ts'
import { all_of, Instant, is, not } from '../kernel.ts'
import { costs, place_name, rule_kind, rule_kind_at, span, type TPack } from '../pack.ts'

const elapsed = (cmp: 'gt' | 'lte', value_ms: number) => ({
  _tag: 'clock' as const,
  measure: 'elapsed' as const,
  cmp,
  value_ms,
  value_at: null,
  from: null,
  to: null,
})

const wall = (cmp: 'gt', value_at: DateTime.Utc) => ({
  _tag: 'clock' as const,
  measure: 'wall' as const,
  cmp,
  value_ms: null,
  value_at,
  from: null,
  to: null,
})

/**
 * Where a wall-clock gate is judged: the rule's own place, or the finish when it
 * has none (SPEC.md §3.2, `clock wall`).
 */
const judged_at = (at: TWhere): string =>
  at !== null && 'along_m' in at ? place_name(at) : 'the finish'

export const athletics: TPack = {
  name: 'athletics',
  version: 1,
  modes: ['run', 'hike'],
  kinds: [
    /** The wall-clock gate: be here by this time or the day ends. */
    rule_kind('cutoff_at', Schema.Struct({ at: Instant, says: Schema.String }), (p, at) => ({
      when: all_of(is(wall('gt', p.at))),
      then: { _tag: 'set_standing', standing: 'gated', reason: 'cutoff' },
      sentence: `The day ends for anyone reaching ${judged_at(at)} after ${p.says}.`,
    })),

    /** The elapsed gate: finish inside this or the day ends. */
    rule_kind('cutoff_within', Schema.Struct({ within_ms: Schema.Finite }), (p) => ({
      when: all_of(is(elapsed('gt', p.within_ms))),
      then: { _tag: 'set_standing', standing: 'gated', reason: 'over time' },
      sentence: `The day ends for anyone still out after ${span(p.within_ms)}.`,
    })),

    /**
     * Finish inside this and a ballot opens.
     *
     * *Finish* is a clause of its own, and it is the finish **the rule is bound
     * to**: a `finished` observation at that place. Elapsed time exists without
     * one — it runs to the last read — so on elapsed alone a runner still on
     * the course, or one who withdrew early, held the award. And *any*
     * `finished` is not enough: on a lapped course every lap line produces one,
     * so a runner who stopped after two laps of four held it too, and every
     * runner held it live after lap one. Bound to the course's finish, the
     * rule is dormant until the entrant gets there and true only if they did.
     */
    rule_kind_at(
      'qualifies_within',
      Schema.Struct({ within_ms: Schema.Finite, award: Schema.String }),
      (p, at) => ({
        when: all_of(
          is({ _tag: 'observed', at, kind: 'finished' }),
          is(elapsed('lte', p.within_ms)),
        ),
        then: { _tag: 'award', name: p.award },
        sentence: `Finishing inside ${span(p.within_ms)} qualifies for ${p.award}.`,
      }),
    ),

    /**
     * A station that was not punched.
     *
     * Stated as *not observed here*, which is the honest shape: a checkpoint
     * nobody recorded you at is one you did not visit, and the runner whose
     * chip failed is a protest rather than a special case in the language.
     */
    rule_kind_at(
      'station_required',
      Schema.Struct({ penalty_ms: Schema.Finite, each_time: Schema.Boolean }),
      (p, at) => ({
        when: all_of(not({ _tag: 'observed', at, kind: 'punched' })),
        then: { _tag: 'adjust_time', by_ms: p.penalty_ms, each_time: p.each_time },
        sentence: p.each_time
          ? `Missing ${place_name(at)} is recorded and adds nothing: each_time counts the punches there, and a miss has none.`
          : `Missing ${place_name(at)} ${costs(p.penalty_ms)}.`,
      }),
    ),

    /** Outside assistance, as an official declares it. */
    rule_kind('no_outside_help', Schema.Struct({}), () => ({
      when: all_of(is({ _tag: 'flag', name: 'outside_help' })),
      then: { _tag: 'set_standing', standing: 'disqualified', reason: 'outside help' },
      sentence: 'Taking outside assistance ends the day.',
    })),
  ],
}
