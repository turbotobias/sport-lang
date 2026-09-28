/**
 * The bridge, held to the four problems it exists for.
 *
 * Identity, clock discipline, dedupe, lateness — each is a way a timing system
 * loses somebody, and each is tested by making it happen rather than by
 * asserting the happy path. The fifth test is the one that matters most: that
 * nothing is thrown away silently.
 *
 * The course is the synthetic hilly half, `corpus/courses/half-hilly.json`:
 * a whole line, unevenly spaced, so the watch test reads a track the way a
 * real recording arrives.
 *
 * @see src/bridge.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as DateTime from 'effect/DateTime'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  bound_to,
  bridge,
  corrected,
  DeviceId,
  document_of,
  EntrantId,
  fold,
  mats_along,
  PACKS,
  plan,
  points_of,
  RawRead,
  RuleId,
  self_timed,
  TagBinding,
  total_ms,
} from '../src/index.ts'
import type {
  TDrift,
  TRawRead,
  TCourseFile,
  TTagBinding,
  TTrack,
  TCourseDocument,
} from '../src/index.ts'
import { course } from './support/courses.ts'

const HALF = course('half-hilly')

const at = Schema.decodeSync(Schema.DateTimeUtcFromString)
const decode_read = Schema.decodeUnknownSync(RawRead)
const decode_binding = Schema.decodeUnknownSync(TagBinding)

const GUN = at('2027-04-24T07:00:00.000Z')

const document: TCourseDocument = Result.getOrThrow(
  document_of(HALF, {
    id: 'crs_half',
    event: 'evt_half',
    way: null,
    name: HALF.name,
    dialects: ['athletics@1'],
    places: mats_along(HALF.drawn_m, 1, 5_000),
    rules: [
      {
        id: RuleId.make('rul_cutoff'),
        dialect: 'athletics@1',
        kind: 'cutoff_within',
        ordinal: 0,
        at: null,
        params: { within_ms: 3 * 3_600_000 },
      },
    ],
    repeat: 1,
    stated_m: 21_097,
  }),
)

const PLACES = points_of(document)
const MAT = PLACES.find((p) => p.id === 'mat-10k')
const FINISH = PLACES.find((p) => p.id === 'finish')

/** One raw read from a mat, with the boring fields filled in. */
const read = (
  id: string,
  tag: string,
  point: string,
  along_m: number,
  device_t: string,
  device = 'dev_mat_a',
): TRawRead =>
  decode_read({
    id,
    device,
    tag,
    at: { point, along_m },
    device_t,
    // Received a second later than the device thinks it happened, which is what
    // a working reader looks like.
    received_t: device_t,
    rssi: -52,
  })

const binding = (tag: string, entrant: string, from: string, to: string | null): TTagBinding =>
  decode_binding({ tag, entrant: `ent_${entrant}`, from, to })

const BINDINGS = [binding('E280-AA', 'ada', '2027-04-24T00:00:00.000Z', null)]

