/**
 * A course document, end to end, on a whole course.
 *
 * A 6.72 km loop — the synthetic `loop-6720`, its line as drawn, heights and
 * all — becomes a document, the document becomes rules, an observation log is
 * folded against them, and a winner comes out.
 *
 * This is the test that says the pieces fit: `document.ts` → `pack.ts` →
 * `fold.ts`, with the file in the middle being ordinary GeoJSON that any tool
 * could open.
 *
 * @see src/document.ts
 * @see test/support/loop-course.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  fold,
  PACKS,
  total_ms,
  broken_laws,
  CourseDocument,
  decode_document,
  encode_document,
  path_length_m,
  plan,
  point_at,
  points_of,
  produces,
  Observation,
} from '../src/index.ts'
import type { TEntrantState, TObservation } from '../src/index.ts'
import { LOOP_COURSE } from './support/loop-course.ts'
import { course } from './support/courses.ts'

const LOOP = LOOP_COURSE.distance_m
const HOUR = 3_600_000
const LAPS = 4

/**
 * The document, written out by hand the way a producer would write it.
 *
 * Every lap is its own pair of places at its own `along_m`, which is the whole
 * trick: the kernel asks *"was there an observation here"* and a lap is a here.
 */
const document_json = {
  type: 'FeatureCollection',
  'pace-geojson': 1,
  'pace:id': 'crs_backyard_loop',
  'pace:event': 'evt_backyard_loop',
  'pace:way': 'way_backyard',
  'pace:name': LOOP_COURSE.name,
  'pace:dialects': ['backyard@1'],
  'pace:measure': {
    distance_m: LOOP_COURSE.distance_m,
    distance_method: 'mean-sphere-2d',
    stated_m: 6_706,
    certified_m: null,
    ascent_m: LOOP_COURSE.elevation_gain_m,
    descent_m: null,
    elevation_source: 'file',
    elevation_smoothing: null,
    ascent_threshold_m: null,
  },
  'pace:provenance': [
    {
      source: 'synthetic',
      origin_url: null,
      sha256: LOOP_COURSE.sha256,
      format: null,
      verified_by: null,
      verified_at: null,
    },
  ],
  'pace:path': [{ line: 'ln_loop', from_m: 0, to_m: LOOP, repeat: LAPS }],
  'pace:rules': [
    ...Array.from({ length: LAPS }, (_, i) => ({
      id: `rul_lap_${i + 1}`,
      dialect: 'backyard@1',
      kind: 'lap_within',
      ordinal: i,
      at: null,
      params: { within_ms: HOUR, from_m: i * LOOP, to_m: (i + 1) * LOOP, lap: i + 1 },
    })),
    {
      id: 'rul_last_standing',
      dialect: 'backyard@1',
      kind: 'last_standing',
      ordinal: 99,
      at: null,
      params: { award: 'last one standing' },
    },
  ],
  features: [
    {
      type: 'Feature',
      properties: { role: 'line', id: 'ln_loop', polyline: LOOP_COURSE.polyline },
      // The loop as drawn: every vertex, with its height, starting and ending
      // on the same coordinate. The spacing is uneven on purpose (SPEC.md §2.2).
      geometry: {
        type: 'LineString',
        coordinates: course('loop-6720').line.map(([lon, lat, ele]) =>
          ele === null ? [lon, lat] : [lon, lat, ele],
        ),
      },
    },
    // Every lap is its own pair of places at its own `along_m`. There is no
    // second copy of them anywhere in the document — the features *are* the
    // points, which is what stops a rule firing where the map does not draw.
    ...Array.from({ length: LAPS }, (_, i) => [
      {
        type: 'Feature',
        properties: {
          role: 'point',
          id: `lap-${i + 1}-start`,
          kind: 'corral',
          name: `Lap ${i + 1} corral`,
          along_m: i * LOOP,
        },
        geometry: {
          type: 'Point',
          coordinates: [...LOOP_COURSE.start],
        },
      },
      {
        type: 'Feature',
        properties: {
          role: 'point',
          id: `lap-${i + 1}-finish`,
          kind: 'mat',
          name: `Lap ${i + 1}`,
          along_m: (i + 1) * LOOP,
        },
        geometry: { type: 'Point', coordinates: [...LOOP_COURSE.end] },
      },
    ]).flat(),
  ],
}

const decode_obs = Schema.decodeUnknownSync(Observation)

