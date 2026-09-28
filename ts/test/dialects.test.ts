/**
 * sport-lang, end to end, one fixture per dialect.
 *
 * This file is the bar `pack.ts` sets: *a pack without a rehearsal fixture
 * cannot be published*. Each describe below is a ghost field and the outcome it
 * must produce: a rule nobody can rehearse is a rule nobody can publish, and a
 * dialect is held to that one kind at a time.
 *
 * The four dialects are chosen to need different parts of the kernel, so that
 * "a new sport is a pack, not a change to the engine" is a measured claim
 * rather than an intention:
 *
 * | pack | what only it needs |
 * | --- | --- |
 * | `athletics@1` | wall-clock and elapsed gates, a station that was not punched |
 * | `backyard@1` | a split between two places, and a `field` aggregate in stratum 1 |
 * | `triathlon@1` | a measured quantity, a referee's flag, and a neutralised span |
 * | `orienteering@1` | `order` — a subsequence over the whole log |
 *
 * @see src/kernel.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  athletics,
  backyard,
  compile,
  fold,
  orienteering,
  PACKS,
  triathlon,
  total_ms,
} from '../src/index.ts'
import type { TDocumentRule, TEntrantState, TObservation } from '../src/index.ts'
import { DocumentRule, Observation } from '../src/index.ts'

const decode_rule = Schema.decodeUnknownSync(DocumentRule)
const decode_obs = Schema.decodeUnknownSync(Observation)

/** An observation, with the boring fields filled in. */
const seen = (
  entrant: string,
  kind: TObservation['kind'],
  t: string,
  along_m: number,
  extra: Partial<{
    point: string
    quantity_name: string
    quantity_value: number
    flags: ReadonlyArray<string>
  }> = {},
): TObservation =>
  decode_obs({
    id: `obs_${entrant}_${kind}_${along_m}_${t}`,
    entrant: `ent_${entrant}`,
    at: { point: extra.point ?? null, along_m },
    kind,
    t,
    quantity_name: extra.quantity_name ?? null,
    quantity_value: extra.quantity_value ?? null,
    flags: extra.flags ?? [],
    source: 'transponder',
    device: 'dev_test',
    confidence: 1,
    supersedes: null,
  })

const rule = (
  dialect: string,
  kind: string,
  ordinal: number,
  at: unknown,
  params: unknown,
): TDocumentRule =>
  decode_rule({ id: `rul_${dialect}_${kind}_${ordinal}`, dialect, kind, ordinal, at, params })

const run = (
  document: ReadonlyArray<TDocumentRule>,
  log: ReadonlyArray<TObservation>,
): ReadonlyArray<TEntrantState> => {
  const { rules, refused } = compile(PACKS, document)
  assert.deepStrictEqual(refused, [], 'every rule in a fixture must compile')
  return fold(rules, log)
}

const of = (states: ReadonlyArray<TEntrantState>, entrant: string): TEntrantState => {
  const found = states.find((s) => s.entrant === `ent_${entrant}`)
  if (found === undefined) throw new Error(`no state for ${entrant}`)
  return found
}

/* ── athletics@1 ─────────────────────────────────────────────────────────── */

