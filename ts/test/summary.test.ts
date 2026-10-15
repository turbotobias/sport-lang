/**
 * A course at a glance, read from its document alone.
 *
 * The corpus's courses carry each vertex's distance in the file; the document
 * made from them does not (SPEC.md §2.2), so the summary has to find it again
 * from the geometry. These tests hold it to the file's own answer.
 *
 * @see src/summary.ts
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  alongs_m,
  at_along,
  CourseDocument,
  DocumentSummary,
  document_of,
  geodesic_m,
  laps_along,
  summary_of,
  SUMMARY_HEIGHTS,
  type TCourseDocument,
  type TCourseFile,
  type TSegmentSpec,
} from '../src/index.ts'
import { course } from './support/courses.ts'

const built = (
  file: TCourseFile,
  over: { readonly repeat?: number; readonly segments?: ReadonlyArray<TSegmentSpec> } = {},
): TCourseDocument => {
  const repeat = over.repeat ?? 1
  const document = document_of(file, {
    id: `crs_${file.id}`,
    event: 'evt_summary',
    way: null,
    name: file.name,
    dialects: [],
    places:
      repeat > 1
        ? laps_along(file.drawn_m, repeat)
        : [
            { id: 'start', kind: 'start', name: 'Start', along_m: 0 },
            { id: 'aid-1', kind: 'aid', name: 'Water', along_m: Math.round(file.drawn_m / 2) },
            { id: 'finish', kind: 'finish', name: 'Finish', along_m: file.drawn_m },
          ],
    rules: [],
    repeat,
    stated_m: null,
    segments: over.segments,
  })
  if (Result.isFailure(document)) return assert.fail(`${file.id} did not build`)
  return document.success
}

describe('the geodesic', () => {
  it('measures on the WGS84 ellipsoid, as the format does', () => {
    // Vincenty's own test line: Flinders Peak to Buninyong, 54 972.271 m.
    const flinders = [144.42486788888888, -37.95103341666667] as const
    const buninyong = [143.92649552777777, -37.65282113888889] as const
    assert.closeTo(geodesic_m(flinders, buninyong), 54_972.271, 0.001)
    // A degree of latitude at the equator is not a degree on a sphere.
    assert.closeTo(geodesic_m([0, 0], [0, 1]), 110_574.389, 0.01)
    assert.strictEqual(geodesic_m([10.75, 59.91], [10.75, 59.91]), 0)
    assert.deepStrictEqual(alongs_m([[0, 0]]), [0])
  })

  it("lays a line's steps within a millimetre a kilometre of the ellipsoid's own answer", () => {
    for (const id of ['marathon', 'ride-500k', 'trail-50k', 'loop-6720']) {
      const line = course(id).line.map(([lon, lat]) => [lon, lat] as const)
      const along = alongs_m(line)
      let exact = 0
      for (const [i, here] of line.entries()) {
        const before = line[i - 1]
        if (before !== undefined) exact += geodesic_m(before, here)
      }
      const total = along[along.length - 1] ?? 0
      assert.closeTo(total, exact, (exact / 1000) * 0.001, id)
    }
    // A step longer than the local radii are good for is measured whole.
    assert.closeTo(
      alongs_m([
        [0, 0],
        [0, 1],
      ])[1] ?? 0,
      110_574.389,
      0.01,
    )
  })
})

describe('summary_of', () => {
  it("lays the line's heights at even steps, where the file says they are", () => {
    for (const id of ['half-hilly', 'trail-50k', 'marathon']) {
      const file = course(id)
      const summary = summary_of(built(file))
      assert.strictEqual(summary.length_m, file.drawn_m, id)
      assert.lengthOf(summary.heights, SUMMARY_HEIGHTS, id)
      // The file's own distances are a sphere's and the summary's the
      // ellipsoid's, laid on one length: they place a vertex a few tenths of
      // a percent apart, which on a steep trail is metres of height. So each
      // height is the file's somewhere within half a percent of the step.
      for (const [step, height] of summary.heights.entries()) {
        const along = (file.drawn_m * step) / (SUMMARY_HEIGHTS - 1)
        const near = Array.from({ length: 21 }, (_, i) =>
          Math.min(
            Math.max(along + ((i - 10) / 10) * 0.005 * file.drawn_m, 0),
            file.drawn_m - 1e-6,
          ),
        ).map((m) => at_along(file.line, m)[2] ?? 0)
        assert.isAtLeast(height, Math.min(...near) - 0.5, `${id} at ${Math.round(along)} m`)
        assert.isAtMost(height, Math.max(...near) + 0.5, `${id} at ${Math.round(along)} m`)
      }
    }
  })

  it('reads laps of one line as laps: every lap the same heights', () => {
    const file = course('loop-6720')
    const summary = summary_of(built(file, { repeat: 4 }), 4 * 12 + 1)
    assert.strictEqual(summary.length_m, file.drawn_m * 4)
    // Step 12 is the end of the first lap, 24 of the second: one place.
    for (const step of [0, 3, 7]) {
      assert.closeTo(
        summary.heights[step] ?? 0,
        summary.heights[step + 12] ?? 1,
        0.2,
        `step ${step}`,
      )
      assert.closeTo(
        summary.heights[step] ?? 0,
        summary.heights[step + 36] ?? 1,
        0.2,
        `step ${step}`,
      )
    }
  })

  it('places a vertex by the ground it covers, not by its index', () => {
    // Up a straight hill, the vertices bunched in the first tenth: a reader
    // that counted them evenly would put the summit nine tenths too early.
    const line: Array<readonly [number, number, number, number]> = []
    const vertices = [0, 0.02, 0.04, 0.06, 0.08, 0.1, 1]
    for (const share of vertices) line.push([10 + share * 0.1, 60, share * 100, 0])
    const file: TCourseFile = {
      id: 'bunched',
      name: 'Bunched',
      race: 'Bunched',
      country: 'NO',
      discipline: 'running',
      origin_url: null,
      sha256: null,
      distance_m: 5_570,
      drawn_m: 5_570,
      elevation_gain_m: 100,
      points_original: vertices.length,
      line,
    }
    const heights = summary_of(built(file), 11).heights
    assert.deepStrictEqual(
      heights.map((h) => Math.round(h)),
      [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100],
    )
  })

  it('says no heights for a line without them, and the climb only as the measure says it', () => {
    const file = course('half-flat')
    const flat: TCourseFile = {
      ...file,
      line: file.line.map(([lon, lat, , along]) => [lon, lat, null, along]),
    }
    const summary = summary_of(built(flat))
    assert.deepStrictEqual(summary.heights, [])
    assert.strictEqual(summary.ascent_m, built(flat)['pace:measure'].ascent_m)
  })

  it('reads the ground from the surface segments, when they cover the course', () => {
    const file = course('half-flat')
    const length = file.drawn_m
    const covered = summary_of(
      built(file, {
        segments: [
          { id: 's1', kind: 'surface:paved', name: null, from_m: 0, to_m: 5_000 },
          { id: 's2', kind: 'surface:paved:inferred', name: null, from_m: 5_000, to_m: 9_000 },
          { id: 's3', kind: 'surface:gravel', name: null, from_m: 9_000, to_m: 12_000 },
          { id: 's4', kind: 'surface:moss', name: null, from_m: 12_000, to_m: length },
          { id: 'hill', kind: 'climb', name: 'The hill', from_m: 2_000, to_m: 3_000 },
        ],
      }),
    )
    // `:inferred` is the same ground drawn, joined to its neighbour; a material
    // outside the family is unknown; a segment that is not ground is not ground.
    assert.deepStrictEqual(covered.ground, [
      [0, 9_000, 'paved'],
      [9_000, 12_000, 'gravel'],
      [12_000, length, 'unknown'],
    ])
    // A gap is a writer's promise broken: nothing is said of the ground.
    const gapped = summary_of(
      built(file, {
        segments: [
          { id: 's1', kind: 'surface:paved', name: null, from_m: 0, to_m: 5_000 },
          { id: 's2', kind: 'surface:trail', name: null, from_m: 6_000, to_m: length },
        ],
      }),
    )
    assert.deepStrictEqual(gapped.ground, [])
    assert.deepStrictEqual(summary_of(built(file)).ground, [])
  })

  it('lists the places, nearest the start first', () => {
    const summary = summary_of(built(course('half-flat')))
    assert.deepStrictEqual(
      summary.places.map((place) => [place.id, place.kind]),
      [
        ['start', 'start'],
        ['aid-1', 'aid'],
        ['finish', 'finish'],
      ],
    )
  })
})

describe('the summary corpus', () => {
  // `corpus/summary/` is what this implementation reads off each document,
  // written by `ts/scripts/make-summaries.ts`; the Rust engine reads the same
  // files. A change here that moves a number is a change to both engines.
  const CORPUS = join(import.meta.dirname, '../../corpus/summary')
  const Case = Schema.Struct({
    name: Schema.String,
    steps: Schema.Int,
    document: CourseDocument,
    expect: Schema.Struct({
      ...DocumentSummary.fields,
      heights: Schema.Array(Schema.Array(Schema.Finite)),
    }),
  })
  const cases = readdirSync(CORPUS)
    .filter((file) => file.endsWith('.json'))
    .map((file) =>
      Schema.decodeUnknownSync(Case)(JSON.parse(readFileSync(join(CORPUS, file), 'utf8'))),
    )

  it('has its eight cases', () => assert.lengthOf(cases, 8))

  for (const each of cases) {
    it(each.name, () => {
      const said = summary_of(each.document, each.steps)
      assert.deepStrictEqual(said, { ...each.expect, heights: each.expect.heights.flat() })
    })
  }
})
