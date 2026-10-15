/**
 * A document and a log in, one answer out — the four calls of SPEC.md §4 as
 * one, for a host that has the two files and wants the result.
 *
 * Three answers and no fourth, the same three the WebAssembly build's `run`
 * gives, field for field:
 *
 * - **ran** — every entrant's state, in the shape {@link EntrantState} encodes.
 * - **refused** — the document draws and does not run: an unknown version, a
 *   dialect this build does not ship, a rule that did not compile (with its id
 *   and why), a cross-document law broken (SPEC.md §3.3).
 * - **malformed** — the bytes are not a document, or not a log: a law of the
 *   text, a per-field law, or a log law such as an observation id used twice
 *   (`broken`).
 *
 * `why` on a malformed answer is each engine's own wording; everything else is
 * the same in both.
 *
 * ## Hand it the text
 *
 * Each of the two goes in as **the file's text**, a string, exactly as the
 * WebAssembly build's `run` takes it — and then every law is checked. A value
 * some JSON parser already made is taken too, for a host that has nothing
 * else, and is checked for everything a value can still show: that its text
 * named a member twice is not among them (`text.ts`).
 *
 * @see SPEC.md §4
 */
import * as Result from 'effect/Result'
import * as SchemaIssue from 'effect/SchemaIssue'

import { decode_document, parse_document, plan, type TNotRunnable } from './document.ts'
import { encode_state, fold, type TEntrantStateEncoded } from './fold.ts'
import { broken_log_laws, decode_log, parse_log, type TBrokenLogLaw } from './observe.ts'
import type { TPack } from './pack.ts'

/**
 * Why a document or a log did not decode, in lines a person reads: what was
 * expected, and the path to where it was not — `Missing key` at
 * `["pace:measure"]["ascent_threshold_m"]`. A decode failure is structured
 * data whose `String()` is `[object Object]`, which tells the first person to
 * make a mistake nothing at all.
 */
export const describe_issue: (issue: SchemaIssue.Issue) => string =
  SchemaIssue.makeFormatterDefault()

export type TAnswer =
  | { readonly kind: 'ran'; readonly states: ReadonlyArray<TEntrantStateEncoded> }
  | { readonly kind: 'refused'; readonly why: TNotRunnable }
  | {
      readonly kind: 'malformed'
      readonly why: string
      /** The log laws broken, when that is why. Empty when the bytes did not decode. */
      readonly broken: ReadonlyArray<TBrokenLogLaw>
    }

/**
 * Parse both, plan, check the log, fold, encode. Total: every input has an
 * answer, and none of them throws.
 *
 * `document` and `log` are each the file's text, or the value a JSON parser
 * made of it. A string is always text: no document and no log is a string.
 */
export const run = (packs: ReadonlyArray<TPack>, document: unknown, log: unknown): TAnswer => {
  const decoded =
    typeof document === 'string' ? parse_document(document) : decode_document(document)
  if (Result.isFailure(decoded))
    return {
      kind: 'malformed',
      why: `the document did not decode: ${describe_issue(decoded.failure)}`,
      broken: [],
    }
  const observations = typeof log === 'string' ? parse_log(log) : decode_log(log)
  if (Result.isFailure(observations))
    return {
      kind: 'malformed',
      why: `the log did not decode: ${describe_issue(observations.failure)}`,
      broken: [],
    }
  const planned = plan(decoded.success, packs)
  if (Result.isFailure(planned)) return { kind: 'refused', why: planned.failure }
  const broken = broken_log_laws(observations.success)
  if (broken.length > 0) return { kind: 'malformed', why: 'the log breaks a law', broken }
  return {
    kind: 'ran',
    states: fold(planned.success, observations.success).map(encode_state),
  }
}
