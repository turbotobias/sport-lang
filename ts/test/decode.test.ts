/**
 * The decode corpus, run against this implementation.
 *
 * `conformance.test.ts` asserts the fold. This asserts the *file*: which
 * documents are documents, which are documents that cannot be run, and which
 * law each refusal is about. Without it nothing asserts any of that from the
 * outside, and every law in `SPEC.md` §2.1 would be enforced by whichever
 * implementation happened to read the file.
 *
 * Three verdicts, and the middle one is the point:
 *
 * - **accepts** — `decode_document` succeeds and `plan` succeeds.
 * - **rejects** — `decode_document` fails. A per-field law; not a document.
 * - **refuses** — `decode_document` succeeds and `plan` fails. The geometry is
 *   fine and a map **must still draw it**; only running is refused. This is the
 *   verdict a map depends on, because a map draws before it runs.
 *
 * A `refuses` case asserts *which* laws broke, by their sentences, because
 * `TBrokenLaw.law` is byte-identical to `BrokenLaw.law` in the Rust. A document
 * refused for the wrong reason is two implementations disagreeing while
 * appearing to agree.
 *
 * `rust/tests/decode.rs` runs the same files and must produce the
 * same verdicts. Nothing is shared between the two beyond the JSON.
 *
 * A case carries its document as a value (`document`) or, where the law under
 * test is one only the text can break, as the text itself (`document_text`),
 * and its log likewise (`log` or `log_text`). A text goes to `parse_document`
 * as it is written; a value goes to `decode_document`, and is also written
 * out and parsed, because a lawful value's text must get the same verdict.
 *
 * @see scripts/make-decode-corpus.ts — where the cases come from
 * @see SPEC.md §2.1
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKS } from '../src/index.ts'
import { decode_document, parse_document, plan } from '../src/document.ts'
import { broken_log_laws, decode_log, parse_log } from '../src/observe.ts'
import { describe_issue } from '../src/run.ts'

const CORPUS = join(import.meta.dirname, '../../corpus/decode')

const Verdict = Schema.Literals(['accepts', 'rejects', 'refuses'])
const Expect = Schema.Struct({
  verdict: Verdict,
  laws: Schema.optionalKey(Schema.Array(Schema.String)),
  missing_dialects: Schema.optionalKey(Schema.Array(Schema.String)),
  /** Every rule refused, by id, with the reason in the words both engines use. */
  refused: Schema.optionalKey(
    Schema.Array(Schema.Struct({ id: Schema.String, why: Schema.String })),
  ),
  /** Absent unless the version itself is a reason to refuse. */
  unknown_version: Schema.optionalKey(Schema.Finite),
  /** What a reader makes of the case's `log`, when it carries one. */
  log: Schema.optionalKey(
    Schema.Struct({ verdict: Verdict, laws: Schema.optionalKey(Schema.Array(Schema.String)) }),
  ),
})
const Case = Schema.Struct({
  name: Schema.String,
  why: Schema.String,
  expect: Expect,
  /** The document as a value, or — for a law of the text — as its text. One of the two. */
  document: Schema.optionalKey(Schema.Unknown),
  document_text: Schema.optionalKey(Schema.String),
  /** The log beside it, the same two ways. */
  log: Schema.optionalKey(Schema.Unknown),
  log_text: Schema.optionalKey(Schema.String),
})
const decode_case = Schema.decodeUnknownSync(Case)
const read_case = (file: string) =>
  decode_case(JSON.parse(readFileSync(join(CORPUS, file), 'utf8')))
type TCase = ReturnType<typeof read_case>

/** The case's document, read the way the case carries it. */
const document_in = (kase: TCase) =>
  kase.document_text === undefined
    ? decode_document(kase.document)
    : parse_document(kase.document_text)
/** And its log. */
const log_in = (kase: TCase) =>
  kase.log_text === undefined ? decode_log(kase.log) : parse_log(kase.log_text)

