/**
 * The JSON Schema of the two files a timing system writes — the course document
 * and an observation — and of the one an engine answers with, an entrant's
 * state, so a vendor in C#, Java or PHP can validate each with whatever draft
 * 2020-12 validator their platform already has, and none of this code.
 *
 * ```
 * node ts/scripts/make-schema.ts
 * ```
 *
 * ## Generated, never written
 *
 * Every file comes out of `Schema.toJsonSchemaDocument` over the same Effect
 * schemas `decode_document`, `decode_log` and `encode_state` use, so a law
 * added to `src/document.ts` reaches the JSON Schema on the next run and cannot
 * be forgotten there. `test/schema.test.ts` regenerates them in memory and
 * fails if the committed files differ.
 *
 * ## Three decisions the generator does not make on its own
 *
 * - **Open objects.** `additionalProperties: true`, where the generator's
 *   default is `false`. Both engines ignore members they do not know — Effect
 *   drops excess keys on decode, serde skips unknown fields — and GeoJSON gives
 *   every object foreign members (`bbox`, a feature's top-level `id`, a vendor's
 *   own). A closed schema would reject files both engines read.
 * - **The instant says what it is.** `Instant` (`src/kernel.ts`) is a checked
 *   string decoded to a `DateTime.Utc`, and the generator emits its encoded
 *   side: the string and its pattern, `YYYY-MM-DDTHH:MM:SS[.sss]Z` (SPEC.md
 *   §2.3). Every such node gains `format` and a description, and the build
 *   fails if a file that must carry an instant carries none — so the pattern
 *   cannot be lost to a change of schema without a red test. What no JSON
 *   Schema can say is the calendar: the pattern passes 30 February, and both
 *   engines refuse it.
 * - **The head.** `$schema`, `$id`, `title` and a `description` saying what the
 *   schema cannot see — the cross-document laws of SPEC.md §2.1 need an engine.
 *
 * @see SPEC.md §2.1 — the per-field laws this carries and the ones it cannot
 * @see test/schema.test.ts
 */
import * as JsonSchema from 'effect/JsonSchema'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { CourseDocument } from '../src/document.ts'
import { EntrantState } from '../src/fold.ts'
import { INSTANT_PATTERN } from '../src/kernel.ts'
import { Observation } from '../src/observe.ts'
import { render } from './render.ts'

export const OUT = join(import.meta.dirname, '../../schema')

/**
 * Where the schemas are published: the raw file on the default branch, so a
 * validator that dereferences `$id`, or a person who pastes it, gets the file.
 */
const BASE = 'https://raw.githubusercontent.com/turbotobias/pace-geojson/main/schema/'

export const DOCUMENT_FILE = 'document.schema.json'
export const OBSERVATION_FILE = 'observation.schema.json'
export const ENTRANT_STATE_FILE = 'entrant-state.schema.json'

const INSTANT: JsonSchema.JsonSchema = {
  type: 'string',
  format: 'date-time',
  pattern: INSTANT_PATTERN.source,
  description:
    'An instant in UTC: `2026-08-14T16:48:00.000Z`. Milliseconds optional, offset always `Z`, and a day ' +
    'that exists — which the pattern alone cannot check (SPEC.md §2.3).',
}

const DOCUMENT_HEAD = {
  title: 'pace-geojson course document',
  description:
    'One way in to one event — a distance, a category — as a GeoJSON FeatureCollection whose rules travel ' +
    'in `pace:` members (SPEC.md §2.1, §2.2). This schema carries the per-field laws: `pace-geojson` a ' +
    'whole number from 1, longitude in ' +
    '[-180, 180] and latitude in [-90, 90], a LineString of at least two positions, every `along_m`, ' +
    '`from_m` and `to_m` on a feature or a path slice at least 0, and `repeat` at least 1. It cannot carry ' +
    'the cross-document laws, which need an engine: no feature id used twice, every segment and path slice ' +
    'ending after it starts, a path naming only lines the document carries, at least one line, no place ' +
    'beyond the end of the path, every point a rule names present, and a rule requiring an observation only ' +
    'at a place that produces it. Nor does it read a rule’s `params`, which belong to its dialect, or know ' +
    'which kinds need a place (`station_required`, `qualifies_within`). A ' +
    'document this schema accepts can still be refused to run. Members not named here are allowed and ' +
    'ignored, like GeoJSON foreign members. A version other than 1 is a document this specification does ' +
    'not run: an engine refuses it and still draws it (SPEC.md §7). Generated from ts/src/document.ts by ts/scripts/make-schema.ts; ' +
    'do not edit by hand.',
}

