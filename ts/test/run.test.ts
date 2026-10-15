/**
 * The one call a host makes, and the JSON it answers in.
 *
 * `run` is the wire between this engine and everything else — the WebAssembly
 * build answers member for member the same (`differential.test.ts` holds the
 * two to it) — so it is pinned here as JSON, the way a consumer reads it.
 * `rust/tests/run.rs` pins the Rust's the same way.
 *
 * @see src/run.ts
 * @see SPEC.md §4
 */
import { assert, describe, it } from '@effect/vitest'
import * as Schema from 'effect/Schema'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Result from 'effect/Result'

import {
  broken_log_laws,
  decode_document,
  decode_log,
  encode_state,
  fold,
  PACKS,
  plan,
  run,
} from '../src/index.ts'

const ROOT = join(import.meta.dirname, '..', '..')
const Json = Schema.Record(Schema.String, Schema.Unknown)
const decode_json = Schema.decodeUnknownSync(Json)
const decode_rows = Schema.decodeUnknownSync(Schema.Array(Json))
const read = (path: string): unknown => JSON.parse(readFileSync(join(ROOT, path), 'utf8'))

const document = decode_json(read('examples/10k/document.json'))
const log = decode_rows(read('examples/10k/log.json'))
const rules = decode_rows(document['pace:rules'])

/** The answer as a consumer holds it: parsed JSON. */
const answer = (d: unknown, l: unknown): unknown => JSON.parse(JSON.stringify(run(PACKS, d, l)))

const Ran = Schema.Struct({ kind: Schema.Literal('ran'), states: Schema.Array(Json) })

describe('run', () => {
  it('says who finished, who did not, and why each rule fired', () => {
    const { states } = Schema.decodeUnknownSync(Ran)(answer(document, log))
    const ana = states.find((s) => s['entrant'] === 'ent_ana') ?? assert.fail('no ent_ana')
    assert.deepStrictEqual(
      Object.keys(ana),
      [
        'entrant',
        'standing',
        'started_at',
        'finished_at',
        'withdrew',
        'total_ms',
        'adjustment_ms',
        'neutralised_ms',
        'laps',
        'punches',
        'awards',
        'classes',
        'applied',
      ],
      'the members a results page needs, in the order the schema lists them',
    )
    assert.strictEqual(ana['started_at'], '2027-05-02T07:00:00.000Z')
    assert.strictEqual(ana['total_ms'], 2_790_000)
    assert.strictEqual(ana['withdrew'], false)
    const cy = states.find((s) => s['entrant'] === 'ent_cy') ?? assert.fail('no ent_cy')
    assert.deepStrictEqual(cy['applied'], [
      {
        id_rule: 'rul_station',
        kind: 'athletics@1.station_required',
        sentence: 'Missing km-5 costs 2:00.',
        // The punches at km-5: none, which is why it fired. SPEC.md §3.2, *occurrences*.
        times: 0,
        added_ms: 120_000,
      },
    ])
  })

  it('tells a finisher from one who started and stopped: the total alone cannot', () => {
    // A runner last read at 5 km has a *shorter* total than every finisher —
    // elapsed runs to the last read — so ranking on `total_ms` alone puts a
    // non-finisher first. `finished_at` is what says who finished.
    const stopped = log.filter((o) => o['entrant'] === 'ent_ana' && o['kind'] !== 'finished')
    const { states } = Schema.decodeUnknownSync(Ran)(answer(document, stopped))
    const [ana] = states
    assert.strictEqual(ana?.['finished_at'], null)
    assert.isString(ana?.['started_at'])
    assert.isBelow(Schema.decodeUnknownSync(Schema.Finite)(ana?.['total_ms']), 2_790_000)
    assert.deepStrictEqual(ana?.['awards'], [], 'no finish, no qualifying time')
  })

  it('is the fold, encoded: the same states a host folding by hand gets', () => {
    const decoded = decode_document(document)
    const observations = decode_log(log)
    if (Result.isFailure(decoded) || Result.isFailure(observations)) return assert.fail('decode')
    const planned = plan(decoded.success, PACKS)
    if (Result.isFailure(planned)) return assert.fail('plan')
    assert.deepStrictEqual(
      Schema.decodeUnknownSync(Ran)(answer(document, log)).states,
      JSON.parse(JSON.stringify(fold(planned.success, observations.success).map(encode_state))),
    )
  })

  it('refuses with data naming each rule and its reason, never a sentence to parse', () => {
    const refused = {
      ...document,
      'pace:rules': rules.map((rule, i) =>
        i === 1
          ? { ...rule, at: null }
          : i === 0
            ? { ...rule, params: { at: '2027-05-02T09:40:00+02:00', says: '07:40' } }
            : rule,
      ),
    }
    assert.deepStrictEqual(answer(refused, log), {
      kind: 'refused',
      why: {
        unknown_version: null,
        missing_dialects: [],
        refused: [
          {
            id: 'rul_gate',
            dialect: 'athletics@1',
            kind: 'cutoff_at',
            why: 'parameters do not fit',
          },
          {
            id: 'rul_station',
            dialect: 'athletics@1',
            kind: 'station_required',
            why: 'needs a place',
          },
        ],
        broken: [],
      },
    })
  })

  it('calls a log that is not one malformed, and never runs it', () => {
    for (const t of ['not a time', '2027-05-02T09:00:00+02:00', '2027-02-30T07:00:00Z']) {
      const bent = log.map((o, i) => (i === 0 ? { ...o, t } : o))
      const got = decode_json(answer(document, bent))
      assert.strictEqual(got['kind'], 'malformed', t)
      assert.deepStrictEqual(got['broken'], [], t)
    }
    const twice = [...log, log[0]]
    assert.deepStrictEqual(decode_json(answer(document, twice))['broken'], [
      { law: 'an observation id is used twice', what: log[0]?.['id'] },
    ])
  })
})

