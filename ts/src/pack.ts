/**
 * pace-geojson: a dialect per sport.
 *
 * The kernel is closed and changes about once a year. A **pack** is how a sport
 * gets a vocabulary of its own without touching it: a named, versioned set of
 * rule *kinds*, each with a parameter schema, an expansion into kernel terms,
 * and the sentence a person reads. Adding orienteering is adding a pack.
 *
 * What lives in a course document is data — `{ dialect: 'triathlon@1', kind:
 * 'drafting', params: { … } }` — and what lives here is the interpreter for it.
 * That split is what makes a document safe to hand to a stranger and still
 * makes a pack ordinary, type-checked code in this repository.
 *
 * ## Three rules that keep this from rotting
 *
 * - **Append-only within a major version.** `triathlon@1` may gain kinds; it may
 *   never change what an existing one means. A rule written in 2027 has to still
 *   mean in 2031 what somebody entered under, or the fold stops being
 *   reproducible and the whole design loses its point.
 * - **A kind lands with a conformance case** — a document, a log and the state
 *   every entrant must end in, in `corpus/conformance/` (SPEC.md §7). A kind
 *   nobody can rehearse is a rule nobody can publish.
 * - **An unknown dialect makes a document readable but not runnable.** The
 *   geometry always draws; {@link compile} reports what it could not understand
 *   and the caller must refuse to produce results. Silently dropping a rule is
 *   how a timing system disqualifies the wrong person.
 *
 * @see SPEC.md §3.3 — refusing; §3.4 — the dialects of version 1
 */
import { RuleId } from './ids.ts'
import type { TRuleId } from './ids.ts'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

import {
  reads_field,
  Where,
  type TConsequence,
  type TPredicate,
  type TKernelRule,
  type TPlace,
  type TWhere,
} from './kernel.ts'

/** What a kind produces once its parameters are known. */
export type TExpansion = {
  readonly when: TPredicate
  readonly then: TConsequence
  readonly sentence: string
}

/**
 * One rule kind in a dialect.
 *
 * `compile` both decodes and expands, so a kind's parameter schema is used in
 * exactly one place and a caller can never expand un-decoded parameters. It
 * returns `None` for parameters that are not this kind's shape — which is a
 * *refusal*, reported by {@link compile}, never a rule that quietly does nothing.
 *
 * `needs_place` is true of a kind that means nothing without a place — a
 * station, a finish. Bound to `null` or to a span it would have to invent one,
 * so {@link compile} refuses it instead (SPEC.md §3.4).
 */
export type TRuleKind = {
  readonly kind: string
  readonly needs_place: boolean
  readonly compile: (params: unknown, at: TWhere) => Option.Option<TExpansion>
}

/** Declare a kind with its parameters typed throughout. */
export const rule_kind = <S extends Schema.Top & { readonly DecodingServices: never }>(
  kind: string,
  params: S,
  build: (params: S['Type'], at: TWhere) => TExpansion,
): TRuleKind => {
  const decode = Schema.decodeUnknownOption(params)
  return {
    kind,
    needs_place: false,
    compile: (raw, at) => Option.map(decode(raw), (p) => build(p, at)),
  }
}

/** Is this `at` a place, rather than the whole day or a span? */
export const is_place = (at: TWhere): at is TPlace => at !== null && 'along_m' in at

/** A kind bound to a place: `build` is handed the place, never a stand-in for one. */
export const rule_kind_at = <S extends Schema.Top & { readonly DecodingServices: never }>(
  kind: string,
  params: S,
  build: (params: S['Type'], at: TPlace) => TExpansion,
): TRuleKind => {
  const decode = Schema.decodeUnknownOption(params)
  return {
    kind,
    needs_place: true,
    compile: (raw, at) =>
      is_place(at) ? Option.map(decode(raw), (p) => build(p, at)) : Option.none(),
  }
}

export type TPack = {
  readonly name: string
  readonly version: number
  /**
   * The ways of moving this dialect's sport has — `hike` for athletics; `swim`,
   * `ride` and `transition` for triathlon. Descriptive: the fold never reads it.
   * The dialect that introduces a mode owns it, so ski, paddle or row arrive
   * with their own dialect rather than as a list the kernel has to grow.
   */
  readonly modes: ReadonlyArray<string>
  readonly kinds: ReadonlyArray<TRuleKind>
}

/** `triathlon@1` — how a document names a dialect. */
export const dialect_of = (pack: TPack): string => `${pack.name}@${pack.version}`

/* ── what a document carries ─────────────────────────────────────────────── */

