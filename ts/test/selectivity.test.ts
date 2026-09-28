/**
 * Which clause of which rule is doing the work.
 *
 * A rule that fires for nobody is either a rule nobody breaks or a rule that
 * *cannot* fire, and from the outside those are identical. This is the
 * difference, and the tests are the two cases side by side.
 *
 * @see src/fold.ts — `selectivity`
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  fold,
  PACKS,
  ROAD,
  says,
  selectivity,
  simulate,
  document_of,
  DocumentRule,
  mats_along,
  plan,
} from '../src/index.ts'
import type { TFieldConfig } from '../src/index.ts'
import { course } from './support/courses.ts'

const MARATHON = course('marathon')
const rule = Schema.decodeUnknownSync(DocumentRule)
const START = Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-21T18:30:00.000Z')
const config = (over: Partial<TFieldConfig> = {}): TFieldConfig => ({
  ...ROAD,
  start_at: START,
  ...over,
})

const race = (
  rules: ReadonlyArray<Record<string, unknown>>,
  over: Partial<TFieldConfig> = {},
  controls_at: ReadonlyArray<number> = [],
) => {
  const built = Result.getOrThrow(
    document_of(MARATHON, {
      id: 'crs_marathon',
      event: 'evt_marathon',
      way: null,
      name: MARATHON.name,
      dialects: ['athletics@1'],
      places: mats_along(MARATHON.drawn_m, 1, 10_000, controls_at),
      rules: rules.map((r) => rule(r)),
      repeat: 1,
      stated_m: 42_195,
    }),
  )
  const planned = Result.getOrThrow(plan(built, PACKS))
  const log = simulate(built, config({ entrants: 120, seed: 4, dnf: 0, ...over }))
  return { rules: planned, states: fold(planned, log) }
}

describe('selectivity', () => {
  it('separates a rule nobody breaks from a rule that cannot fire', () => {
    // A generous cut-off: satisfied, and it is the clause that says so.
    const slack = race([
      {
        id: 'rul_slack',
        dialect: 'athletics@1',
        kind: 'cutoff_within',
        ordinal: 0,
        at: null,
        params: { within_ms: 12 * 3_600_000 },
      },
    ])
    const [slack_rule] = selectivity(slack.rules, slack.states)
    assert.strictEqual(slack_rule?.fires_for, 0)
    assert.strictEqual(slack_rule?.clauses[0]?.true_for, 0)
    assert.include(slack_rule?.clauses[0]?.says ?? '', 'elapsed >')

    // A cut-off nobody survives: fires for the whole field, so the clause is
    // true for the whole field. Same shape on screen, opposite meaning.
    const savage = race([
      {
        id: 'rul_savage',
        dialect: 'athletics@1',
        kind: 'cutoff_within',
        ordinal: 0,
        at: null,
        params: { within_ms: 60_000 },
      },
    ])
    const [savage_rule] = selectivity(savage.rules, savage.states)
    assert.strictEqual(savage_rule?.fires_for, 120)
    assert.strictEqual(savage_rule?.clauses[0]?.true_for, 120)
  })

  it('shows a mat that is missing everybody', () => {
    // A station required at a place, with every read dropped. The rule fires
    // for the whole field, and the clause says why: nobody was punched there.
    const blind = race(
      [
        {
          id: 'rul_station',
          dialect: 'athletics@1',
          kind: 'station_required',
          ordinal: 0,
          at: { point: 'control-20k', along_m: 20_000 },
          params: { penalty_ms: 300_000, each_time: false },
        },
      ],
      { mat_miss: 1 },
      [20_000],
    )
    const [rule] = selectivity(blind.rules, blind.states)
    assert.strictEqual(rule?.clauses[0]?.negated, true)
    assert.include(rule?.clauses[0]?.says ?? '', 'punched at control-20k')
    // The clause is true for the whole field — nobody was punched anywhere.
    assert.strictEqual(rule?.clauses[0]?.true_for, 120)
    // And the rule fires for *nobody*, because with every read dropped nobody
    // ever reached 20 km, so it cannot judge them. Those two numbers side by
    // side are the entire argument for a selectivity view: without the second, a rule
    // that is silently unjudgeable reads as a rule everybody satisfied.
    assert.strictEqual(rule?.fires_for, 0)
    assert.strictEqual(rule?.dormant_for, 120)
  })

  it('counts the entrants a placed rule cannot yet judge', () => {
    // Everybody reaches 30 km on a 42 km course they all finish, so by the end
    // the rule is dormant for nobody — the distinction the replay exists to
    // keep honest only bites mid-race.
    const early = race(
      [
        {
          id: 'rul_station',
          dialect: 'athletics@1',
          kind: 'station_required',
          ordinal: 0,
          at: { point: 'control-30k', along_m: 30_000 },
          params: { penalty_ms: 60_000, each_time: false },
        },
      ],
      {},
      [30_000],
    )
    const [at_end] = selectivity(early.rules, early.states)
    // At the end of the race everybody is past it, so nobody is dormant.
    assert.strictEqual(at_end?.dormant_for, 0)
  })
})

describe('says', () => {
  it('describes an atom mechanically, so it can be checked against the sentence', () => {
    assert.strictEqual(says({ _tag: 'flag', name: 'outside_help' }), 'flagged outside_help')
    assert.strictEqual(says({ _tag: 'withdrawn' }), 'withdrew')
    assert.strictEqual(says({ _tag: 'standing', is: 'clean' }), 'standing is clean')
    assert.strictEqual(says({ _tag: 'count', what: 'laps', cmp: 'gte', value: 4 }), 'laps ≥ 4')
    assert.strictEqual(
      says({ _tag: 'observed', at: { point: null, along_m: 21_100 }, kind: 'passed' }),
      'passed at 21.1 km',
    )
  })
})