describe('athletics@1', () => {
  const FINISH = 42_195
  const STATION = 30_000

  const document = [
    rule(
      'athletics@1',
      'cutoff_at',
      0,
      { point: 'station-1', along_m: STATION },
      { at: '2027-06-19T14:30:00.000Z', says: '16:30' },
    ),
    rule('athletics@1', 'cutoff_within', 1, null, { within_ms: 6 * 3_600_000 }),
    rule(
      'athletics@1',
      'station_required',
      2,
      { point: 'station-1', along_m: STATION },
      { penalty_ms: 300_000, each_time: false },
    ),
    rule(
      'athletics@1',
      'qualifies_within',
      3,
      { point: null, along_m: FINISH },
      {
        within_ms: 3 * 3_600_000,
        award: 'the ballot',
      },
    ),
    rule('athletics@1', 'no_outside_help', 4, null, {}),
  ]

  it('lets a clean fast day through, and opens the ballot', () => {
    const states = run(document, [
      seen('fast', 'started', '2027-06-19T08:00:00.000Z', 0),
      seen('fast', 'punched', '2027-06-19T10:00:00.000Z', STATION, { point: 'station-1' }),
      seen('fast', 'finished', '2027-06-19T10:45:00.000Z', FINISH),
    ])
    const day = of(states, 'fast')
    assert.strictEqual(day.standing, 'clean')
    assert.strictEqual(day.adjustment_ms, 0)
    assert.deepStrictEqual([...day.awards], ['the ballot'])
    assert.strictEqual(total_ms(day), 2 * 3_600_000 + 45 * 60_000)
  })

  it('gates a runner who reaches the station after the cutoff', () => {
    const states = run(document, [
      seen('late', 'started', '2027-06-19T08:00:00.000Z', 0),
      seen('late', 'punched', '2027-06-19T14:40:00.000Z', STATION, { point: 'station-1' }),
    ])
    assert.strictEqual(of(states, 'late').standing, 'gated')
  })

  it('penalises a station nobody saw them at, once', () => {
    const states = run(document, [
      seen('skipper', 'started', '2027-06-19T08:00:00.000Z', 0),
      seen('skipper', 'finished', '2027-06-19T11:00:00.000Z', FINISH),
    ])
    const day = of(states, 'skipper')
    assert.strictEqual(day.standing, 'penalised')
    assert.strictEqual(day.adjustment_ms, 300_000)
    // The sentence a person wrote, carried through — never a paraphrase.
    assert.include(day.applied.map((a) => a.sentence).join(' '), 'Missing station-1 costs 5:00.')
  })

  it('ends the day on an official’s declaration of outside help', () => {
    const states = run(document, [
      seen('helped', 'started', '2027-06-19T08:00:00.000Z', 0),
      seen('helped', 'punched', '2027-06-19T10:00:00.000Z', STATION, { point: 'station-1' }),
      seen('helped', 'checked', '2027-06-19T10:30:00.000Z', 35_000, { flags: ['outside_help'] }),
      seen('helped', 'finished', '2027-06-19T11:00:00.000Z', FINISH),
    ])
    assert.strictEqual(of(states, 'helped').standing, 'disqualified')
  })

  it('is severity-ordered: a disqualified runner is not also penalised', () => {
    const states = run(document, [
      seen('both', 'started', '2027-06-19T08:00:00.000Z', 0),
      seen('both', 'checked', '2027-06-19T10:30:00.000Z', 35_000, { flags: ['outside_help'] }),
      seen('both', 'finished', '2027-06-19T11:00:00.000Z', FINISH),
    ])
    const day = of(states, 'both')
    assert.strictEqual(day.standing, 'disqualified')
    // The penalty still happened and is still on the record; the standing is the worst of them.
    assert.strictEqual(day.adjustment_ms, 300_000)
  })

  it('refuses a station or a qualifying time bound to no place — each needs one', () => {
    // Bound to `null`, a station used to be read as the start line, so every
    // runner who punched the real station was penalised for missing it.
    const { rules, refused } = compile(PACKS, [
      rule('athletics@1', 'station_required', 0, null, { penalty_ms: 60_000, each_time: false }),
      rule('athletics@1', 'qualifies_within', 1, null, { within_ms: 60_000, award: 'x' }),
      rule(
        'athletics@1',
        'qualifies_within',
        2,
        { from_m: 0, to_m: 10 },
        { within_ms: 1, award: 'x' },
      ),
      rule('athletics@1', 'cutoff_within', 3, null, { within_ms: 60_000 }),
    ])
    assert.deepStrictEqual(
      refused.map((r) => `${r.kind}: ${r.why}`),
      [
        'station_required: needs a place',
        'qualifies_within: needs a place',
        'qualifies_within: needs a place',
      ],
    )
    assert.deepStrictEqual(
      rules.map((r) => r.kind),
      ['cutoff_within'],
    )
  })
})

