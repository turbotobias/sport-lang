/**
 * A course file, assembled into a document, and run.
 *
 * The fixtures are whole course files — the synthetic marathon and the 6.72 km
 * loop — with every vertex and its own `along_m`, spaced the uneven way a GPX
 * is (SPEC.md §2.2). A builder tested against a two-point line proves it can
 * handle two points.
 *
 * @see src/build.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'

import {
  at_along,
  document_of,
  DocumentRule,
  fold,
  laps_along,
  mats_along,
  PACKS,
  ROAD,
  simulate,
  broken_laws,
  path_length_m,
  plan,
  points_of,
} from '../src/index.ts'
import type { TFieldConfig } from '../src/index.ts'
import { course, course_ids } from './support/courses.ts'

const MARATHON = course('marathon')
const LOOP = course('loop-6720')
const rule = Schema.decodeUnknownSync(DocumentRule)
const START = Schema.decodeSync(Schema.DateTimeUtcFromString)('2027-06-21T18:30:00.000Z')
const config = (over: Partial<TFieldConfig> = {}): TFieldConfig => ({
  ...ROAD,
  start_at: START,
  ...over,
})

describe('at_along', () => {
  it('lands on the ends, and moves monotonically between them', () => {
    const first = MARATHON.line[0]
    const last = MARATHON.line[MARATHON.line.length - 1]
    assert.isDefined(first)
    assert.isDefined(last)
    assert.closeTo(at_along(MARATHON.line, 0)[0], first?.[0] ?? 0, 1e-6)
    assert.closeTo(at_along(MARATHON.line, MARATHON.drawn_m)[1], first?.[1] ?? 0, 1e-6)
    // Halfway along is neither end, and is on the course: inside the box the
    // line's own vertices draw.
    const half = at_along(MARATHON.line, MARATHON.drawn_m / 2)
    assert.notStrictEqual(half[0], first?.[0])
    assert.notStrictEqual(half[0], last?.[0])
    const lons = MARATHON.line.map((p) => p[0])
    const lats = MARATHON.line.map((p) => p[1])
    assert.isAtLeast(half[0], Math.min(...lons))
    assert.isAtMost(half[0], Math.max(...lons))
    assert.isAtLeast(half[1], Math.min(...lats))
    assert.isAtMost(half[1], Math.max(...lats))
  })

  it('interpolates between the vertices it falls between, however far apart', () => {
    // The widest gap on the line: a straight, where a GPX runs long between
    // vertices. A reader that stepped by vertex count would land somewhere else.
    const gaps = MARATHON.line
      .slice(1)
      .map((p, i) => ({ i, m: p[3] - (MARATHON.line[i]?.[3] ?? 0) }))
    const widest = gaps.reduce((a, b) => (b.m > a.m ? b : a))
    const a = MARATHON.line[widest.i]
    const b = MARATHON.line[widest.i + 1]
    if (a === undefined || b === undefined) return assert.fail('no widest gap')
    assert.isAbove(widest.m, 500)
    const mid = at_along(MARATHON.line, (a[3] + b[3]) / 2)
    assert.closeTo(mid[0], (a[0] + b[0]) / 2, 1e-6)
    assert.closeTo(mid[1], (a[1] + b[1]) / 2, 1e-6)
  })

  it('wraps past the end, because a lap is another go at the same line', () => {
    const one = at_along(LOOP.line, 1_000)
    const two = at_along(LOOP.line, LOOP.drawn_m + 1_000)
    const three = at_along(LOOP.line, 2 * LOOP.drawn_m + 1_000)
    assert.closeTo(two[0], one[0], 1e-9)
    assert.closeTo(two[1], one[1], 1e-9)
    assert.closeTo(three[0], one[0], 1e-9)
    assert.strictEqual(two[2], one[2])
    // And 1 km in is not the start: the wrap is doing something.
    assert.notStrictEqual(one[0], LOOP.line[0]?.[0])
  })

  it('carries the height, so a profile and a position agree', () => {
    // Between the two vertices that bracket 21 km, the height is between
    // theirs — interpolated, not borrowed from the nearest.
    const after = MARATHON.line.findIndex((p) => p[3] > 21_000)
    const a = MARATHON.line[after - 1]
    const b = MARATHON.line[after]
    if (a === undefined || b === undefined || a[2] === null || b[2] === null) {
      return assert.fail('no heights around 21 km')
    }
    const at = at_along(MARATHON.line, 21_000)
    assert.isNotNull(at[2])
    assert.isAtLeast(at[2] ?? -1, Math.min(a[2], b[2]) - 1e-9)
    assert.isAtMost(at[2] ?? -1, Math.max(a[2], b[2]) + 1e-9)
    // A course that climbs has heights that differ somewhere.
    assert.isTrue(MARATHON.line.some((p) => p[2] !== MARATHON.line[0]?.[2]))
  })
})

describe('the course corpus', () => {
  it('decodes, every file of it, as a CourseFile named for its file', () => {
    const ids = course_ids()
    assert.isAbove(ids.length, 0)
    for (const id of ids) assert.strictEqual(course(id).id, id)
  })
})

describe('a document built from a course file', () => {
  it('is a marathon with mats every 5 km, and it holds together', () => {
    const built = document_of(MARATHON, {
      id: 'crs_marathon',
      event: 'evt_marathon',
      way: null,
      name: MARATHON.name,
      dialects: ['athletics@1'],
      places: mats_along(MARATHON.drawn_m, 1, 5_000),
      rules: [
        rule({
          id: 'rul_cutoff',
          dialect: 'athletics@1',
          kind: 'cutoff_within',
          ordinal: 0,
          at: null,
          params: { within_ms: 6 * 3_600_000 },
        }),
      ],
      repeat: 1,
      stated_m: 42_195,
    })
    assert.isTrue(Result.isSuccess(built))
    if (Result.isFailure(built)) return
    const document = built.success

    assert.deepStrictEqual(broken_laws(document), [])
    assert.strictEqual(path_length_m(document), MARATHON.drawn_m)
    // Start, finish, and a mat every 5 km over a 42.0 km course.
    const places = points_of(document)
    assert.strictEqual(
      places.filter((p) => p.kind === 'mat').length,
      Math.floor((MARATHON.drawn_m - 2_500) / 5_000),
    )
    assert.strictEqual(places.filter((p) => p.kind === 'start').length, 1)
    assert.strictEqual(places.filter((p) => p.kind === 'finish').length, 1)
    assert.strictEqual(document['sport:measure'].distance_m, MARATHON.distance_m)
    assert.strictEqual(document['sport:measure'].stated_m, 42_195)
    // The method is the course file's own, carried through rather than assumed.
    assert.strictEqual(document['sport:measure'].distance_method, 'mean-sphere-2d')
    // The provenance says what the course is: synthetic, so no URL, no digest
    // of an original, and no file format — it was never a file anybody published.
    const [origin] = document['sport:provenance']
    assert.strictEqual(origin?.source, 'synthetic')
    assert.isNull(origin?.origin_url)
    assert.isNull(origin?.sha256)
    assert.isNull(origin?.format)
  })

  it('runs a field over it, and the rules judge them', () => {
    const built = document_of(MARATHON, {
      id: 'crs_marathon',
      event: 'evt_marathon',
      way: null,
      name: MARATHON.name,
      dialects: ['athletics@1'],
      places: mats_along(MARATHON.drawn_m, 1, 5_000),
      rules: [
        rule({
          id: 'rul_cutoff',
          dialect: 'athletics@1',
          kind: 'cutoff_within',
          ordinal: 0,
          at: null,
          params: { within_ms: 4 * 3_600_000 },
        }),
      ],
      repeat: 1,
      stated_m: 42_195,
    })
    if (Result.isFailure(built)) return assert.fail('did not build')
    const rules = Result.getOrThrow(plan(built.success, PACKS))
    // A four-hour cut-off over a marathon: the middle of a 5:30/km field
    // is inside it and the tail is not, which is what a cut-off is for.
    const states = fold(
      rules,
      simulate(built.success, config({ entrants: 200, seed: 5, pace_s_per_km: 330, dnf: 0 })),
    )
    assert.strictEqual(states.length, 200)
    assert.isAbove(states.filter((s) => s.standing === 'clean').length, 0)
    assert.isAbove(states.filter((s) => s.standing === 'gated').length, 0)
  })

  it('turns the backyard loop into four laps over one stored line', () => {
    const built = document_of(LOOP, {
      id: 'crs_loop',
      event: 'evt_loop',
      way: null,
      name: LOOP.name,
      dialects: ['backyard@1'],
      places: laps_along(LOOP.drawn_m, 4),
      rules: [],
      repeat: 4,
      stated_m: null,
    })
    if (Result.isFailure(built)) return assert.fail('did not build')
    const document = built.success
    assert.deepStrictEqual(broken_laws(document), [])
    // One geometry, four laps of it.
    assert.strictEqual(document['sport:path'].length, 1)
    assert.strictEqual(document['sport:path'][0]?.repeat, 4)
    assert.strictEqual(path_length_m(document), LOOP.drawn_m * 4)
    assert.strictEqual(points_of(document).length, 8)
    // And every lap's places are on the same piece of road.
    const first = points_of(document).find((p) => p.id === 'lap-1-finish')
    const fourth = points_of(document).find((p) => p.id === 'lap-4-start')
    assert.closeTo(first?.lon ?? 0, fourth?.lon ?? 1, 1e-9)
  })
})

describe('provenance, when the course file came from somewhere', () => {
  // The synthetic corpus has no original, so its provenance is all nulls. A
  // course read from a published file carries a URL and a digest, and the
  // builder infers what it can from them when the caller does not say.
  const published = (origin_url: string) => ({
    id: MARATHON.id,
    name: MARATHON.name,
    race: MARATHON.race,
    country: MARATHON.country,
    discipline: MARATHON.discipline,
    origin_url,
    sha256: 'a'.repeat(64),
    distance_m: MARATHON.distance_m,
    drawn_m: MARATHON.drawn_m,
    elevation_gain_m: MARATHON.elevation_gain_m,
    points_original: MARATHON.points_original,
    line: MARATHON.line,
  })
  const options = {
    id: 'crs_published',
    event: 'evt_published',
    way: null,
    name: 'A published course',
    dialects: ['athletics@1'],
    places: mats_along(MARATHON.drawn_m, 1, 5_000),
    rules: [],
    repeat: 1,
    stated_m: null,
  }
  const origin = (origin_url: string) => {
    const built = document_of(published(origin_url), options)
    if (Result.isFailure(built)) return assert.fail('did not build')
    return {
      provenance: built.success['sport:provenance'][0],
      method: built.success['sport:measure'].distance_method,
    }
  }

  it('says gpx for a GPX and fit for a FIT, and keeps the URL and digest it was handed', () => {
    const gpx = origin('https://example.org/course.gpx')
    assert.strictEqual(gpx?.provenance?.format, 'gpx')
    // Where a file is hosted is not where it came from: nobody said, so it says so.
    assert.strictEqual(gpx?.provenance?.source, 'unstated')
    assert.strictEqual(gpx?.provenance?.origin_url, 'https://example.org/course.gpx')
    assert.strictEqual(gpx?.provenance?.sha256, 'a'.repeat(64))
    assert.strictEqual(origin('https://example.org/course.fit')?.provenance?.format, 'fit')
  })

  it('falls back to the geodesic method when the file does not name one', () => {
    assert.strictEqual(origin('https://example.org/course.gpx')?.method, 'wgs84-geodesic-2d')
  })
})
