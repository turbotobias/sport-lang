/**
 * The conformance corpus — the spec, as data rather than prose.
 *
 * Every case in `corpus/conformance/` is a document, an observation
 * log, and the state every entrant must end in. This file runs them through the
 * TypeScript implementation; a Rust one runs the same files and must produce the
 * same answers, byte for byte on the numbers.
 *
 * That is the whole portability strategy, and it is deliberately not a prose
 * specification. A document describing a fold is a document two implementations
 * can read differently and both believe they are right; a corpus is a
 * disagreement that shows up as a failing test on the day it is introduced.
 *
 * Adding a case is how the spec grows. A dialect's new kind lands with one.
 *
 * @see SPEC.md
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { dialect_of, fold, PACKS, total_ms } from '../src/index.ts'
import { Observation } from '../src/index.ts'
import { decode_document, plan } from '../src/document.ts'

const CORPUS = join(import.meta.dirname, '../../corpus/conformance')
const decode_log = Schema.decodeUnknownSync(Schema.Array(Observation))

const Expected = Schema.Struct({
  entrant: Schema.String,
  standing: Schema.String,
  total_ms: Schema.Finite,
  adjustment_ms: Schema.Finite,
  awards: Schema.Array(Schema.String),
  laps: Schema.Finite,
})
const Case = Schema.Struct({
  name: Schema.String,
  why: Schema.String,
  document: Schema.Unknown,
  log: Schema.Unknown,
  expect: Schema.Array(Expected),
})
const decode_case = Schema.decodeUnknownSync(Case)

const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('sport-lang conformance', () => {
  it('has a corpus', () => {
    // Nineteen today: eleven written by hand — the README's own race among
    // them — and eight generated on synthetic courses, the cut-off edge pair
    // among those. Fewer means a case went missing, not that the corpus got
    // smaller on purpose.
    assert.isAtLeast(files.length, 19, 'the conformance corpus has at least nineteen cases')
  })

  it('reaches every kind of every dialect, and `controls` in both orders', () => {
    // A kind no case reaches is a kind two engines can disagree on with
    // nothing to say so.
    const reached = files.flatMap((file) => {
      const scenario = decode_case(JSON.parse(readFileSync(join(CORPUS, file), 'utf8')))
      const document = Result.getOrThrow(decode_document(scenario.document))
      return document['sport:rules'].flatMap((rule) => {
        const named = `${rule.dialect} · ${rule.kind}`
        const params = rule.params
        return rule.kind === 'controls' &&
          typeof params === 'object' &&
          params !== null &&
          'in_order' in params
          ? [named, `${named} · in_order ${String(params.in_order)}`]
          : [named]
      })
    })
    const wanted = [
      ...PACKS.flatMap((pack) => pack.kinds.map((k) => `${dialect_of(pack)} · ${k.kind}`)),
      'orienteering@1 · controls · in_order true',
      'orienteering@1 · controls · in_order false',
    ]
    assert.lengthOf(wanted, 13, 'eleven kinds and the two orders of `controls`')
    assert.deepStrictEqual(
      wanted.filter((w) => !reached.includes(w)),
      [],
      'no conformance case reaches these',
    )
  })

  for (const file of files) {
    const scenario = decode_case(JSON.parse(readFileSync(join(CORPUS, file), 'utf8')))

    it(`${scenario.name} — ${scenario.why}`, () => {
      const document = Result.getOrThrow(decode_document(scenario.document))
      const planned = plan(document, PACKS)
      assert.isTrue(Result.isSuccess(planned), `${scenario.name} did not plan`)
      if (Result.isFailure(planned)) return

      const states = fold(planned.success, decode_log(scenario.log))

      // Every entrant the corpus names, and no others: an implementation that
      // invents a state, or loses one, fails here rather than later.
      assert.deepStrictEqual(
        states.map((s) => s.entrant).sort(),
        scenario.expect.map((e) => e.entrant).sort(),
      )

      for (const expected of scenario.expect) {
        const got = states.find((s) => s.entrant === expected.entrant)
        assert.isDefined(got, `${expected.entrant} missing`)
        if (got === undefined) continue
        assert.strictEqual(got.standing, expected.standing, `${expected.entrant} standing`)
        assert.strictEqual(total_ms(got), expected.total_ms, `${expected.entrant} total`)
        assert.strictEqual(
          got.adjustment_ms,
          expected.adjustment_ms,
          `${expected.entrant} adjustment`,
        )
        assert.deepStrictEqual([...got.awards], [...expected.awards], `${expected.entrant} awards`)
        assert.strictEqual(got.laps, expected.laps, `${expected.entrant} laps`)
      }
    })
  }
})