describe('athletics@1 on a lapped course', () => {
  // Four laps of 2 500 m: lap lines at 2 500, 5 000 and 7 500, the finish at
  // 10 000. Every one of them produces `finished`.
  const LAP = 2_500
  const document = [
    rule(
      'athletics@1',
      'qualifies_within',
      0,
      { point: 'finish', along_m: 4 * LAP },
      {
        within_ms: 50 * 60_000,
        award: 'sub-50',
      },
    ),
  ]
  const lap_line = (entrant: string, lap: number, minute: number) =>
    seen(
      entrant,
      'finished',
      `2027-06-19T08:${String(minute).padStart(2, '0')}:00.000Z`,
      lap * LAP,
      {
        point: lap === 4 ? 'finish' : `lap-${lap}`,
      },
    )
  const log = [
    seen('full', 'started', '2027-06-19T08:00:00.000Z', 0),
    lap_line('full', 1, 11),
    lap_line('full', 2, 22),
    lap_line('full', 3, 33),
    lap_line('full', 4, 45),
    seen('two', 'started', '2027-06-19T08:00:00.000Z', 0),
    lap_line('two', 1, 10),
    lap_line('two', 2, 20),
  ]

  it('awards the runner who reached the finish, not the one who stopped after two laps', () => {
    // A `finished` anywhere used to be a finish: the runner who stopped after
    // two of four laps, 20 minutes in, held a sub-50 award.
    const states = run(document, log)
    assert.deepStrictEqual([...of(states, 'full').awards], ['sub-50'])
    assert.deepStrictEqual([...of(states, 'two').awards], [])
    assert.strictEqual(of(states, 'two').laps, 2)
  })

  it('awards nobody live after the first lap', () => {
    const after_lap_one = log.filter((o) => o.id.includes('T08:0') || o.id.includes('T08:1'))
    const states = run(document, after_lap_one)
    assert.deepStrictEqual(
      states.map((s) => s.awards.length),
      [0, 0],
    )
  })
})

/* ── backyard@1 ──────────────────────────────────────────────────────────── */

describe('backyard@1', () => {
  /**
   * A 6.72 km loop — the length of `corpus/courses/loop-6720.json`. Three laps, and a lap is a *place* rather than a repetition —
   * which is what lets the kernel say a backyard ultra without learning to count.
   */
  const LOOP = 6_720
  const HOUR = 3_600_000

  const laps = [1, 2, 3].flatMap((lap) => [
    rule('backyard@1', 'lap_within', lap, null, {
      within_ms: HOUR,
      from_m: (lap - 1) * LOOP,
      to_m: lap * LOOP,
      lap,
    }),
  ])
  const document = [
    ...laps,
    rule('backyard@1', 'last_standing', 99, null, { award: 'last one standing' }),
  ]

  const lap_of = (entrant: string, lap: number, start: string, finish: string) => [
    seen(entrant, 'passed', start, (lap - 1) * LOOP, { point: `lap-${lap}-start` }),
    seen(entrant, 'finished', finish, lap * LOOP, { point: `lap-${lap}-finish` }),
  ]

  it('puts out the runner who cannot close a lap inside the hour, and crowns the one who can', () => {
    const states = run(document, [
      seen('ada', 'started', '2027-08-01T06:00:00.000Z', 0),
      ...lap_of('ada', 1, '2027-08-01T06:00:00.000Z', '2027-08-01T06:50:00.000Z'),
      ...lap_of('ada', 2, '2027-08-01T07:00:00.000Z', '2027-08-01T07:52:00.000Z'),
      ...lap_of('ada', 3, '2027-08-01T08:00:00.000Z', '2027-08-01T08:55:00.000Z'),
      seen('bo', 'started', '2027-08-01T06:00:00.000Z', 0),
      ...lap_of('bo', 1, '2027-08-01T06:00:00.000Z', '2027-08-01T06:55:00.000Z'),
      // Bo takes 1:05 over the second loop, which is the whole sport.
      ...lap_of('bo', 2, '2027-08-01T07:00:00.000Z', '2027-08-01T08:05:00.000Z'),
    ])
    assert.strictEqual(of(states, 'bo').standing, 'gated')
    assert.strictEqual(of(states, 'ada').standing, 'clean')
    assert.deepStrictEqual([...of(states, 'ada').awards], ['last one standing'])
    assert.strictEqual(of(states, 'ada').laps, 3)
    // And the runner who was just put out is not also crowned. `remaining` says
    // how many are left, never who — the `standing` half of the rule says who.
    assert.deepStrictEqual([...of(states, 'bo').awards], [])
  })

  it('crowns nobody while two are still going — the award is a fact about the field', () => {
    const states = run(document, [
      seen('ada', 'started', '2027-08-01T06:00:00.000Z', 0),
      ...lap_of('ada', 1, '2027-08-01T06:00:00.000Z', '2027-08-01T06:50:00.000Z'),
      seen('bo', 'started', '2027-08-01T06:00:00.000Z', 0),
      ...lap_of('bo', 1, '2027-08-01T06:00:00.000Z', '2027-08-01T06:55:00.000Z'),
    ])
    assert.deepStrictEqual([...of(states, 'ada').awards], [])
    assert.deepStrictEqual([...of(states, 'bo').awards], [])
  })
})

