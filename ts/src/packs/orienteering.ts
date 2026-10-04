/**
 * `orienteering@1` — the controls, in order.
 *
 * One kind, and it is the only thing in any pack that uses the kernel's `order`
 * predicate. A classic course is punched in sequence and a mispunch ends the
 * day; a score event is the same controls with the order dropped, which is the
 * same kind with `in_order: false`.
 */
import { PointId } from '../ids.ts'
import * as Schema from 'effect/Schema'

import { all_of, any_of, not } from '../kernel.ts'
import { rule_kind, type TPack } from '../pack.ts'

export const orienteering: TPack = {
  name: 'orienteering',
  version: 1,
  modes: ['run'],
  kinds: [
    rule_kind(
      'controls',
      Schema.Struct({
        // Branded at the boundary, so a control id and a segment id cannot be swapped.
        controls: Schema.Array(Schema.Struct({ point: PointId, along_m: Schema.Finite })),
        in_order: Schema.Boolean,
      }),
      (p) => ({
        when: p.in_order
          ? all_of(
              not({
                _tag: 'order',
                sequence: p.controls.map((c) => ({ point: c.point, along_m: c.along_m })),
              }),
            )
          : any_of(
              ...p.controls.map((c) =>
                not({
                  _tag: 'observed',
                  at: { point: c.point, along_m: c.along_m },
                  kind: 'punched',
                }),
              ),
            ),
        then: { _tag: 'set_standing', standing: 'disqualified', reason: 'mispunch' },
        // In order, `order` is about being *at* each control, by any kind of
        // read; in any order, each control needs a punch. SPEC.md §3.4.
        sentence: p.in_order
          ? `Missing any of the ${p.controls.length} controls, or reaching them out of order, disqualifies.`
          : `Missing a punch at any of the ${p.controls.length} controls disqualifies; the order is free.`,
      }),
    ),
  ],
}