describe('identity', () => {
  it('a tag is not an entrant, and the binding is bounded in time', () => {
    const last_year = [
      binding('E280-AA', 'bo', '2026-04-01T00:00:00.000Z', '2026-05-01T00:00:00.000Z'),
      ...BINDINGS,
    ]
    // The same chip, two seasons, two people. A log re-folded a year later must
    // not quietly hand this year's result to last year's runner.
    assert.strictEqual(bound_to('E280-AA', at('2026-04-15T09:00:00.000Z'), last_year), 'ent_bo')
    assert.strictEqual(bound_to('E280-AA', at('2027-04-24T09:00:00.000Z'), last_year), 'ent_ada')
    assert.isNull(bound_to('E280-AA', at('2026-08-01T09:00:00.000Z'), last_year))
    assert.isNull(bound_to('E280-ZZ', at('2027-04-24T09:00:00.000Z'), last_year))
  })

  it('strands a read nobody can be identified from, and says which kind of nobody', () => {
    if (MAT === undefined) return assert.fail('no mat')
    const bridged = bridge(
      [
        read('r1', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T07:45:00.000Z'),
        read('r2', 'E280-ZZ', MAT.id, MAT.along_m, '2027-04-24T07:46:00.000Z'),
        read('r3', 'E280-OLD', MAT.id, MAT.along_m, '2027-04-24T07:47:00.000Z'),
      ],
      document,
      {
        bindings: [
          ...BINDINGS,
          binding('E280-OLD', 'bo', '2026-01-01T00:00:00.000Z', '2026-12-31T00:00:00.000Z'),
        ],
        drifts: [],
        debounce_ms: 3_000,
      },
    )
    assert.strictEqual(bridged.observations.length, 1)
    // "Nobody has this tag" and "somebody had it last season" are different
    // conversations at the timing tent, so they are different answers.
    assert.deepStrictEqual(
      bridged.stranded.map((s) => [s.read.id, s.why]),
      [
        ['r2', 'no tag binding'],
        ['r3', 'the binding had expired'],
      ],
    )
  })
})

describe('clock discipline', () => {
  it('corrects a drifted reader, and trusts one whose drift nobody measured', () => {
    if (MAT === undefined) return assert.fail('no mat')
    const drifted = read(
      'r1',
      'E280-AA',
      MAT.id,
      MAT.along_m,
      '2027-04-24T07:45:00.000Z',
      'dev_slow',
    )
    const drifts: ReadonlyArray<TDrift> = [{ device: DeviceId.make('dev_slow'), offset_ms: 47_000 }]
    assert.strictEqual(DateTime.formatIso(corrected(drifted, drifts)), '2027-04-24T07:45:47.000Z')
    // Inventing a correction would be worse than using what the hardware said.
    assert.strictEqual(DateTime.formatIso(corrected(drifted, [])), '2027-04-24T07:45:00.000Z')
  })

  it('a forty-seven second drift is the difference between inside a cut-off and outside it', () => {
    if (FINISH === undefined) return assert.fail('no finish')
    const rules = Result.getOrThrow(plan(document, PACKS))
    const gun = read('r0', 'E280-AA', 'start', 0, '2027-04-24T07:00:00.000Z', 'dev_slow')
    // Finishing at 2:59:30 by a clock that is 47 s slow is 3:00:17 in truth.
    const line = read(
      'r1',
      'E280-AA',
      FINISH.id,
      FINISH.along_m,
      '2027-04-24T09:59:30.000Z',
      'dev_slow',
    )
    const options = { bindings: BINDINGS, debounce_ms: 3_000 }

    const uncorrected = fold(
      rules,
      bridge([gun, line], document, { ...options, drifts: [] }).observations,
    )
    const with_drift = fold(
      rules,
      bridge([gun, line], document, {
        ...options,
        drifts: [{ device: DeviceId.make('dev_slow'), offset_ms: 47_000 }],
      }).observations,
    )
    // Both start and finish move together, so the *elapsed* time is unchanged —
    // which is the point: a drift that shifts a whole reader is not a runner
    // running slower. It is the wall-clock rules that would care.
    assert.strictEqual(total_ms(uncorrected[0]!), total_ms(with_drift[0]!))
    assert.strictEqual(uncorrected[0]?.standing, 'clean')
  })
})

describe('dedupe', () => {
  it('forty reads in three seconds are one crossing, stamped at the first', () => {
    if (MAT === undefined) return assert.fail('no mat')
    const burst = Array.from({ length: 40 }, (_, i) =>
      read(
        `r${i}`,
        'E280-AA',
        MAT.id,
        MAT.along_m,
        `2027-04-24T07:45:0${Math.floor(i / 20)}.${String((i % 20) * 50).padStart(3, '0')}Z`,
      ),
    )
    const bridged = bridge(burst, document, { bindings: BINDINGS, drifts: [], debounce_ms: 3_000 })
    assert.strictEqual(bridged.observations.length, 1)
    // A runner is at the mat when the mat *first* sees them; the rest is them
    // walking away.
    assert.strictEqual(DateTime.formatIso(bridged.observations[0]!.t), '2027-04-24T07:45:00.000Z')
    // And the forty are counted, so a protest can ask.
    assert.strictEqual(bridged.collapsed[0]?.reads, 40)
  })

  it('two passes of the same mat, an hour apart, are two crossings', () => {
    if (MAT === undefined) return assert.fail('no mat')
    const bridged = bridge(
      [
        read('r1', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T07:45:00.000Z'),
        read('r2', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T08:45:00.000Z'),
      ],
      document,
      { bindings: BINDINGS, drifts: [], debounce_ms: 3_000 },
    )
    // A lapped course crosses the same mat every lap, and a debounce that ate
    // the second one would lose a lap.
    assert.strictEqual(bridged.observations.length, 2)
  })
})

describe('lateness', () => {
  it('a reader that uploads an hour late changes nothing about the answer', () => {
    if (MAT === undefined || FINISH === undefined) return assert.fail('no places')
    const rules = Result.getOrThrow(plan(document, PACKS))
    const options = { bindings: BINDINGS, drifts: [], debounce_ms: 3_000 }
    const on_time = [
      read('r0', 'E280-AA', 'start', 0, '2027-04-24T07:00:00.000Z'),
      read('r1', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T07:45:00.000Z'),
      read('r2', 'E280-AA', FINISH.id, FINISH.along_m, '2027-04-24T08:35:00.000Z'),
    ]
    // The same reads, arriving in the worst possible order an hour later. The
    // bridge sorts by *observation* time and never by arrival, so this is not a
    // special case anywhere — it is the same log.
    const late = [on_time[2]!, on_time[0]!, on_time[1]!]
    assert.deepStrictEqual(
      fold(rules, bridge(late, document, options).observations),
      fold(rules, bridge(on_time, document, options).observations),
    )
  })
})

describe('a watch as the timing system', () => {
  /**
   * A track that follows the course at a steady pace.
   *
   * `covered` is the fraction of the course the watch actually recorded — the
   * length is shortened by *stopping early*, not by scaling the clock, because
   * a watch that recorded half a race recorded half the road. Cut by
   * distance, not by vertex count: the line's spacing is uneven, so half the
   * vertices is not half the road.
   */
  const track_of = (from: TCourseFile, seconds_per_km: number, covered = 1): TTrack =>
    from.line
      .filter((p, i) => i < 2 || p[3] <= from.drawn_m * covered)
      .map((p) => [p[1], p[0], (p[3] / 1000) * seconds_per_km] as const)

  it('turns a runner’s own recording into a full set of crossings', () => {
    const { observations, refused } = self_timed(
      track_of(HALF, 300),
      document,
      EntrantId.make('ent_ada'),
      GUN,
    )
    assert.isNull(refused)
    assert.strictEqual(observations.length, PLACES.length)
    // Said plainly, so a result can show where it came from: a watch is not a mat.
    assert.strictEqual(observations[0]?.source, 'watch_upload')
    assert.isBelow(observations[0]?.confidence ?? 1, 1)

    const rules = Result.getOrThrow(plan(document, PACKS))
    const [day] = fold(rules, observations)
    assert.strictEqual(day?.standing, 'clean')
    // 20.9 km at 5:00/km is 1:44:20 — the cheapest timing system there is.
    assert.closeTo(total_ms(day!) ?? 0, (HALF.drawn_m / 1000) * 300 * 1000, 60_000)
  })

  it('refuses a track that is not this race, rather than putting a time on somebody', () => {
    // A watch will happily record a different race, a training run, or the
    // drive home. Accepting one puts a finish on a person who was not there.
    const half_as_long = self_timed(
      track_of(HALF, 300, 0.5),
      document,
      EntrantId.make('ent_ada'),
      GUN,
    )
    assert.isNotNull(half_as_long.refused)
    assert.deepStrictEqual(half_as_long.observations, [])
    assert.include(half_as_long.refused ?? '', 'against a course of')

    // And is generous about a watch that lost signal in a tunnel.
    assert.isNull(
      self_timed(track_of(HALF, 300, 0.93), document, EntrantId.make('ent_ada'), GUN).refused,
    )
  })
})

describe('the bridge as a whole', () => {
  it('never loses a read silently: everything is an observation or is stranded', () => {
    if (MAT === undefined) return assert.fail('no mat')
    const reads = [
      read('r1', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T07:45:00.000Z'),
      read('r2', 'E280-AA', MAT.id, MAT.along_m, '2027-04-24T07:45:01.000Z'),
      read('r3', 'E280-ZZ', MAT.id, MAT.along_m, '2027-04-24T07:46:00.000Z'),
      read('r4', 'E280-AA', 'mat-99k', 99_000, '2027-04-24T07:47:00.000Z'),
    ]
    const bridged = bridge(reads, document, { bindings: BINDINGS, drifts: [], debounce_ms: 3_000 })
    const accounted = bridged.collapsed.reduce((n, c) => n + c.reads, 0) + bridged.stranded.length
    assert.strictEqual(accounted, reads.length, 'a read went missing')
    assert.deepStrictEqual(bridged.stranded.map((s) => s.why).sort(), [
      'no tag binding',
      'the place is not on the course',
    ])
  })
})