/* ── triathlon@1 ─────────────────────────────────────────────────────────── */

describe('triathlon@1', () => {
  const document = [
    rule('triathlon@1', 'drafting', 0, null, {
      seconds_ms: 25_000,
      penalty_ms: 300_000,
      from_m: 5_000,
      to_m: 5_100,
    }),
    rule('triathlon@1', 'wetsuit_limit', 1, null, { max_c: 24.5 }),
    rule('triathlon@1', 'transition_neutral', 2, null, { from_m: 1_900, to_m: 2_000 }),
  ]

  it('penalises sitting in, and does not penalise an overtake', () => {
    const sat = run(document, [
      seen('sat', 'started', '2027-05-02T07:00:00.000Z', 0),
      seen('sat', 'entered', '2027-05-02T07:40:00.000Z', 5_000, { point: 'draft-zone-enter' }),
      seen('sat', 'left', '2027-05-02T07:41:00.000Z', 5_100, { point: 'draft-zone-leave' }),
      seen('sat', 'finished', '2027-05-02T09:00:00.000Z', 51_500),
    ])
    assert.strictEqual(of(sat, 'sat').adjustment_ms, 300_000)
    assert.strictEqual(of(sat, 'sat').standing, 'penalised')

    const past = run(document, [
      seen('past', 'started', '2027-05-02T07:00:00.000Z', 0),
      seen('past', 'entered', '2027-05-02T07:40:00.000Z', 5_000, {
        point: 'draft-zone-enter',
        flags: ['overtaking'],
      }),
      seen('past', 'left', '2027-05-02T07:41:00.000Z', 5_100, { point: 'draft-zone-leave' }),
      seen('past', 'finished', '2027-05-02T09:00:00.000Z', 51_500),
    ])
    assert.strictEqual(of(past, 'past').adjustment_ms, 0)
    assert.strictEqual(of(past, 'past').standing, 'clean')
  })

  it('disqualifies a wetsuit above the legal temperature, and only when it was worn', () => {
    const log = (entrant: string, flags: ReadonlyArray<string>) => [
      seen(entrant, 'checked', '2027-05-02T06:30:00.000Z', 0, {
        quantity_name: 'water_c',
        quantity_value: 25.8,
        flags,
      }),
      seen(entrant, 'started', '2027-05-02T07:00:00.000Z', 0),
      seen(entrant, 'finished', '2027-05-02T09:00:00.000Z', 51_500),
    ]
    assert.strictEqual(of(run(document, log('warm', ['wetsuit'])), 'warm').standing, 'disqualified')
    assert.strictEqual(of(run(document, log('bare', [])), 'bare').standing, 'clean')
  })

  it('stops the clock in transition, so the total is less than the wall clock', () => {
    const states = run(document, [
      seen('t', 'started', '2027-05-02T07:00:00.000Z', 0),
      seen('t', 'entered', '2027-05-02T07:30:00.000Z', 1_900, { point: 'transition-in' }),
      seen('t', 'passed', '2027-05-02T07:33:00.000Z', 2_000, { point: 'transition-out' }),
      seen('t', 'finished', '2027-05-02T09:00:00.000Z', 51_500),
    ])
    const day = of(states, 't')
    assert.strictEqual(day.neutralised_ms, 3 * 60_000)
    assert.strictEqual(total_ms(day), 2 * 3_600_000 - 3 * 60_000)
  })
})

