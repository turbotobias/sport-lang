/**
 * The JSON Schema, held to the engine it is generated from.
 *
 * Two promises, and a test for each:
 *
 * - **It never drifts.** The committed files are regenerated in memory and
 *   compared byte for byte, so a law added to `src/document.ts` without
 *   `node ts/scripts/make-schema.ts` fails here rather than shipping a schema
 *   that is quietly weaker than the engine.
 * - **It says what the engine says, per field.** Every decode case is validated
 *   against the committed `document.schema.json`, read the way a vendor reads
 *   it: as JSON, through a draft 2020-12 importer, never through the Effect
 *   schema it came from. The importer is Effect's own
 *   `SchemaRepresentation.fromJsonSchemaDocument` — the one validator available
 *   here without a dependency — and it is fed the file, not the source schema.
 *   The schema must reject exactly the `rejects` cases, and must accept every
 *   `refuses` case: those break a cross-document law, which SPEC.md §2.1 says
 *   needs an engine, and a schema that rejected them would be claiming more
 *   than it can see.
 *
 * @see scripts/make-schema.ts
 * @see SPEC.md §2.1
 */
import { assert, describe, it } from '@effect/vitest'
import * as JsonSchema from 'effect/JsonSchema'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as SchemaRepresentation from 'effect/SchemaRepresentation'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import {
  build,
  DOCUMENT_FILE,
  ENTRANT_STATE_FILE,
  OBSERVATION_FILE,
  OUT,
} from '../scripts/make-schema.ts'
import { render } from '../scripts/render.ts'
import { decode_document } from '../src/document.ts'
import { PACKS, run } from '../src/index.ts'

const DECODE = join(import.meta.dirname, '../../corpus/decode')
const CONFORMANCE = join(import.meta.dirname, '../../corpus/conformance')

const json_files = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()

/** A committed schema, imported as JSON: what a vendor's validator would see. */
const validator = (file: string) => {
  const raw: JsonSchema.JsonSchema = JSON.parse(readFileSync(join(OUT, file), 'utf8'))
  const imported = SchemaRepresentation.fromJsonSchemaDocument(
    JsonSchema.fromSchemaDraft2020_12(raw),
    // Our own file, so its one pattern (the instant) is trusted and applied.
    { patterns: 'apply' },
  )
  // `is`, not a decode: an imported JSON Schema has no transformations, so its
  // type side is its JSON side, and `is` needs no decoding services.
  const is = Schema.is(imported)
  return (value: unknown): boolean => is(value)
}

const valid_document = validator(DOCUMENT_FILE)
const valid_observation = validator(OBSERVATION_FILE)
const valid_state = validator(ENTRANT_STATE_FILE)

const Verdict = Schema.Literals(['accepts', 'rejects', 'refuses'])
const DecodeCase = Schema.Struct({
  name: Schema.String,
  expect: Schema.Struct({
    verdict: Verdict,
    log: Schema.optionalKey(Schema.Struct({ verdict: Verdict })),
  }),
  document: Schema.Unknown,
  log: Schema.optionalKey(Schema.Array(Schema.Unknown)),
})
const ConformanceCase = Schema.Struct({
  name: Schema.String,
  document: Schema.Unknown,
  log: Schema.Array(Schema.Unknown),
})
const Json = Schema.Record(Schema.String, Schema.Unknown)

const read = <S extends Schema.Top & { readonly DecodingServices: never }>(
  schema: S,
  path: string,
) => Schema.decodeUnknownSync(schema)(JSON.parse(readFileSync(path, 'utf8')))