/** One lap: into the corral on the hour, over the mat when it closes. */
const lap = (
  entrant: string,
  n: number,
  started: string,
  closed: string,
): ReadonlyArray<TObservation> => [
  decode_obs({
    id: `obs_${entrant}_${n}_start`,
    entrant: `ent_${entrant}`,
    at: { point: `lap-${n}-start`, along_m: (n - 1) * LOOP },
    kind: 'passed',
    t: started,
    quantity_name: null,
    quantity_value: null,
    flags: [],
    source: 'transponder',
    device: 'dev_mat_1',
    confidence: 1,
    supersedes: null,
  }),
  decode_obs({
    id: `obs_${entrant}_${n}_finish`,
    entrant: `ent_${entrant}`,
    at: { point: `lap-${n}-finish`, along_m: n * LOOP },
    kind: 'finished',
    t: closed,
    quantity_name: null,
    quantity_value: null,
    flags: [],
    source: 'transponder',
    device: 'dev_mat_1',
    confidence: 1,
    supersedes: null,
  }),
]

const start = (entrant: string, t: string): TObservation =>
  decode_obs({
    id: `obs_${entrant}_gun`,
    entrant: `ent_${entrant}`,
    at: { point: 'lap-1-start', along_m: 0 },
    kind: 'started',
    t,
    quantity_name: null,
    quantity_value: null,
    flags: [],
    source: 'manual',
    device: null,
    confidence: 1,
    supersedes: null,
  })

const of = (states: ReadonlyArray<TEntrantState>, entrant: string): TEntrantState => {
  const found = states.find((s) => s.entrant === `ent_${entrant}`)
  if (found === undefined) throw new Error(`no state for ${entrant}`)
  return found
}

