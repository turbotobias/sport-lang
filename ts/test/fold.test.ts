/**
 * The fold's first pass, and the one field aggregate no dialect reaches yet.
 *
 * `by_entrant` replaced a filter of the whole log per entrant, which made a
 * fold cost the log times the field. The partition has to be that filter
 * exactly — same entrants, same order, same observations in the same order —
 * or the speed was bought with a different answer. `rank` is keyed for the
 * same reason, and no conformance case reaches it, so it is pinned here.
 *
 * @see SPEC.md §3.1
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  by_entrant,
  decode_document,
  fold,
  fold_until,
  Observation,
  PACKS,
  plan,
  positions_at,
  ROAD,
  RuleId,
  settle,
  simulate,
  total_ms,
} from '../src/index.ts'
import type { TKernelRule } from '../src/index.ts'

const CORPUS = join(import.meta.dirname, '../../corpus/conformance')
const read_case = (name: string): unknown =>
  JSON.parse(readFileSync(join(CORPUS, `${name}.json`), 'utf8'))
const decode_case = Schema.decodeUnknownSync(
  Schema.Struct({ document: Schema.Unknown, log: Schema.Array(Observation) }),
)

const marathon = decode_case(read_case('marathon-cutoff-cuts-the-tail'))
const document = Result.getOrThrow(decode_document(marathon.document))
const rules = Result.getOrThrow(plan(document, PACKS))

const field = (entrants: number) =>
  simulate(document, {
    ...ROAD,
    start_at: Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-19T06:00:00.000Z'),
    entrants,
    seed: 7,
    dnf: 0.1,
    mat_miss: 0.05,
  })

describe('the fold', () => {
  it('partitions the settled log exactly as filtering it per entrant would', () => {
    const log = field(300)
    const ordered = settle(log)
    const groups = by_entrant(ordered)
    const first_seen = ordered
      .map((o) => o.entrant)
      .filter((entrant, i, all) => all.indexOf(entrant) === i)

    assert.deepStrictEqual(
      groups.map((g) => g.entrant),
      first_seen,
    )
    for (const group of groups) {
      assert.deepStrictEqual(
        group.seen,
        ordered.filter((o) => o.entrant === group.entrant),
      )
    }
    assert.strictEqual(
      groups.reduce((n, g) => n + g.seen.length, 0),
      ordered.length,
    )
    // And each state carries exactly its partition.
    const states = fold(rules, log)
    assert.deepStrictEqual(
      states.map((s) => s.seen),
      groups.map((g) => g.seen),
    )
  })

  it('ranks the finishers by total, and nobody else', () => {
    const podium: TKernelRule = {
      id: RuleId.make('rul_podium'),
      dialect: 'test@1',
      kind: 'podium',
      ordinal: 99,
      at: null,
      when: {
        combine: 'all',
        clauses: [
          {
            negated: false,
            atom: { _tag: 'field', aggregate: 'rank', cmp: 'lte', value: 3, ratio: null },
          },
        ],
      },
      // A kernel rule's consequence is named `then` (SPEC.md §3.2); it is never awaited.
      // eslint-disable-next-line unicorn/no-thenable
      then: { _tag: 'award', name: 'podium' },
      sentence: 'The three fastest totals take the podium.',
      stratum: 1,
    }
    const states = fold([...rules, podium], marathon.log)
    const expected = states
      .filter((s) => s.finished_at !== null && s.standing !== 'disqualified')
      .flatMap((s) => {
        const total = total_ms(s)
        return total === null ? [] : [{ entrant: s.entrant, total }]
      })
      .toSorted((a, b) => a.total - b.total)
      .slice(0, 3)
      .map((r) => r.entrant)

    assert.strictEqual(expected.length, 3)
    assert.deepStrictEqual(
      states
        .filter((s) => s.awards.includes('podium'))
        .map((s) => s.entrant)
        .toSorted(),
      expected.toSorted(),
    )
  })

  it('asks each observation whose it is a bounded number of times, however big the field', () => {
    // The quadratic fold asked every observation once per entrant: 500
    // entrants, some 4 400 observations, over two million reads. Partitioned
    // once, it is a few per observation, and that is what this counts — not a
    // timing, so it cannot flake.
    let reads = 0
    const log = field(500).map(
      (o) =>
        new Proxy(o, {
          get: (target, key, receiver) => {
            if (key === 'entrant') reads += 1
            return Reflect.get(target, key, receiver)
          },
        }),
    )
    const middle = settle(log)[Math.floor(log.length / 2)]
    if (middle === undefined) return assert.fail('the simulated field is empty')
    const passes: ReadonlyArray<readonly [string, () => unknown]> = [
      ['fold', () => fold(rules, log)],
      ['fold_until', () => fold_until(rules, log, middle.t)],
      ['positions_at', () => positions_at(log, middle.t)],
    ]
    for (const [name, pass] of passes) {
      reads = 0
      pass()
      assert.isAbove(reads, 0, name)
      assert.isAtMost(
        reads,
        4 * log.length,
        `${name}: ${reads} reads of ${log.length} observations`,
      )
    }
  })
})
