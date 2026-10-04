/**
 * The replay, held to the property that makes it trustworthy.
 *
 * Scrubbing to the end of a race must give back exactly the race's result. Not
 * approximately — exactly — because the state at a moment *is* the fold over
 * the log up to it, and a replay that computed anything else would be a second
 * implementation of the engine sitting next to the first.
 *
 * @see src/replay.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  fold,
  fold_until,
  order_at,
  PACKS,
  positions_at,
  ROAD,
  simulate,
  window_of,
} from '../src/index.ts'
import type { TFieldConfig } from '../src/index.ts'
import { decode_document, plan } from '../src/document.ts'

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

const marathon = load('athletics-cutoff-and-station')
const rules = Result.getOrThrow(plan(marathon, PACKS))
const log = simulate(marathon, config({ entrants: 40, seed: 11, dnf: 0.1 }))
const span = window_of(log)

describe('the replay', () => {
  it('has a window, and it is the whole race', () => {
    assert.isNotNull(span)
    if (span === null) return
    assert.isTrue(span.from <= span.to)
    for (const o of log) {
      assert.isTrue(o.t >= span.from)
      assert.isTrue(o.t <= span.to)
    }
  })

  it('scrubbed to the end, agrees with the race exactly', () => {
    if (span === null) return assert.fail('no window')
    // The property the whole design rests on. Not "close enough".
    assert.deepStrictEqual(fold_until(rules, log, span.to), fold(rules, log))
  })

  it('scrubbed to the start, has nobody anywhere', () => {
    if (span === null) return assert.fail('no window')
    const before = DateTime.subtractDuration(span.from, Duration.hours(1))
    assert.deepStrictEqual(fold_until(rules, log, before), [])
    for (const p of positions_at(log, before)) {
      assert.strictEqual(p.along_m, 0)
      assert.isNull(p.last)
    }
  })

  it('moves people forwards and never backwards', () => {
    if (span === null) return assert.fail('no window')
    const from = DateTime.toEpochMillis(span.from)
    const to = DateTime.toEpochMillis(span.to)
    let previous = positions_at(log, span.from)
    for (let step = 1; step <= 12; step += 1) {
      const at = DateTime.makeUnsafe(from + ((to - from) * step) / 12)
      const now = positions_at(log, at)
      for (const p of now) {
        const was = previous.find((q) => q.entrant === p.entrant)
        if (was === undefined) continue
        assert.isAtLeast(p.along_m + 0.001, was.along_m, `${p.entrant} went backwards`)
      }
      previous = now
    }
  })

  it('says when a position is a guess rather than a reading', () => {
    if (span === null) return assert.fail('no window')
    const half = DateTime.makeUnsafe(
      (DateTime.toEpochMillis(span.from) + DateTime.toEpochMillis(span.to)) / 2,
    )
    const now = positions_at(log, half)
    // Mid-race most of the field is between two mats, and the ones who are not
    // are either finished or standing on one.
    assert.isAbove(now.filter((p) => p.between).length, 0)
    for (const p of now.filter((p) => !p.between && p.last !== null && !p.done)) {
      assert.strictEqual(p.along_m, p.last?.at.along_m)
    }
  })

  it('orders the field by how far along it is', () => {
    if (span === null) return assert.fail('no window')
    const third = DateTime.makeUnsafe(
      DateTime.toEpochMillis(span.from) +
        (DateTime.toEpochMillis(span.to) - DateTime.toEpochMillis(span.from)) / 3,
    )
    const ordered = order_at(positions_at(log, third))
    for (let i = 1; i < ordered.length; i += 1) {
      assert.isAtMost(ordered[i]?.along_m ?? 0, ordered[i - 1]?.along_m ?? 0)
    }
  })

  it('is monotone in what the rules have decided: a standing only worsens as time runs', () => {
    if (span === null) return assert.fail('no window')
    const severity = { clean: 0, penalised: 1, gated: 2, disqualified: 3 } as const
    const from = DateTime.toEpochMillis(span.from)
    const to = DateTime.toEpochMillis(span.to)
    let previous = fold_until(rules, log, span.from)
    for (let step = 1; step <= 8; step += 1) {
      const now = fold_until(rules, log, DateTime.makeUnsafe(from + ((to - from) * step) / 8))
      for (const state of now) {
        const was = previous.find((s) => s.entrant === state.entrant)
        if (was === undefined) continue
        assert.isAtLeast(
          severity[state.standing],
          severity[was.standing],
          `${state.entrant} got better`,
        )
      }
      previous = now
    }
  })
})
