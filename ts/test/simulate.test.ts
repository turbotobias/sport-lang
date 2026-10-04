/**
 * The ghost field, held to the two things a simulator has to be.
 *
 * **Reproducible**, or a race it produced cannot be used to argue about a rule
 * and a conformance case generated from one would rot. **Honest about its
 * dials**, or a simulator UI built on it teaches the wrong lesson: if turning up
 * `mat_miss` does not actually drop reads, somebody designs a rule that falls
 * apart on the day.
 *
 * The last test is the point of the whole file — a simulated backyard field,
 * judged by `backyard@1` rather than by anything here. The simulator decides
 * where people are; the rules decide what happened to them.
 *
 * @see src/simulate.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { fold, PACKS, ROAD, simulate, TRAIL, total_ms } from '../src/index.ts'
import type { TFieldConfig, TObservation } from '../src/index.ts'
import { decode_document, plan, points_of } from '../src/document.ts'

const CORPUS = join(import.meta.dirname, '../../corpus/conformance')
const load = (name: string) =>
  Result.getOrThrow(
    decode_document(JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf8')).document),
  )

const START = Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-19T06:00:00.000Z')
const config = (over: Partial<TFieldConfig> = {}): TFieldConfig => ({
  ...ROAD,
  start_at: START,
  ...over,
})

describe('the ghost field', () => {
  const marathon = load('athletics-cutoff-and-station')

  it('is a function of its seed and nothing else', () => {
    const once = simulate(marathon, config({ entrants: 40 }))
    const again = simulate(marathon, config({ entrants: 40 }))
    assert.deepStrictEqual(again, once)
    // And a different seed is a different field, or the seed is decoration.
    const other = simulate(marathon, config({ entrants: 40, seed: 2 }))
    assert.notDeepEqual(other, once)
    assert.strictEqual(other.length > 0, true)
  })

  it('starts everyone, and visits the course in order', () => {
    const log = simulate(marathon, config({ entrants: 5, mat_miss: 0, dnf: 0 }))
    const one = log.filter((o) => o.entrant === 'ent_ghost_0000')
    assert.strictEqual(one.filter((o) => o.kind === 'started').length, 1)
    assert.deepStrictEqual(
      one.filter((o) => o.at.point !== null).map((o) => o.at.along_m),
      [...points_of(marathon)].map((p) => p.along_m).sort((a, b) => a - b),
    )
    // Time runs forwards along the course.
    const times = one.map((o) => o.t)
    assert.deepStrictEqual([...times].sort(), times.slice().sort())
  })

  it('drops reads when told to, and none when told not to', () => {
    const reads = (mat_miss: number) =>
      simulate(marathon, config({ entrants: 300, mat_miss, dnf: 0 })).filter(
        (o) => o.source === 'transponder',
      ).length
    const none = reads(0)
    const half = reads(0.5)
    assert.isAbove(none, 0)
    assert.isBelow(half, none * 0.7)
    assert.isAbove(half, none * 0.3)
  })

  it('stops the fraction it was asked to stop, and they stay stopped', () => {
    const log = simulate(marathon, config({ entrants: 400, dnf: 0.25, mat_miss: 0 }))
    const out = log.filter((o) => o.kind === 'withdrew')
    assert.isAbove(out.length, 400 * 0.15)
    assert.isBelow(out.length, 400 * 0.35)
    for (const gone of out) {
      const after = log.filter(
        (o) => o.entrant === gone.entrant && o.kind !== 'withdrew' && o.t > gone.t,
      )
      assert.deepStrictEqual(after, [], `${gone.entrant} kept going after withdrawing`)
    }
  })

  it('spreads the field, and a trail spreads it further than a road', () => {
    const finishes = (over: Partial<TFieldConfig>) => {
      const log = simulate(marathon, config({ ...over, entrants: 300, mat_miss: 0, dnf: 0 }))
      const rules = Result.getOrThrow(plan(marathon, PACKS))
      return fold(rules, log)
        .map(total_ms)
        .filter((t): t is number => t !== null)
    }
    const road = finishes(ROAD)
    const trail = finishes({ ...TRAIL, seed: ROAD.seed })
    const span = (xs: ReadonlyArray<number>) =>
      (Math.max(...xs) - Math.min(...xs)) / Math.max(...xs)
    assert.isAbove(span(road), 0)
    assert.isAbove(span(trail), span(road))
  })

  it('takes a measurement before the gun when asked, so a kit rule has something to read', () => {
    const log = simulate(
      marathon,
      config({ entrants: 3, quantities: [{ name: 'pack_kg', mean: 3.6, spread: 0.4 }] }),
    )
    const weighed = log.filter((o) => o.quantity_name === 'pack_kg')
    assert.strictEqual(weighed.length, 3)
    for (const w of weighed) {
      assert.strictEqual(w.kind, 'checked')
      assert.isTrue(w.t < START, 'the scales come out before the gun')
    }
  })

  it('raises a flag at about the rate it was given', () => {
    const log = simulate(
      marathon,
      config({ entrants: 400, mat_miss: 0, dnf: 0, flags: [{ name: 'overtaking', chance: 0.2 }] }),
    )
    const reads = log.filter((o) => o.source === 'transponder')
    const flagged = reads.filter((o) => o.flags.includes('overtaking'))
    assert.isAbove(flagged.length / reads.length, 0.1)
    assert.isBelow(flagged.length / reads.length, 0.3)
  })
})

describe('a corral', () => {
  it('holds the field to the boundary, so a lost lap is one lost lap', () => {
    const backyard = load('backyard-last-standing')
    const at = (log: ReadonlyArray<TObservation>, point: string): string =>
      DateTime.formatIso(log.find((o) => o.at.point === point)?.t ?? START)

    // Without a corral the laps run back to back: lap two begins the instant
    // lap one ends, so whoever loses the hour once loses it every time and the
    // field never separates. That is not a backyard ultra.
    const loose = simulate(
      backyard,
      config({
        entrants: 1,
        seed: 3,
        pace_s_per_km: 480,
        pace_spread: 0,
        mat_miss: 0,
        dnf: 0,
        read_jitter_s: 0,
      }),
    )
    const corralled = simulate(
      backyard,
      config({
        entrants: 1,
        seed: 3,
        pace_s_per_km: 480,
        pace_spread: 0,
        mat_miss: 0,
        dnf: 0,
        read_jitter_s: 0,
        corral_s: 3600,
      }),
    )

    const loose_start_2 = at(loose, 'lap-2-start')
    const held_start_2 = at(corralled, 'lap-2-start')
    // Corralled, lap two starts exactly an hour after the gun; loose, it starts
    // whenever lap one happened to end. A runner who takes longer than the hour
    // is released at the *next* boundary — the simulator moves people and does
    // not judge them, and by then the rules have already put them out.
    assert.strictEqual(held_start_2, '2027-06-19T07:00:00.000Z')
    assert.notStrictEqual(loose_start_2, '2027-06-19T07:00:00.000Z')
  })
})

describe('a simulated race, judged by its own rules', () => {
  it('runs a backyard field and lets backyard@1 decide who is left', () => {
    const backyard = load('backyard-last-standing')
    const rules = Result.getOrThrow(plan(backyard, PACKS))

    // A spread wide enough that some of the field cannot hold the hour. Nothing
    // here decides who: the simulator moves people, `backyard@1` judges them.
    const log = simulate(
      backyard,
      config({
        entrants: 60,
        seed: 7,
        pace_s_per_km: 480,
        pace_spread: 0.22,
        mat_miss: 0,
        dnf: 0.05,
      }),
    )
    const states = fold(rules, log)

    assert.strictEqual(states.length, 60)
    const gated = states.filter((s) => s.standing === 'gated')
    const going = states.filter((s) => s.standing === 'clean' && !s.withdrew)
    assert.isAbove(gated.length, 0, 'nobody lost a lap — the spread is too tight to be a backyard')
    assert.isAbove(going.length, 0, 'the whole field was put out')

    // Whoever is crowned is one of the ones still going, and only if one is left.
    const crowned = states.filter((s) => s.awards.includes('last one standing'))
    assert.isAtMost(crowned.length, going.length)
    for (const winner of crowned) {
      assert.strictEqual(winner.standing, 'clean')
      assert.isFalse(winner.withdrew)
    }
  })
})