const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('the decode corpus', () => {
  it('exists', () => {
    // Every assertion below is inside a loop over these files, and a loop over
    // nothing passes. The same reason `the_corpus_exists` is a test in Rust.
    // Fifty-four today: fourteen accepts, twenty-three rejects, seventeen
    // refuses, eight of the accepts judging a log. The count is exact: fewer
    // is a file that went missing, and more is a file the generator no longer
    // writes, which it never deletes.
    const count = (verdict: string) =>
      files.filter((file) => read_case(file).expect.verdict === verdict).length
    assert.deepStrictEqual(
      [count('accepts'), count('rejects'), count('refuses'), files.length],
      [14, 23, 17, 54],
      'accepts, rejects, refuses, and the whole decode corpus',
    )
    // Eleven of them carry a text: nine a document's, two a log's.
    const carrying = (member: 'document_text' | 'log_text') =>
      files.filter((file) => read_case(file)[member] !== undefined).length
    assert.deepStrictEqual([carrying('document_text'), carrying('log_text')], [9, 2])
  })

  it('carries each document and each log one way, never both', () => {
    for (const file of files) {
      const kase = read_case(file)
      assert.notStrictEqual('document' in kase, 'document_text' in kase, `${file}: the document`)
      assert.isFalse('log' in kase && 'log_text' in kase, `${file}: the log`)
    }
  })

  for (const file of files) {
    const kase = read_case(file)

    it(`${kase.name} — ${kase.why}`, () => {
      const decoded = document_in(kase)
      // A lawful value's text is the same file: written out and parsed, it
      // gets the verdict the value got.
      if (kase.document_text === undefined)
        assert.strictEqual(
          Result.isSuccess(parse_document(JSON.stringify(kase.document))),
          Result.isSuccess(decoded),
          'the document as a value and as its text are judged differently',
        )

      if (kase.expect.verdict === 'rejects') {
        assert.isTrue(
          Result.isFailure(decoded),
          'the document decoded; a per-field law was supposed to stop it',
        )
        return
      }

      assert.isTrue(
        Result.isSuccess(decoded),
        `the document did not decode, and this case is \`${kase.expect.verdict}\`: ${
          Result.isFailure(decoded) ? String(decoded.failure).slice(0, 300) : ''
        }`,
      )
      if (!Result.isSuccess(decoded)) return

      const planned = plan(decoded.success, PACKS)

      if (kase.expect.verdict === 'accepts') {
        assert.isTrue(
          Result.isSuccess(planned),
          `the document did not plan: ${
            Result.isFailure(planned) ? JSON.stringify(planned.failure) : ''
          }`,
        )
        const expect_log = kase.expect.log
        if (expect_log === undefined) return
        assert.isTrue('log' in kase || 'log_text' in kase, 'the case judges a log and carries none')
        const log = log_in(kase)
        if (kase.log_text === undefined)
          assert.strictEqual(
            Result.isSuccess(parse_log(JSON.stringify(kase.log))),
            Result.isSuccess(log),
            'the log as a value and as its text are judged differently',
          )
        if (expect_log.verdict === 'rejects') {
          assert.isTrue(
            Result.isFailure(log),
            'the log decoded; a per-field law was supposed to stop it',
          )
          return
        }
        if (Result.isFailure(log))
          return assert.fail(`the log did not decode: ${String(log.failure)}`)
        assert.deepStrictEqual(
          broken_log_laws(log.success)
            .map((b) => b.law)
            .toSorted(),
          [...(expect_log.laws ?? [])],
          'the log laws broken are not the laws the corpus names',
        )
        return
      }

      assert.isTrue(
        Result.isFailure(planned),
        'the document planned; it was supposed to be refused',
      )
      if (!Result.isFailure(planned)) return

      assert.deepStrictEqual(
        planned.failure.broken.map((b) => b.law).toSorted(),
        [...(kase.expect.laws ?? [])],
        'the laws broken are not the laws the corpus names',
      )
      assert.deepStrictEqual([...planned.failure.missing_dialects].toSorted(), [
        ...(kase.expect.missing_dialects ?? []),
      ])
      assert.deepStrictEqual(
        planned.failure.refused
          .map((r) => ({ id: r.id, why: r.why }))
          .toSorted((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
        [...(kase.expect.refused ?? [])],
        'the rules refused, and why, are not what the corpus names',
      )
      assert.strictEqual(
        planned.failure.unknown_version,
        kase.expect.unknown_version ?? null,
        'the version refused is not the version the corpus names',
      )
    })
  }
})

/**
 * `rejects` is one bit here too, and a text case could be rejected for a typo
 * in its own edit. So each is held to the law it is about, by the sentence —
 * and to the other half of the claim: that the value `JSON.parse` makes of it
 * is a lawful document, so nothing but the text could have shown it.
 */
describe('a text that breaks a law of the text', () => {
  const TWICE = 'a member is named twice'
  const HALF = 'a string holds half a surrogate pair'
  /** Why a read failed, in the decoder's words. One read at a time: a document and a log are two types. */
  const why_not = <A>(read: Result.Result<A, Parameters<typeof describe_issue>[0]>): string =>
    Result.isFailure(read) ? describe_issue(read.failure) : 'nothing: it decoded'
  const rejected_for = (kase: TCase): string =>
    kase.log_text === undefined ? why_not(document_in(kase)) : why_not(log_in(kase))
  const cases: ReadonlyArray<readonly [string, string]> = [
    ['rejects-a-version-written-twice', `${TWICE}: "pace-geojson", line 1`],
    ['rejects-a-measure-with-a-member-twice', `${TWICE}: "distance_m", line 1`],
    ['rejects-a-rule-with-a-parameter-twice', `${TWICE}: "within_ms", line 1`],
    ['rejects-a-foreign-member-written-twice', `${TWICE}: "x:note", line 1`],
    ['rejects-a-name-written-twice-under-an-escape', `${TWICE}: "pace:way", line 1`],
    ['rejects-a-string-with-half-a-surrogate-pair', `${HALF}: "evt_\\\\ud83d", line 1`],
    ['rejects-a-foreign-string-with-half-a-surrogate-pair', `${HALF}: "\\\\ude00", line 1`],
    ['rejects-a-log-with-a-member-twice', `${TWICE}: "entrant", line 1`],
    ['rejects-a-log-with-half-a-surrogate-pair', `${HALF}: "ent_\\\\ud83d", line 1`],
  ]

  it('is every text case that is rejected', () => {
    const rejected = files
      .map(read_case)
      .filter(
        (kase) =>
          (kase.document_text !== undefined && kase.expect.verdict === 'rejects') ||
          kase.log_text !== undefined,
      )
      .map((kase) => kase.name)
    assert.deepStrictEqual(rejected, cases.map(([name]) => name).toSorted())
  })

  for (const [name, why] of cases)
    it(`${name} is rejected for that law, and its value hides it`, () => {
      const kase = read_case(`${name}.json`)
      assert.strictEqual(rejected_for(kase), why)
      // What a host that parses first is left holding: a document, and a log.
      const text = kase.log_text ?? kase.document_text ?? ''
      const value: unknown = JSON.parse(text)
      const lawful =
        kase.log_text === undefined
          ? Result.isSuccess(decode_document(value))
          : Result.isSuccess(decode_log(value))
      assert.isTrue(lawful, 'the value does not decode: the edit broke more')
    })

  it('a pair written whole, and an escaped backslash, are text', () => {
    const kase = read_case('accepts-a-text-with-a-whole-pair-and-an-escaped-backslash.json')
    const decoded = document_in(kase)
    if (Result.isFailure(decoded)) return assert.fail(describe_issue(decoded.failure))
    assert.strictEqual(decoded.success['pace:event'], 'evt_\u{1f600}_\\ud83d')
  })
})

/**
 * `rejects` is one bit, and a document in an earlier namespace breaks two laws
 * at once: its root member is missing and so is every member. A reader with an
 * alias for either half still rejects all three cases, so the reason is
 * asserted here, and the two halves are tried apart.
 */
describe('a document under another name', () => {
  const Root = Schema.decodeUnknownSync(Schema.Record(Schema.String, Schema.Unknown))
  const document_of = (name: string) => Root(read_case(`${name}.json`).document)
  const rejected_for = (document: unknown): string => {
    const decoded = decode_document(document)
    return Result.isFailure(decoded) ? describe_issue(decoded.failure) : 'nothing: it decoded'
  }
  /** A document's `<namespace>:<name>` members, or everything else at its root. */
  const root_of = (document: Readonly<Record<string, unknown>>, members: boolean) =>
    Object.entries(document).filter(([key]) => key.includes(':') === members)
  const graft = (
    members: Readonly<Record<string, unknown>>,
    rest: Readonly<Record<string, unknown>>,
  ) => Object.fromEntries([...root_of(members, true), ...root_of(rest, false)])
  /** The decoder's words for a member that is not there. */
  const missing = (key: string) => `Missing key\n  at ["${key}"]`

  for (const name of [
    'rejects-a-document-missing-its-version',
    'rejects-the-old-race-namespace',
    'rejects-the-old-sport-namespace',
  ])
    it(`${name} is rejected for the root member`, () => {
      assert.strictEqual(rejected_for(document_of(name)), missing('pace-geojson'))
    })

  it('a half-renamed document is rejected for the half that is old', () => {
    // What a rename by find-and-replace leaves behind: the earlier draft's
    // members under the current root member, and the current members under
    // the earlier root. Neither is read.
    const current = document_of('the-base-accepts')
    const earlier = document_of('rejects-the-old-race-namespace')

    const old_members = graft(earlier, current)
    assert.strictEqual(old_members['pace-geojson'], 1, 'the current root member is there')
    assert.strictEqual(rejected_for(old_members), missing('pace:id'))

    const old_root = graft(current, earlier)
    assert.strictEqual(old_root['pace:id'], current['pace:id'], 'the current members are there')
    assert.strictEqual(rejected_for(old_root), missing('pace-geojson'))
  })
})