describe('a course document', () => {
  const document = Result.getOrThrow(decode_document(document_json))

  it('is ordinary GeoJSON, and round-trips', () => {
    assert.strictEqual(document.type, 'FeatureCollection')
    const again = Result.getOrThrow(decode_document(encode_document(document)))
    assert.deepStrictEqual(again['pace:measure'], document['pace:measure'])
    assert.strictEqual(again['pace:rules'].length, LAPS + 1)
  })

  it('keeps the measurement’s own method beside the number', () => {
    const measure = document['pace:measure']
    assert.strictEqual(measure.distance_m, 6_720)
    assert.strictEqual(measure.distance_method, 'mean-sphere-2d')
    // Stated and measured are both kept. They are 14 m apart, which is well
    // inside tolerance and exactly the kind of thing that must not be silently
    // reconciled to one number.
    assert.strictEqual(measure.stated_m, 6_706)
    assert.isBelow(Math.abs((measure.distance_m ?? 0) - (measure.stated_m ?? 0)), 50)
  })

  it('types every feature by the role it plays', () => {
    // The question this answers: a GeoJSON `Feature` has a free-form
    // `properties`, so a schema that mirrors the spec accepts anything. Each
    // role here is pinned to the geometry it can actually have.
    const roles = document.features.map((f) => f.properties.role)
    assert.deepStrictEqual([...new Set(roles)], ['line', 'point'])
    assert.strictEqual(points_of(document).length, LAPS * 2)
    // A point whose geometry is a line is not a point.
    assert.isTrue(
      Result.isFailure(
        decode_document({
          ...document_json,
          features: [
            {
              type: 'Feature',
              properties: { role: 'point', id: 'p', kind: 'mat', name: null, along_m: 0 },
              geometry: {
                type: 'LineString',
                coordinates: [
                  [0, 0],
                  [1, 1],
                ],
              },
            },
          ],
        }),
      ),
    )
  })

  it('says how long the way in is from the playlist, not from the line', () => {
    // Four laps of one stored loop — one geometry, four entries.
    assert.strictEqual(path_length_m(document), LOOP * LAPS)
    assert.strictEqual(document['pace:path'].length, 1)
    // And every lap is its own place, which is what lets the kernel say a lap.
    assert.strictEqual(point_at(document, 'lap-3-finish'), LOOP * 3)
  })

  it('carries where it came from, so a copy that escapes still says so', () => {
    const [origin] = document['pace:provenance']
    assert.strictEqual(origin?.source, 'synthetic')
    // A synthetic course was never a file anybody published, so there is no
    // URL — but there is a file it was made from, and the digest names it.
    assert.isNull(origin?.origin_url)
    assert.strictEqual(origin?.sha256, LOOP_COURSE.sha256)
    assert.match(origin?.sha256 ?? '', /^[0-9a-f]{64}$/)
  })

  it('runs a race: three start, one is left', () => {
    const rules = Result.getOrThrow(plan(document, PACKS))
    assert.strictEqual(rules.length, LAPS + 1)

    const states = fold(rules, [
      // Ada closes all four.
      start('ada', '2026-08-14T16:00:00.000Z'),
      ...lap('ada', 1, '2026-08-14T16:00:00.000Z', '2026-08-14T16:48:00.000Z'),
      ...lap('ada', 2, '2026-08-14T17:00:00.000Z', '2026-08-14T17:51:00.000Z'),
      ...lap('ada', 3, '2026-08-14T18:00:00.000Z', '2026-08-14T18:54:00.000Z'),
      ...lap('ada', 4, '2026-08-14T19:00:00.000Z', '2026-08-14T19:58:00.000Z'),
      // Bo loses lap three by four minutes.
      start('bo', '2026-08-14T16:00:00.000Z'),
      ...lap('bo', 1, '2026-08-14T16:00:00.000Z', '2026-08-14T16:52:00.000Z'),
      ...lap('bo', 2, '2026-08-14T17:00:00.000Z', '2026-08-14T17:55:00.000Z'),
      ...lap('bo', 3, '2026-08-14T18:00:00.000Z', '2026-08-14T19:04:00.000Z'),
      // Cleo withdraws after two.
      start('cleo', '2026-08-14T16:00:00.000Z'),
      ...lap('cleo', 1, '2026-08-14T16:00:00.000Z', '2026-08-14T16:57:00.000Z'),
      ...lap('cleo', 2, '2026-08-14T17:00:00.000Z', '2026-08-14T17:59:00.000Z'),
      decode_obs({
        id: 'obs_cleo_out',
        entrant: 'ent_cleo',
        at: { point: 'lap-3-start', along_m: LOOP * 2 },
        kind: 'withdrew',
        t: '2026-08-14T18:00:00.000Z',
        quantity_name: null,
        quantity_value: null,
        flags: [],
        source: 'manual',
        device: null,
        confidence: 1,
        supersedes: null,
      }),
    ])

    assert.strictEqual(of(states, 'ada').laps, 4)
    assert.strictEqual(of(states, 'ada').standing, 'clean')
    assert.deepStrictEqual([...of(states, 'ada').awards], ['last one standing'])

    assert.strictEqual(of(states, 'bo').standing, 'gated')
    assert.include(
      of(states, 'bo')
        .applied.map((a) => a.sentence)
        .join(' '),
      'Closing lap 3 more than 1:00:00 after it starts ends the day.',
    )
    assert.deepStrictEqual([...of(states, 'bo').awards], [])

    assert.isTrue(of(states, 'cleo').withdrew)
    assert.deepStrictEqual([...of(states, 'cleo').awards], [])

    // Ada was out for 3:58 of wall clock across four laps and the corrals.
    assert.strictEqual(total_ms(of(states, 'ada')), 3 * HOUR + 58 * 60_000)
  })

  it('holds together: no law is broken', () => {
    assert.deepStrictEqual(broken_laws(document), [])
  })

  it('refuses a rule pointing at a mat the document does not carry', () => {
    // Decodes cleanly and is wrong in the way that matters: the rule never
    // fires, and the race is scored as though the gate were not there.
    const ghost = Result.getOrThrow(
      decode_document({
        ...document_json,
        'pace:rules': [
          {
            id: 'rul_ghost',
            dialect: 'backyard@1',
            kind: 'lap_within',
            ordinal: 7,
            at: { point: 'lap-99-finish', along_m: 10 },
            params: { within_ms: HOUR, from_m: 0, to_m: LOOP, lap: 1 },
          },
        ],
      }),
    )
    assert.deepStrictEqual(
      broken_laws(ghost).map((b) => b.law),
      ['a rule names a point the document does not carry'],
    )
    assert.isTrue(Result.isFailure(plan(ghost, PACKS)))
  })

  it('refuses a place beyond the end of the way in, and a duplicated id', () => {
    const beyond = Result.getOrThrow(
      decode_document({
        ...document_json,
        features: [
          ...document_json.features,
          {
            type: 'Feature',
            properties: {
              role: 'point',
              id: 'lap-1-finish',
              kind: 'mat',
              name: null,
              along_m: LOOP * 99,
            },
            geometry: {
              type: 'Point',
              coordinates: [...LOOP_COURSE.end],
            },
          },
        ],
      }),
    )
    assert.deepStrictEqual(
      broken_laws(beyond)
        .map((b) => b.law)
        .sort(),
      ['a feature id is used twice', 'a place is beyond the end of the course'],
    )
  })

  it('is stricter than GeoJSON where GeoJSON is permissive', () => {
    // Valid GeoJSON, refused here: the spec is an interchange format and lets
    // these through, and a file that decides who finished cannot.
    const off_the_earth = {
      ...document_json,
      features: [
        {
          ...document_json.features[0],
          geometry: {
            type: 'LineString',
            coordinates: [
              [0, 0],
              [400, 100],
            ],
          },
        },
      ],
    }
    assert.isTrue(Result.isFailure(decode_document(off_the_earth)))
    const backwards = {
      ...document_json,
      'pace:path': [{ line: 'ln_loop', from_m: 0, to_m: -5, repeat: 1 }],
    }
    assert.isTrue(Result.isFailure(decode_document(backwards)))
    const never_run = {
      ...document_json,
      'pace:path': [{ line: 'ln_loop', from_m: 0, to_m: LOOP, repeat: 0 }],
    }
    assert.isTrue(Result.isFailure(decode_document(never_run)))
  })

  it('is readable but not runnable when it names a dialect we do not ship', () => {
    const foreign = Result.getOrThrow(
      decode_document({ ...document_json, 'pace:dialects': ['backyard@1', 'curling@1'] }),
    )
    // The geometry is still there — a document always draws.
    assert.strictEqual(points_of(foreign).length, LAPS * 2)
    const planned = plan(foreign, PACKS)
    assert.isTrue(Result.isFailure(planned))
    if (Result.isFailure(planned)) {
      assert.deepStrictEqual([...planned.failure.missing_dialects], ['curling@1'])
    }
  })

  it('refuses the whole document when one rule will not compile', () => {
    const broken = Result.getOrThrow(
      decode_document({
        ...document_json,
        'pace:rules': [
          ...document_json['pace:rules'],
          {
            id: 'rul_bad',
            dialect: 'backyard@1',
            kind: 'lap_within',
            ordinal: 50,
            at: null,
            params: { lap: 'three' },
          },
        ],
      }),
    )
    const planned = plan(broken, PACKS)
    assert.isTrue(Result.isFailure(planned))
    if (Result.isFailure(planned)) {
      assert.deepStrictEqual(
        planned.failure.refused.map((r) => r.why),
        ['parameters do not fit'],
      )
    }
  })
})