/* ── orienteering@1 ──────────────────────────────────────────────────────── */

describe('orienteering@1', () => {
  const controls = [
    { point: 'c1', along_m: 800 },
    { point: 'c2', along_m: 1_900 },
    { point: 'c3', along_m: 3_100 },
  ]
  const classic = [rule('orienteering@1', 'controls', 0, null, { controls, in_order: true })]
  const score = [rule('orienteering@1', 'controls', 0, null, { controls, in_order: false })]

  const punches = (entrant: string, order: ReadonlyArray<number>) =>
    order.map((i, n) =>
      seen(
        entrant,
        'punched',
        `2027-04-11T09:${String(10 + n).padStart(2, '0')}:00.000Z`,
        controls[i]!.along_m,
        {
          point: controls[i]!.point,
        },
      ),
    )

  it('disqualifies a mispunch on a classic course and allows any order on a score event', () => {
    const wrong = [seen('x', 'started', '2027-04-11T09:00:00.000Z', 0), ...punches('x', [0, 2, 1])]
    assert.strictEqual(of(run(classic, wrong), 'x').standing, 'disqualified')
    assert.strictEqual(of(run(score, wrong), 'x').standing, 'clean')
  })

  it('allows extra mats between controls — order is a subsequence, not a march', () => {
    const states = run(classic, [
      seen('y', 'started', '2027-04-11T09:00:00.000Z', 0),
      seen('y', 'punched', '2027-04-11T09:10:00.000Z', 800, { point: 'c1' }),
      seen('y', 'passed', '2027-04-11T09:12:00.000Z', 1_400),
      seen('y', 'punched', '2027-04-11T09:14:00.000Z', 1_900, { point: 'c2' }),
      seen('y', 'punched', '2027-04-11T09:20:00.000Z', 3_100, { point: 'c3' }),
    ])
    assert.strictEqual(of(states, 'y').standing, 'clean')
  })

  it('disqualifies a control that was never punched, on either course', () => {
    const short = [seen('z', 'started', '2027-04-11T09:00:00.000Z', 0), ...punches('z', [0, 1])]
    assert.strictEqual(of(run(classic, short), 'z').standing, 'disqualified')
    assert.strictEqual(of(run(score, short), 'z').standing, 'disqualified')
  })
})

/* ── the language itself ─────────────────────────────────────────────────── */

