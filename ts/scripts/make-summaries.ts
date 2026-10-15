/**
 * Summary cases: a document built from a synthetic course, and the summary
 * this implementation reads off it (`summary_of`).
 *
 * The same contract as `make-conformance.ts`: the expected summary is not
 * asserted to be right, it is asserted to be what the reference produces,
 * which is what a second implementation has to meet. The Rust engine reads the
 * same files (`rust/tests/summary.rs`), so a list row, a map and a share card
 * say one course the same way in either language.
 *
 * Each case varies one thing a reader can get wrong: laps of one line, a line
 * with no heights, ground that covers the course and ground that does not, a
 * material outside the family, a long ride, another number of steps.
 *
 * Heights are written in rows of eight. A formatter packs a long list of bare
 * numbers several to a line and this repository's renderer does not, so a list
 * of forty-eight would be laid out two ways; rows of eight are laid out one.
 *
 * ```
 * node ts/scripts/make-summaries.ts
 * ```
 *
 * @see src/summary.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Result from 'effect/Result'

import {
  document_of,
  encode_document,
  laps_along,
  summary_of,
  SUMMARY_HEIGHTS,
  type TCourseFile,
  type TPlaceSpec,
  type TSegmentSpec,
} from '../src/index.ts'
import { course } from '../test/support/courses.ts'
import { render } from './render.ts'

const OUT = join(import.meta.dirname, '../../corpus/summary')

/** A course's places: a start, a water stop at the middle, a finish. */
const places_of = (file: TCourseFile): ReadonlyArray<TPlaceSpec> => [
  { id: 'start', kind: 'start', name: 'Start', along_m: 0 },
  { id: 'water', kind: 'aid', name: 'Water', along_m: Math.round(file.drawn_m / 2) },
  { id: 'finish', kind: 'finish', name: 'Finish', along_m: file.drawn_m },
]

/** Ground in thirds of `length_m`, with these kinds. */
const thirds = (
  length_m: number,
  kinds: readonly [string, string, string],
): ReadonlyArray<TSegmentSpec> => {
  const a = Math.round(length_m / 3)
  const b = Math.round((2 * length_m) / 3)
  return [
    { id: 'surface-1', kind: kinds[0], name: null, from_m: 0, to_m: a },
    { id: 'surface-2', kind: kinds[1], name: null, from_m: a, to_m: b },
    { id: 'surface-3', kind: kinds[2], name: null, from_m: b, to_m: length_m },
  ]
}

type TCase = {
  readonly name: string
  readonly why: string
  readonly file: TCourseFile
  readonly repeat?: number
  readonly places?: ReadonlyArray<TPlaceSpec>
  readonly segments?: ReadonlyArray<TSegmentSpec>
  readonly steps?: number
}

const flat = course('half-flat')
const loop = course('loop-6720')

const CASES: ReadonlyArray<TCase> = [
  {
    name: 'marathon-ground-in-thirds',
    why: 'one line run once; ground that covers it, an inferred stretch drawn as its material',
    file: course('marathon'),
    segments: thirds(course('marathon').drawn_m, [
      'surface:paved',
      'surface:trail:inferred',
      'surface:gravel',
    ]),
  },
  {
    name: 'half-hilly-no-ground',
    why: 'heights that climb and fall; no surface segments, so no ground',
    file: course('half-hilly'),
  },
  {
    name: 'trail-50k-a-material-outside-the-family',
    why: 'a material the family does not name is unknown; a segment that is not ground is not ground',
    file: course('trail-50k'),
    segments: [
      ...thirds(course('trail-50k').drawn_m, ['surface:trail', 'surface:moss', 'surface:trail']),
      { id: 'the-wall', kind: 'climb', name: 'The wall', from_m: 20_000, to_m: 21_000 },
    ],
  },
  {
    name: 'loop-6720-three-laps',
    why: 'one line run three times: every lap the same heights, the ground covering all three',
    file: loop,
    repeat: 3,
    places: laps_along(loop.drawn_m, 3),
    segments: thirds(loop.drawn_m * 3, ['surface:paved', 'surface:paved', 'surface:track']),
  },
  {
    name: 'half-flat-no-heights',
    why: 'a line whose positions carry no height has no heights, whatever its measure says',
    file: {
      ...flat,
      line: flat.line.map(([lon, lat, , along]) => [lon, lat, null, along] as const),
    },
  },
  {
    name: 'road-44k-ground-with-a-gap',
    why: 'ground that leaves a gap is a promise broken: nothing is said of the ground',
    file: course('road-44k'),
    segments: [
      { id: 'surface-1', kind: 'surface:paved', name: null, from_m: 0, to_m: 10_000 },
      {
        id: 'surface-2',
        kind: 'surface:paved',
        name: null,
        from_m: 11_000,
        to_m: course('road-44k').drawn_m,
      },
    ],
  },
  {
    name: 'ride-500k',
    why: 'a long ride: vertices kilometres apart, heights laid on the document’s own metres',
    file: course('ride-500k'),
  },
  {
    name: 'half-flat-twelve-steps',
    why: 'another number of steps: twelve heights, the first at the start and the last at the finish',
    file: flat,
    steps: 12,
  },
]

mkdirSync(OUT, { recursive: true })
for (const each of CASES) {
  const repeat = each.repeat ?? 1
  const built = document_of(each.file, {
    id: `crs_${each.name}`,
    event: 'evt_summary',
    way: null,
    name: each.file.name,
    dialects: [],
    places: each.places ?? places_of(each.file),
    rules: [],
    repeat,
    stated_m: Math.round(each.file.distance_m * repeat),
    segments: each.segments,
  })
  if (Result.isFailure(built)) {
    process.stderr.write(`${each.name}: the course did not build a document\n`)
    process.exitCode = 1
    continue
  }
  const steps = each.steps ?? SUMMARY_HEIGHTS
  const summary = summary_of(built.success, steps)
  const rows: Array<ReadonlyArray<number>> = []
  for (let i = 0; i < summary.heights.length; i += 8) rows.push(summary.heights.slice(i, i + 8))
  writeFileSync(
    join(OUT, `${each.name}.json`),
    render({
      name: each.name,
      why: each.why,
      /* Generated: what the reference reads off the document, which is the contract. */
      steps,
      document: encode_document(built.success),
      expect: { ...summary, heights: rows },
    }),
  )
  process.stdout.write(
    `${each.name}: ${summary.heights.length} heights, ${summary.ground.length} stretches, ${summary.places.length} places\n`,
  )
}