const OBSERVATION_HEAD = {
  title: 'pace-geojson observation',
  description:
    'One thing a bridge saw: an entrant, at a place addressed by `along_m`, doing one of eight kinds of ' +
    'thing, at one UTC instant (SPEC.md §2.3). A log is a JSON array of these, and its ids are unique — a ' +
    'law of the log that needs an engine, as does whether `supersedes` names an observation that exists. ' +
    'Every nullable member is present, written `null`. Members not named here are allowed and ignored. ' +
    'Generated from ts/src/observe.ts by ts/scripts/make-schema.ts; do not edit by hand.',
}

const ENTRANT_STATE_HEAD = {
  title: 'pace-geojson entrant state',
  description:
    'One entrant’s day as an engine answers it (SPEC.md §4): what the rules made of the log, and never a ' +
    'placing. A finisher has `finished_at`; an entrant who started and did not finish has `started_at` and ' +
    'no `finished_at`, and `withdrew` says whether they said so; an entrant who never started is absent, ' +
    'because an engine’s entrants are the log’s. `total_ms` of a non-finisher runs to their last read and ' +
    'is not a time to rank. `applied` is every rule that fired, with its sentence. Generated from ' +
    'ts/src/fold.ts by ts/scripts/make-schema.ts; do not edit by hand.',
}

const is_record = (value: unknown): value is JsonSchema.JsonSchema =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A draft 2020-12 document with its head first and its definitions last, so the file reads top down. */
const emit = (
  schema: Schema.Constraint,
  file: string,
  head: { readonly title: string; readonly description: string },
): JsonSchema.JsonSchema => {
  const document = Schema.toJsonSchemaDocument(schema, { additionalProperties: true })
  return {
    $schema: JsonSchema.META_SCHEMA_URI_DRAFT_2020_12,
    $id: `${BASE}${file}`,
    title: head.title,
    description: head.description,
    ...document.schema,
    $defs: document.definitions,
  }
}

/** Is this node the instant as the generator emits it: a string and its pattern, nothing else? */
const is_instant = (node: JsonSchema.JsonSchema): boolean =>
  node['type'] === 'string' &&
  node['pattern'] === INSTANT_PATTERN.source &&
  Object.keys(node).every((key) => key === 'type' || key === 'pattern' || key === 'description')

/** Every instant node, anywhere in the tree, replaced by {@link INSTANT}; and how many there were. */
const pin = (value: unknown): { readonly value: unknown; readonly pinned: number } => {
  if (Array.isArray(value)) {
    const items = value.map(pin)
    return {
      value: items.map((i) => i.value),
      pinned: items.reduce((n, i) => n + i.pinned, 0),
    }
  }
  if (!is_record(value)) return { value, pinned: 0 }
  if (is_instant(value)) return { value: INSTANT, pinned: 1 }
  const members = Object.entries(value).map(([key, member]) => [key, pin(member)] as const)
  return {
    value: Object.fromEntries(members.map(([key, member]) => [key, member.value])),
    pinned: members.reduce((n, [, member]) => n + member.pinned, 0),
  }
}

/** A schema with its instants pinned, or why it carries fewer than it must. */
const pinned = (
  schema: JsonSchema.JsonSchema,
  file: string,
  instants: number,
): Result.Result<JsonSchema.JsonSchema, string> => {
  const { value, pinned: found } = pin(schema)
  return found === instants && is_record(value)
    ? Result.succeed(value)
    : Result.fail(
        `${file}: ${found} instant nodes where ${instants} were expected; re-read the pinning in make-schema.ts`,
      )
}

/** Every schema, by file name, or the reason one could not be made. */
export const build = (): Result.Result<Readonly<Record<string, JsonSchema.JsonSchema>>, string> =>
  Result.all({
    [DOCUMENT_FILE]: Result.succeed(emit(CourseDocument, DOCUMENT_FILE, DOCUMENT_HEAD)),
    // `t`.
    [OBSERVATION_FILE]: pinned(
      emit(Observation, OBSERVATION_FILE, OBSERVATION_HEAD),
      OBSERVATION_FILE,
      1,
    ),
    // `started_at` and `finished_at`.
    [ENTRANT_STATE_FILE]: pinned(
      emit(EntrantState, ENTRANT_STATE_FILE, ENTRANT_STATE_HEAD),
      ENTRANT_STATE_FILE,
      2,
    ),
  })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const built = build()
  if (Result.isFailure(built)) {
    process.stderr.write(`${built.failure}\n`)
    process.exitCode = 1
  } else {
    mkdirSync(OUT, { recursive: true })
    for (const [file, schema] of Object.entries(built.success)) {
      writeFileSync(join(OUT, file), render(schema))
      process.stdout.write(`${file}: ${Buffer.byteLength(render(schema))} bytes\n`)
    }
  }
}
