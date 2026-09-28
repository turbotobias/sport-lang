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
 * @see scripts/make-decode-corpus.ts — where the cases come from
 * @see SPEC.md §2.1
 */
import { assert, describe, it } from '@effect/vitest'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import { PACKS } from '../src/index.ts'
import { decode_document, plan } from '../src/document.ts'
import { broken_log_laws, decode_log } from '../src/observe.ts'

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
  document: Schema.Unknown,
  log: Schema.optionalKey(Schema.Unknown),
})
const decode_case = Schema.decodeUnknownSync(Case)

const files = readdirSync(CORPUS)
  .filter((f) => f.endsWith('.json'))
  .sort()

describe('the decode corpus', () => {
  it('exists', () => {
    // Every assertion below is inside a loop over these files, and a loop over
    // nothing passes. The same reason `the_corpus_exists` is a test in Rust.
    // Forty today: ten accepts, thirteen rejects, seventeen refuses, six of
    // them judging a log. A guard below the corpus's size would let a lost
    // file pass as a smaller corpus.
    assert.isAtLeast(files.length, 40, 'the decode corpus has at least forty cases')
  })

  for (const file of files) {
    const kase = decode_case(JSON.parse(readFileSync(join(CORPUS, file), 'utf8')))

    it(`${kase.name} — ${kase.why}`, () => {
      const decoded = decode_document(kase.document)

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
        assert.isTrue('log' in kase, 'the case judges a log and carries none')
        const log = decode_log(kase.log)
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