describe('the JSON Schema', () => {
  it('is what the generator makes, byte for byte', () => {
    const built = build()
    assert.isTrue(Result.isSuccess(built), Result.isFailure(built) ? built.failure : '')
    if (Result.isFailure(built)) return
    assert.deepStrictEqual(Object.keys(built.success).sort(), [
      DOCUMENT_FILE,
      ENTRANT_STATE_FILE,
      OBSERVATION_FILE,
    ])
    for (const [file, schema] of Object.entries(built.success)) {
      assert.strictEqual(
        readFileSync(join(OUT, file), 'utf8'),
        render(schema),
        `${file} is stale — run node ts/scripts/make-schema.ts`,
      )
    }
  })

  const decode_files = json_files(DECODE)
  it('has a decode corpus to be held to', () => {
    assert.isAtLeast(decode_files.length, 20)
  })

  for (const file of decode_files) {
    const kase = read(DecodeCase, join(DECODE, file))
    it(`${kase.expect.verdict}: ${kase.name}`, () => {
      const by_schema = valid_document(kase.document)
      const by_engine = Result.isSuccess(decode_document(kase.document))
      // A `refuses` document decodes: only the engine's cross-document laws stop it.
      assert.strictEqual(by_schema, kase.expect.verdict !== 'rejects', 'the schema’s verdict')
      assert.strictEqual(by_schema, by_engine, 'the schema and the engine disagree about this file')
    })
  }

  const conformance_files = json_files(CONFORMANCE)
  it('accepts every conformance document and every observation in its log', () => {
    assert.isAtLeast(conformance_files.length, 12)
    for (const file of conformance_files) {
      const kase = read(ConformanceCase, join(CONFORMANCE, file))
      assert.isTrue(valid_document(kase.document), `${kase.name}: document`)
      assert.isAbove(kase.log.length, 0, `${kase.name}: log`)
      kase.log.forEach((observation, i) =>
        assert.isTrue(valid_observation(observation), `${kase.name}: log[${i}]`),
      )
    }
  })

  it('describes every state an engine answers, for every conformance case', () => {
    let states = 0
    for (const file of conformance_files) {
      const kase = read(ConformanceCase, join(CONFORMANCE, file))
      const answer = run(PACKS, kase.document, kase.log)
      assert.strictEqual(answer.kind, 'ran', kase.name)
      if (answer.kind !== 'ran') continue
      for (const state of answer.states) {
        states += 1
        assert.isTrue(valid_state(state), `${kase.name}: ${String(state.entrant)}`)
      }
    }
    assert.isAtLeast(states, 100)
    assert.isFalse(valid_state({}))
  })

  it('rejects every log the engine rejects, but for the calendar', () => {
    // The pattern cannot know February has no 30th; both engines do. Said in
    // the instant's own description rather than pretended away.
    const ENGINE_ONLY = ['rejects-a-log-instant-on-a-day-that-does-not-exist']
    const rejected = decode_files
      .map((file) => read(DecodeCase, join(DECODE, file)))
      .filter((kase) => kase.expect.log?.verdict === 'rejects')
    assert.isAtLeast(rejected.length, 4)
    for (const kase of rejected)
      assert.strictEqual(
        (kase.log ?? []).every(valid_observation),
        ENGINE_ONLY.includes(kase.name),
        kase.name,
      )
  })

  it('reads one instant shape: UTC, `Z`, milliseconds optional', () => {
    const [first] = json_files(CONFORMANCE)
    const [observation] = read(ConformanceCase, join(CONFORMANCE, first ?? '')).log
    const base = Schema.decodeUnknownSync(Json)(observation)
    const at = (t: unknown) => valid_observation({ ...base, t })
    assert.isTrue(at('2026-08-14T16:48:00.000Z'))
    assert.isTrue(at('2026-08-14T16:48:00Z'))
    // Parses as a date and is an offset the Rust engine would read as 18:48 UTC.
    assert.isFalse(at('2026-08-14T18:48:00+02:00'))
    assert.isFalse(at('2026-08-14 16:48:00Z'))
    assert.isFalse(at('2026-08-14'))
    assert.isFalse(at(1786726080000))
  })

  it('lets GeoJSON foreign members through, as both engines do', () => {
    const accepting = read(DecodeCase, join(DECODE, 'the-base-accepts.json')).document
    const base = Schema.decodeUnknownSync(Json)(accepting)
    const features = Schema.decodeUnknownSync(Schema.Array(Json))(base['features'])
    const foreign = {
      ...base,
      bbox: [0.4, 0.4, 0.6, 0.6],
      'sport:results': { as_of: '2026-08-14T16:48:00.000Z' },
      features: features.map((feature, i) => ({ ...feature, id: i })),
    }
    assert.isTrue(Result.isSuccess(decode_document(foreign)), 'the engine')
    assert.isTrue(valid_document(foreign), 'the schema')
  })

  it('rejects what is not a document at all', () => {
    assert.isFalse(valid_document({}))
    assert.isFalse(valid_document({ type: 'FeatureCollection', features: [] }))
    assert.isFalse(valid_observation({}))
  })
})
