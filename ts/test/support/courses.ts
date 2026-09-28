/**
 * The synthetic courses, read the way a consumer would read them: decoded.
 *
 * Every course in `corpus/courses/` is drawn by `scripts/make-courses.ts` —
 * procedural, seeded, and in open sea off 0.5° N 0.5° E. Their vertices are
 * deliberately uneven (SPEC.md §2.2: a line has no spacing guarantee), so a
 * test that runs on one exercises the reader a real GPX would.
 */
import * as Schema from 'effect/Schema'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { CourseFile } from '../../src/index.ts'
import type { TCourseFile } from '../../src/index.ts'

const COURSES = join(import.meta.dirname, '../../../corpus/courses')
const decode = Schema.decodeUnknownSync(CourseFile)

/** The raw bytes of a course file — what a provenance digest is taken over. */
export const course_bytes = (id: string): string =>
  readFileSync(join(COURSES, `${id}.json`), 'utf8')

/** One course by id: `half-flat`, `half-hilly`, `marathon`, `trail-50k`, `ride-500k`, `loop-6720`, `road-44k`. */
export const course = (id: string): TCourseFile => decode(JSON.parse(course_bytes(id)))

/** Every course in the corpus, by id — `index.json` is the list, not a course. */
export const course_ids = (): ReadonlyArray<string> =>
  readdirSync(COURSES).flatMap((file) =>
    file.endsWith('.json') && file !== 'index.json' ? [file.slice(0, -'.json'.length)] : [],
  )