describe('what a place produces', () => {
  it('answers from its own table, never from Object.prototype', () => {
    // A point's `kind` is free text in the file. Indexed into an object
    // literal, these four answered with functions; the Rust answers `passed`.
    for (const kind of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      assert.strictEqual(produces(kind), 'passed', kind)
    assert.strictEqual(produces('control'), 'punched')
    assert.strictEqual(produces('anything else'), 'passed')
  })

  it('says `passed` when it refuses a punch at a place of kind "constructor"', () => {
    const at_constructor = Result.getOrThrow(
      decode_document({
        ...document_json,
        'pace:dialects': ['backyard@1', 'athletics@1'],
        'pace:rules': [
          {
            id: 'rul_station',
            dialect: 'athletics@1',
            kind: 'station_required',
            ordinal: 0,
            at: { point: 'lap-1-finish', along_m: LOOP },
            params: { penalty_ms: 60_000, each_time: false },
          },
        ],
        features: document_json.features.map((f) =>
          f.properties.id === 'lap-1-finish'
            ? { ...f, properties: { ...f.properties, kind: 'constructor' } }
            : f,
        ),
      }),
    )
    const planned = plan(at_constructor, PACKS)
    assert.isTrue(Result.isFailure(planned))
    if (Result.isFailure(planned))
      assert.deepStrictEqual(planned.failure.broken, [
        {
          law: 'a rule requires an observation the place never produces',
          what: 'rul_station wants punched at lap-1-finish, a constructor which produces passed',
        },
      ])
  })
})

describe('pace-geojson', () => {
  it('is a whole number from 1, or the file is not a document', () => {
    for (const version of [1.5, 0, -1, '1'])
      assert.isTrue(
        Result.isFailure(decode_document({ ...document_json, 'pace-geojson': version })),
        String(version),
      )
  })

  it('draws a version this build does not run, and refuses to run it by name', () => {
    const later = Result.getOrThrow(decode_document({ ...document_json, 'pace-geojson': 2 }))
    assert.strictEqual(points_of(later).length, LAPS * 2)
    const planned = plan(later, PACKS)
    assert.isTrue(Result.isFailure(planned))
    if (Result.isFailure(planned)) {
      assert.strictEqual(planned.failure.unknown_version, 2)
      assert.deepStrictEqual(planned.failure.broken, [])
    }
    const current = plan(Result.getOrThrow(decode_document(document_json)), PACKS)
    assert.isTrue(Result.isSuccess(current))
  })
})

describe('CourseDocument', () => {
  it('refuses a document that is not one, rather than half-decoding it', () => {
    assert.isTrue(Result.isFailure(decode_document({ type: 'Feature' })))
    assert.isTrue(
      Result.isFailure(
        decode_document({ ...document_json, 'pace:measure': { distance_m: 'far' } }),
      ),
    )
  })

  it('is the schema, not a parallel type', () => {
    // The one thing that must never drift: what `plan` reads is what `decode`
    // produced, from one declaration.
    assert.isDefined(CourseDocument.fields['pace:rules'])
    assert.isDefined(CourseDocument.fields['pace:measure'])
  })
})