/**
 * A rule as it appears in a course document: a dialect, a kind, and parameters.
 *
 * Deliberately *not* the kernel form. A document that carried expanded
 * predicates would be unreadable by a person and unfixable by a pack — the
 * whole point of a dialect is that the file says *"drafting, 25 seconds"* and
 * the meaning of drafting can be corrected in one place.
 */
export const DocumentRule = Schema.Struct({
  id: RuleId,
  dialect: Schema.String,
  kind: Schema.String,
  ordinal: Schema.Finite,
  at: Where,
  params: Schema.Unknown,
})
export type TDocumentRule = typeof DocumentRule.Type

/** A rule that could not be compiled, and why — the reason a document is refused. */
export type TRefusal = {
  readonly id: TRuleId
  readonly dialect: string
  readonly kind: string
  readonly why: 'unknown dialect' | 'unknown kind' | 'needs a place' | 'parameters do not fit'
}

/**
 * Compile a document's rules against the packs we ship.
 *
 * Returns both halves on purpose. A caller that wants to *draw* the course uses
 * `rules` and ignores the rest; a caller that wants to produce **results** must
 * refuse when `refused` is non-empty, because a fold that silently skips a gate
 * reports a finisher who was cut.
 */
export const compile = (
  packs: ReadonlyArray<TPack>,
  document: ReadonlyArray<TDocumentRule>,
): { readonly rules: ReadonlyArray<TKernelRule>; readonly refused: ReadonlyArray<TRefusal> } => {
  const rules: Array<TKernelRule> = []
  const refused: Array<TRefusal> = []
  for (const row of document) {
    const pack = packs.find((p) => dialect_of(p) === row.dialect)
    if (pack === undefined) {
      refused.push({ id: row.id, dialect: row.dialect, kind: row.kind, why: 'unknown dialect' })
      continue
    }
    const kind = pack.kinds.find((k) => k.kind === row.kind)
    if (kind === undefined) {
      refused.push({ id: row.id, dialect: row.dialect, kind: row.kind, why: 'unknown kind' })
      continue
    }
    if (kind.needs_place && !is_place(row.at)) {
      refused.push({ id: row.id, dialect: row.dialect, kind: row.kind, why: 'needs a place' })
      continue
    }
    // Every kind's parameters are an object, even an empty one: an empty
    // struct schema would otherwise let `"x"` and `[]` fit a kind with none.
    const params = row.params
    const expansion =
      typeof params === 'object' && params !== null && !Array.isArray(params)
        ? kind.compile(params, row.at)
        : Option.none()
    if (Option.isNone(expansion)) {
      refused.push({
        id: row.id,
        dialect: row.dialect,
        kind: row.kind,
        why: 'parameters do not fit',
      })
      continue
    }
    rules.push({
      id: row.id,
      dialect: row.dialect,
      kind: row.kind,
      ordinal: row.ordinal,
      at: row.at,
      when: expansion.value.when,
      then: expansion.value.then,
      sentence: expansion.value.sentence,
      // A rule that reads the field cannot run until the field exists.
      stratum: reads_field(expansion.value.when) ? 1 : 0,
    })
  }
  return { rules, refused }
}

/* ── the words a sentence is made of ─────────────────────────────────────── */

const two = (n: number): string => String(n).padStart(2, '0')

/**
 * A duration for a sentence — `m:ss`, or `h:mm:ss` from an hour — and `.mmm`
 * only when it is not whole seconds, so no parameter is rounded into a number
 * the rule does not use. The magnitude only: the caller says which way it goes.
 */
export const span = (ms: number): string => {
  const exact = Math.round(Math.abs(ms))
  const total = Math.floor(exact / 1000)
  const rest = exact % 1000
  const h = Math.floor(total / 3600)
  const clock =
    h > 0
      ? `${h}:${two(Math.floor((total % 3600) / 60))}:${two(total % 60)}`
      : `${Math.floor(total / 60)}:${two(total % 60)}`
  return rest === 0 ? clock : `${clock}.${String(rest).padStart(3, '0').replace(/0+$/, '')}`
}

/** What an `adjust_time` of `ms` does to the total, said: a penalty costs, a bonus gives back. */
export const costs = (ms: number): string =>
  ms < 0 ? `gives back ${span(ms)}` : `costs ${span(ms)}`

/** A place as a sentence names it: its point id, else the start line, else its distance. */
export const place_name = (place: TPlace): string =>
  place.point ?? (place.along_m === 0 ? 'the start' : `the place at ${place.along_m} m`)