describe('sport-lang', () => {
  it('refuses a dialect it does not ship rather than dropping the rule', () => {
    const { rules, refused } = compile(PACKS, [rule('curling@1', 'hammer', 0, null, {})])
    assert.deepStrictEqual(rules, [])
    assert.deepStrictEqual(
      refused.map((r) => r.why),
      ['unknown dialect'],
    )
  })

  it('refuses a kind, and parameters that do not fit, by name', () => {
    const { refused } = compile(PACKS, [
      rule('athletics@1', 'sprint_finish', 0, null, {}),
      rule('athletics@1', 'cutoff_within', 1, null, { within: 'six hours' }),
    ])
    assert.deepStrictEqual(
      refused.map((r) => [r.kind, r.why]),
      [
        ['sprint_finish', 'unknown kind'],
        ['cutoff_within', 'parameters do not fit'],
      ],
    )
  })

  it('is reproducible: the log’s arrival order cannot change the result', () => {
    const document = [rule('athletics@1', 'cutoff_within', 0, null, { within_ms: 3_600_000 })]
    const log = [
      seen('r', 'started', '2027-01-01T09:00:00.000Z', 0),
      seen('r', 'passed', '2027-01-01T09:30:00.000Z', 5_000),
      seen('r', 'finished', '2027-01-01T10:30:00.000Z', 10_000),
    ]
    const forwards = run(document, log)
    const backwards = run(document, [...log].reverse())
    assert.deepStrictEqual(of(backwards, 'r').standing, of(forwards, 'r').standing)
    assert.strictEqual(total_ms(of(backwards, 'r')), total_ms(of(forwards, 'r')))
  })

  it('re-folds correctly when a mat uploads late', () => {
    const document = [
      rule(
        'athletics@1',
        'station_required',
        0,
        { point: 'c', along_m: 5_000 },
        { penalty_ms: 60_000, each_time: false },
      ),
    ]
    const without = [
      seen('m', 'started', '2027-01-01T09:00:00.000Z', 0),
      seen('m', 'finished', '2027-01-01T10:00:00.000Z', 10_000),
    ]
    assert.strictEqual(of(run(document, without), 'm').adjustment_ms, 60_000)
    // The mat's read arrives an hour after the race. Nothing is patched; the
    // log is re-folded, and the penalty was never real.
    const late = [
      ...without,
      seen('m', 'punched', '2027-01-01T09:30:00.000Z', 5_000, { point: 'c' }),
    ]
    assert.strictEqual(of(run(document, late), 'm').adjustment_ms, 0)
  })

  it('takes a correction as a superseding observation, never an edit', () => {
    const document = [rule('athletics@1', 'cutoff_within', 0, null, { within_ms: 3_600_000 })]
    const wrong = seen('c', 'finished', '2027-01-01T10:30:00.000Z', 10_000)
    const right: TObservation = {
      ...decode_obs({
        ...seen('c', 'finished', '2027-01-01T09:50:00.000Z', 10_000),
        t: '2027-01-01T09:50:00.000Z',
        id: 'obs_fix',
      }),
      supersedes: wrong.id,
    }
    const states = run(document, [
      seen('c', 'started', '2027-01-01T09:00:00.000Z', 0),
      wrong,
      right,
    ])
    assert.strictEqual(of(states, 'c').standing, 'clean')
    assert.strictEqual(total_ms(of(states, 'c')), 50 * 60_000)
  })

  it('ships four dialects, and every one of them declares its modes', () => {
    assert.deepStrictEqual(
      PACKS.map((p) => `${p.name}@${p.version}`),
      ['athletics@1', 'backyard@1', 'orienteering@1', 'triathlon@1'],
    )
    for (const pack of [athletics, backyard, orienteering, triathlon]) {
      assert.isAbove(pack.modes.length, 0, `${pack.name} declares no modes`)
      assert.isAbove(pack.kinds.length, 0, `${pack.name} declares no kinds`)
    }
  })
})

/* ── the sentences ───────────────────────────────────────────────────────── */

const Said = Schema.Array(
  Schema.Struct({
    dialect: Schema.String,
    kind: Schema.String,
    at: Schema.Unknown,
    params: Schema.Unknown,
    sentence: Schema.String,
  }),
)

describe('the sentence each kind generates', () => {
  // One table, read by this file and by `rust/tests/meaning.rs`, so the two
  // engines say the same words. The wording is not conformance (SPEC.md §3.4);
  // that it is *true* of the expansion is the point, and each row is a case
  // where it used not to be: a rounded time, a penalty "each time" that was
  // once, a place called the finish that was not, a lap that was never closed.
  const said = Schema.decodeUnknownSync(Said)(
    JSON.parse(readFileSync(join(import.meta.dirname, 'support/sentences.json'), 'utf8')),
  )

  it('has a row for every kind', () => {
    const kinds = PACKS.flatMap((p) => p.kinds.map((k) => `${p.name}@${p.version} ${k.kind}`))
    for (const kind of kinds)
      assert.isTrue(
        said.some((row) => `${row.dialect} ${row.kind}` === kind),
        `no sentence row for ${kind}`,
      )
  })

  for (const [i, row] of said.entries()) {
    it(`${row.dialect} · ${row.kind}: ${row.sentence}`, () => {
      const { rules, refused } = compile(PACKS, [
        decode_rule({ id: `rul_${i}`, ordinal: 0, ...row }),
      ])
      assert.deepStrictEqual(refused, [])
      assert.deepStrictEqual(
        rules.map((r) => r.sentence),
        [row.sentence],
      )
    })
  }
})