describe('run, handed the text', () => {
  const document_text = readFileSync(join(ROOT, 'examples/10k/document.json'), 'utf8')
  const log_text = readFileSync(join(ROOT, 'examples/10k/log.json'), 'utf8')
  const Malformed = Schema.Struct({
    kind: Schema.Literal('malformed'),
    why: Schema.String,
    broken: Schema.Array(Schema.Unknown),
  })
  const malformed = (d: unknown, l: unknown) => Schema.decodeUnknownSync(Malformed)(answer(d, l))

  it('answers as it does for the values, either file as text or as a value', () => {
    const want = answer(document, log)
    assert.deepStrictEqual(answer(document_text, log_text), want)
    assert.deepStrictEqual(answer(document_text, log), want)
    assert.deepStrictEqual(answer(document, log_text), want)
  })

  it('refuses a document that names a member twice, whichever value it would have kept', () => {
    // 1 then 1, 1 then 2, 2 then 1: a parser keeping the last runs the first
    // and the third and refuses the second; one keeping the first runs the
    // first two. All three are the same thing: not a document.
    for (const versions of [
      '1, "pace-geojson": 1',
      '1, "pace-geojson": 2',
      '2, "pace-geojson": 1',
    ]) {
      const twice = document_text.replace('"pace-geojson": 1', `"pace-geojson": ${versions}`)
      assert.notStrictEqual(twice, document_text)
      assert.deepStrictEqual(malformed(twice, log_text), {
        kind: 'malformed',
        why: 'the document did not decode: a member is named twice: "pace-geojson", line 3',
        broken: [],
      })
    }
  })

  it('refuses it in a member nothing reads, and in a rule’s parameters', () => {
    const foreign = document_text.replace('{', '{"x:note": 1, "x:note": 2,')
    assert.include(malformed(foreign, log_text).why, 'a member is named twice: "x:note"')
    const param = document_text.replace(
      '"penalty_ms": 120000',
      '"penalty_ms": 120000, "penalty_ms": 1',
    )
    assert.notStrictEqual(param, document_text)
    assert.include(malformed(param, log_text).why, 'a member is named twice: "penalty_ms"')
  })

  it('refuses a log that does, and says it is the log', () => {
    const twice = log_text.replace(
      '"entrant": "ent_ana"',
      '"entrant": "ent_ana", "entrant": "ent_ben"',
    )
    assert.notStrictEqual(twice, log_text)
    assert.deepStrictEqual(malformed(document_text, twice), {
      kind: 'malformed',
      why: 'the log did not decode: a member is named twice: "entrant", line 4',
      broken: [],
    })
  })

  it('refuses half a surrogate pair in an id', () => {
    const half = log_text.replace('"ent_ana"', String.raw`"ent_\ud83d"`)
    assert.include(malformed(document_text, half).why, 'a string holds half a surrogate pair')
  })

  it('cannot see any of it once a parser has chosen: the value runs', () => {
    // Why the text is what a host hands over. `JSON.parse` keeps the last of
    // two members and says nothing, so the value is a lawful version-1
    // document — and nothing about it can show that its text was not.
    const twice = document_text.replace('"pace-geojson": 1', '"pace-geojson": 2, "pace-geojson": 1')
    assert.strictEqual(malformed(twice, log_text).kind, 'malformed')
    assert.deepStrictEqual(answer(JSON.parse(twice), log), answer(document, log))
  })

  it('takes a string as text and nothing else', () => {
    // A document is never a string, so a string is never a value: a text
    // written out twice over is the text of a string, and that is no document.
    assert.strictEqual(malformed(JSON.stringify(document_text), log_text).kind, 'malformed')
    assert.strictEqual(
      malformed('', log_text).why,
      'the document did not decode: Expected a JSON text',
    )
    assert.strictEqual(
      malformed(document_text, '[').why,
      'the log did not decode: Expected a JSON text',
    )
  })
})

describe('broken_log_laws', () => {
  it('names each id used twice once, however often it repeats', () => {
    const decoded = decode_log(log)
    if (Result.isFailure(decoded)) return assert.fail('the log did not decode')
    const [a, b] = decoded.success
    if (a === undefined || b === undefined) return assert.fail('a log of two')
    assert.deepStrictEqual(broken_log_laws(decoded.success), [])
    assert.deepStrictEqual(broken_log_laws([a, a, a, b, { ...b, t: a.t }]), [
      { law: 'an observation id is used twice', what: a.id },
      { law: 'an observation id is used twice', what: b.id },
    ])
  })
})
