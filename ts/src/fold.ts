/**
 * pace-geojson: the evaluator.
 *
 * A race's results are a **fold over an ordered log of observations**, and
 * nothing else. That single choice is what buys every property the design
 * needed:
 *
 * - **Reproducible.** The same document and the same log give the same result
 *   forever. A protest is re-run, not re-argued.
 * - **Late-tolerant.** A mat that uploads an hour after the fact is not a
 *   special case; the log is re-sorted and re-folded, and the answer is right by
 *   construction. This is the property that lets a cheap timing system be
 *   *correct* rather than merely lucky — see `observe.ts`.
 * - **Explainable.** Every firing keeps the sentence a person wrote, so a
 *   result says why rather than asserting.
 * - **Pure.** No database, no clock of its own, no Effect context — so every
 *   host that runs it, a rehearsal, a timing tent, a results page or a server,
 *   is incapable of disagreeing with another.
 *
 * ## Stratified, because some rules are about the field
 *
 * A 120% time cut, last-one-standing, the top three qualifying: none can be
 * decided from one entrant's log. So rules run in strata — every stratum-0 rule
 * against every entrant first, then the field aggregates computed from those
 * results, then the rules that read them. Datalog's answer, and it keeps the
 * whole thing decidable: a stratum may only read aggregates over strata below
 * it, so there is no cycle to diverge in.
 *
 * @see SPEC.md §3.1
 */
import { EntrantId, RuleId, type TEntrantId, type TRuleId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as HashMap from 'effect/HashMap'
import * as MutableHashMap from 'effect/MutableHashMap'
import * as Option from 'effect/Option'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import {
  compare,
  Instant,
  Standing,
  type TAtom,
  type TConsequence,
  type TKernelRule,
  type TPlace,
  type TPredicate,
  type TStanding,
} from './kernel.ts'
import { settle, type TObservation } from './observe.ts'

/**
 * How near a place an observation has to be to count as *at* it.
 *
 * A mat is laid across a road, a GPS ping lands where it lands, and a course is
 * resampled before anyone measures where 30 km is. Ten metres is tighter than
 * any of those errors and far looser than the gap between two distinct points
 * on any course anybody races.
 */
const AT_TOLERANCE_M = 10

const at_place = (observation: TObservation, place: TPlace): boolean =>
  place.point !== null && observation.at.point !== null
    ? observation.at.point === place.point
    : Math.abs(observation.at.along_m - place.along_m) <= AT_TOLERANCE_M

/** One rule firing, kept so a result can explain itself. */
export const AppliedRule = Schema.Struct({
  id_rule: RuleId,
  /** `dialect.kind` — `athletics@1.station_required`. */
  kind: Schema.String,
  /** The rule's sentence, as the dialect says it: the reason, in words. */
  sentence: Schema.String,
  /** How many times the thing the rule is about happened (SPEC.md §3.2, *occurrences*). */
  times: Schema.Finite,
  /** What it did to the total: a penalty is positive, a bonus or a neutralised stretch negative. */
  added_ms: Schema.Finite,
})
export type TApplied = typeof AppliedRule.Type

/** Where one entrant's day ended up. */
export type TEntrantState = {
  readonly entrant: TEntrantId
  readonly started_at: DateTime.Utc | null
  readonly finished_at: DateTime.Utc | null
  readonly withdrew: boolean
  readonly seen: ReadonlyArray<TObservation>
  readonly quantities: ReadonlyArray<{ readonly name: string; readonly value: number }>
  readonly flags: ReadonlyArray<string>
  readonly laps: number
  readonly punches: number
  readonly standing: TStanding
  readonly adjustment_ms: number
  readonly neutralised_ms: number
  readonly classes: ReadonlyArray<{ readonly dimension: string; readonly value: string }>
  readonly awards: ReadonlyArray<string>
  readonly applied: ReadonlyArray<TApplied>
}

/**
 * One entrant's day as it crosses a boundary: what a results page, a timing
 * system or another engine reads. SPEC.md §4.
 *
 * {@link TEntrantState} is the fold's working state and carries the entrant's
 * whole log; this is its projection, with every instant an ISO string and
 * `total_ms` computed. The WebAssembly `run` answers in exactly this shape,
 * and `schema/entrant-state.schema.json` is generated from it.
 *
 * It says **what happened**, and leaves **placing** to the reader: a finisher
 * has `finished_at` (and, on a lapped course, every lap in `laps`, because
 * every lap line is a `finished`); an entrant who started and did not finish has
 * `started_at` and no `finished_at` (`withdrew` says whether they said so); an
 * entrant who never started is not here at all, because the fold's entrants
 * are the log's (SPEC.md §2.3). `total_ms` of a non-finisher runs to their last
 * read, so it is never a time to rank.
 */
export const EntrantState = Schema.Struct({
  entrant: EntrantId,
  standing: Standing,
  started_at: Schema.NullOr(Instant).annotate({
    description: 'The first `started`, or null: never seen starting.',
  }),
  finished_at: Schema.NullOr(Instant).annotate({
    description:
      'The last `finished`, or null: not (yet) a finisher. On a lapped course every lap line is a `finished`, so a ' +
      'finisher there is one whose `laps` is the number of laps.',
  }),
  withdrew: Schema.Boolean.annotate({
    description: 'Whether a `withdrew` was observed. A fact, not a standing.',
  }),
  total_ms: Schema.NullOr(Schema.Finite).annotate({
    description:
      'Moving time plus every penalty, to `finished_at` — or to the last read when there is none, so a ' +
      'non-finisher’s total is not a time to rank. Null when never seen starting.',
  }),
  adjustment_ms: Schema.Finite.annotate({
    description: 'The sum of every `adjust_time` that fired.',
  }),
  neutralised_ms: Schema.Finite.annotate({
    description: 'Time the document took off the clock (`neutralise`).',
  }),
  laps: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      '`finished` observations: one per lap line crossed, 1 for a finisher of a one-lap course.',
  }),
  punches: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description: '`punched` observations.',
  }),
  awards: Schema.Array(Schema.String),
  classes: Schema.Array(Schema.Struct({ dimension: Schema.String, value: Schema.String })).annotate(
    {
      description: 'Each `classify` that fired, the latest per dimension.',
    },
  ),
  applied: Schema.Array(AppliedRule).annotate({
    description:
      'Every rule that fired, in the order it fired, with its sentence: the reason, in words.',
  }),
})
export type TEntrantStateEncoded = typeof EntrantState.Encoded

const encode_entrant_state = Schema.encodeSync(EntrantState)

/** One entrant's day, in the shape that crosses a boundary. */
export const encode_state = (state: TEntrantState): TEntrantStateEncoded =>
  encode_entrant_state({
    entrant: state.entrant,
    standing: state.standing,
    started_at: state.started_at,
    finished_at: state.finished_at,
    withdrew: state.withdrew,
    total_ms: total_ms(state),
    adjustment_ms: state.adjustment_ms,
    neutralised_ms: state.neutralised_ms,
    laps: state.laps,
    punches: state.punches,
    awards: state.awards,
    classes: state.classes,
    applied: state.applied,
  })

/** What the field looks like, recomputed between strata. */
type TField = {
  readonly winner_ms: number | null
  readonly finishers: number
  readonly remaining: number
  /** Keyed, so a `rank` atom is one lookup rather than a scan of the field. */
  readonly rank: HashMap.HashMap<TEntrantId, number>
}

const ms_between = (from: DateTime.Utc, to: DateTime.Utc): number =>
  DateTime.toEpochMillis(to) - DateTime.toEpochMillis(from)

/** Wall-clock from the start to the finish, or to the last thing that was seen. */
const elapsed_ms = (state: TEntrantState): number | null => {
  if (state.started_at === null) return null
  const last = state.finished_at ?? Option.getOrNull(Option.map(Arr.last(state.seen), (o) => o.t))
  return last === null ? null : ms_between(state.started_at, last)
}

/** Elapsed, less anything the document neutralised. What a result prints against. */
const moving_ms = (state: TEntrantState): number | null => {
  const elapsed = elapsed_ms(state)
  return elapsed === null ? null : elapsed - state.neutralised_ms
}

/** The total a placing is decided on: moving time plus every penalty. */
export const total_ms = (state: TEntrantState): number | null => {
  const moving = moving_ms(state)
  return moving === null ? null : moving + state.adjustment_ms
}

/* ── the first pass: observations into state ─────────────────────────────── */

const blank = (entrant: TEntrantId): TEntrantState => ({
  entrant,
  started_at: null,
  finished_at: null,
  withdrew: false,
  seen: [],
  quantities: [],
  flags: [],
  laps: 0,
  punches: 0,
  standing: 'clean',
  adjustment_ms: 0,
  neutralised_ms: 0,
  classes: [],
  awards: [],
  applied: [],
})

/**
 * One observation into the running state. `seen` is not grown here: it is the
 * entrant's whole partition, set once by `fold`, so a day of *k* observations
 * costs *k* steps rather than *k²* copies.
 */
const absorb = (state: TEntrantState, o: TObservation): TEntrantState => ({
  ...state,
  started_at: o.kind === 'started' ? (state.started_at ?? o.t) : state.started_at,
  // The *last* finish, not the first: a lapped course crosses the line every lap.
  finished_at: o.kind === 'finished' ? o.t : state.finished_at,
  withdrew: state.withdrew || o.kind === 'withdrew',
  quantities:
    o.quantity_name === null || o.quantity_value === null
      ? state.quantities
      : [
          ...state.quantities.filter((q) => q.name !== o.quantity_name),
          { name: o.quantity_name, value: o.quantity_value },
        ],
  flags: [...state.flags, ...o.flags.filter((f) => !state.flags.includes(f))],
  laps: state.laps + (o.kind === 'finished' ? 1 : 0),
  punches: state.punches + (o.kind === 'punched' ? 1 : 0),
})

/** One entrant's settled observations, in settled order. */
export type TEntrantLog = {
  readonly entrant: TEntrantId
  readonly seen: ReadonlyArray<TObservation>
}

/**
 * A settled log, partitioned by entrant: entrants in order of first appearance
 * (SPEC.md §3.1), each with their own observations in the order they were
 * settled.
 *
 * One pass and a hash index. Finding each entrant's observations by filtering
 * the whole log instead makes a fold cost the log times the field: 0.15 s for
 * a thousand runners became 87 s for ten thousand, where this takes 0.43 s
 * (`scripts/bench.ts`).
 */
export const by_entrant = (ordered: ReadonlyArray<TObservation>): ReadonlyArray<TEntrantLog> => {
  const groups: Array<TEntrantLog> = []
  // Local to this call and never returned, so mutable; its iteration order is
  // never read — `groups` carries the order.
  const index = MutableHashMap.empty<TEntrantId, Array<TObservation>>()
  for (const o of ordered) {
    const bucket = MutableHashMap.get(index, o.entrant)
    if (Option.isSome(bucket)) bucket.value.push(o)
    else {
      const seen = [o]
      MutableHashMap.set(index, o.entrant, seen)
      groups.push({ entrant: o.entrant, seen })
    }
  }
  return groups
}

/* ── predicates ──────────────────────────────────────────────────────────── */

const first_at = (state: TEntrantState, place: TPlace): TObservation | null =>
  state.seen.find((o) => at_place(o, place)) ?? null

/**
 * How many times the thing the rule is about happened.
 *
 * Defined for `observed` and for a top-level `all` containing one, because
 * those are the shapes where "each time" means something a person can point at.
 * Everywhere else a rule fires once however true it is — a runner whose pack is
 * underweight is one offence, not one per gram.
 */
const occurrences = (predicate: TPredicate, state: TEntrantState): number => {
  const counts = Arr.getSomes(
    predicate.clauses.map(({ atom }) =>
      atom._tag === 'observed'
        ? Option.some(state.seen.filter((o) => at_place(o, atom.at) && o.kind === atom.kind).length)
        : Option.none<number>(),
    ),
  )
  return counts.length === 0 ? 1 : Math.max(...counts)
}

const answers = (atom: TAtom, state: TEntrantState, rule: TKernelRule, field: TField): boolean => {
  switch (atom._tag) {
    case 'observed':
      return state.seen.some((o) => at_place(o, atom.at) && o.kind === atom.kind)

    case 'order': {
      // A subsequence, not a contiguous run: passing extra mats between two
      // controls is normal and is not a mispunch.
      let cursor = 0
      for (const o of state.seen) {
        const wanted = atom.sequence[cursor]
        if (wanted !== undefined && at_place(o, wanted)) cursor += 1
      }
      return cursor === atom.sequence.length
    }

    case 'clock': {
      if (atom.measure === 'wall') {
        if (atom.value_at === null) return false
        // Against the rule's own place: "arrives after 16:30" is about arriving
        // *there*. A rule with no place is about the finish.
        const place = rule.at !== null && 'along_m' in rule.at ? rule.at : null
        const arrival = place === null ? state.finished_at : (first_at(state, place)?.t ?? null)
        return arrival === null
          ? false
          : compare(
              DateTime.toEpochMillis(arrival),
              atom.cmp,
              DateTime.toEpochMillis(atom.value_at),
            )
      }
      if (atom.measure === 'split') {
        if (atom.from === null || atom.to === null || atom.value_ms === null) return false
        const from = first_at(state, atom.from)
        const to = first_at(state, atom.to)
        return from === null || to === null
          ? false
          : compare(ms_between(from.t, to.t), atom.cmp, atom.value_ms)
      }
      const measured = atom.measure === 'elapsed' ? elapsed_ms(state) : moving_ms(state)
      return measured === null || atom.value_ms === null
        ? false
        : compare(measured, atom.cmp, atom.value_ms)
    }

    case 'count': {
      const n =
        atom.what === 'laps'
          ? state.laps
          : atom.what === 'punches'
            ? state.punches
            : atom.what === 'penalties'
              ? state.applied.filter((a) => a.added_ms > 0).length
              : state.seen.length
      return compare(n, atom.cmp, atom.value)
    }

    case 'quantity': {
      const found = state.quantities.find((q) => q.name === atom.name)
      // A measurement nobody took is not a measurement that passed. A kit rule
      // has to fire on the runner whose pack was never weighed.
      return found === undefined ? false : compare(found.value, atom.cmp, atom.value)
    }

    case 'flag':
      return state.flags.includes(atom.name)

    case 'standing':
      return state.standing === atom.is

    case 'withdrawn':
      return state.withdrew

    case 'field': {
      if (atom.aggregate === 'winner_elapsed') {
        const mine = total_ms(state)
        if (field.winner_ms === null || mine === null) return false
        return compare(mine, atom.cmp, field.winner_ms * (atom.ratio ?? 1))
      }
      const n =
        atom.aggregate === 'rank'
          ? Option.getOrElse(HashMap.get(field.rank, state.entrant), () => Number.POSITIVE_INFINITY)
          : atom.aggregate === 'finishers'
            ? field.finishers
            : field.remaining
      return compare(n, atom.cmp, atom.value)
    }
  }
}

/**
 * A rule bound to a place cannot judge somebody who has not got there yet.
 *
 * *"You must punch the mat at 30 km"* is a rule about the 30 km mat, and at
 * 10 km it has nothing to say. Stated as `not(observed at 30 km)` it is
 * nonetheless **true** at 10 km — every negative predicate is, before the thing
 * it denies has had its chance — so a fold over the first hour of a race
 * penalised most of the field for a station they were still running towards.
 *
 * Found by scrubbing: a standing must only ever worsen as time runs, and it
 * did not. The final result is unchanged either way — by the end everyone is
 * past the place or has stopped — so this is precisely a fix for what a *live*
 * or replayed view shows, which is the only view where the difference exists.
 *
 * Dormant until the entrant has been seen at or beyond the place, or their day
 * has ended. A rule with no place, or one bound to a span, is never dormant:
 * it is about the day rather than about a spot on it.
 */
const dormant = (rule: TKernelRule, state: TEntrantState): boolean => {
  const at = rule.at
  if (at === null || !('along_m' in at)) return false
  if (state.finished_at !== null || state.withdrew) return false
  const furthest = state.seen.reduce((far, o) => Math.max(far, o.at.along_m), 0)
  return furthest + AT_TOLERANCE_M < at.along_m
}

/** The whole `when`: every clause, or any clause, each possibly denied. */
const holds = (
  predicate: TPredicate,
  state: TEntrantState,
  rule: TKernelRule,
  field: TField,
): boolean => {
  const truth = (clause: { readonly negated: boolean; readonly atom: TAtom }) =>
    answers(clause.atom, state, rule, field) !== clause.negated
  return predicate.combine === 'all'
    ? predicate.clauses.every(truth)
    : predicate.clauses.some(truth)
}

/* ── effects ─────────────────────────────────────────────────────────────── */

const SEVERITY: Readonly<Record<TStanding, number>> = {
  clean: 0,
  penalised: 1,
  gated: 2,
  disqualified: 3,
}

/** A standing only ever gets worse. A disqualified runner is not also gated. */
const worse_of = (a: TStanding, b: TStanding): TStanding => (SEVERITY[b] > SEVERITY[a] ? b : a)

const apply = (
  state: TEntrantState,
  rule: TKernelRule,
  consequence: TConsequence,
  times: number,
): TEntrantState => {
  const note = (added_ms: number): TApplied => ({
    id_rule: rule.id,
    kind: `${rule.dialect}.${rule.kind}`,
    sentence: rule.sentence,
    times,
    added_ms,
  })
  switch (consequence._tag) {
    case 'adjust_time': {
      const added = consequence.by_ms * (consequence.each_time ? times : 1)
      return {
        ...state,
        adjustment_ms: state.adjustment_ms + added,
        standing: added > 0 ? worse_of(state.standing, 'penalised') : state.standing,
        applied: [...state.applied, note(added)],
      }
    }
    case 'set_standing':
      return {
        ...state,
        standing: worse_of(state.standing, consequence.standing),
        applied: [...state.applied, note(0)],
      }
    case 'classify':
      return {
        ...state,
        classes: [
          ...state.classes.filter((c) => c.dimension !== consequence.dimension),
          { dimension: consequence.dimension, value: consequence.value },
        ],
        applied: [...state.applied, note(0)],
      }
    case 'award':
      return {
        ...state,
        awards: state.awards.includes(consequence.name)
          ? state.awards
          : [...state.awards, consequence.name],
        applied: [...state.applied, note(0)],
      }
    case 'neutralise': {
      const from = first_at(state, consequence.from)
      const to = first_at(state, consequence.to)
      const off = from === null || to === null ? 0 : Math.max(0, ms_between(from.t, to.t))
      return {
        ...state,
        neutralised_ms: state.neutralised_ms + off,
        applied: [...state.applied, note(-off)],
      }
    }
  }
}

/* ── the field ───────────────────────────────────────────────────────────── */

const survey = (states: ReadonlyArray<TEntrantState>): TField => {
  const finished = states.filter((s) => s.finished_at !== null && s.standing !== 'disqualified')
  const totals = Arr.getSomes(
    finished.map((s) =>
      Option.map(Option.fromNullishOr(total_ms(s)), (total) => ({ entrant: s.entrant, total })),
    ),
  )
  const ranked = Arr.sort(
    totals,
    Order.mapInput(Order.Number, (t: { readonly total: number }) => t.total),
  )
  return {
    winner_ms: ranked[0]?.total ?? null,
    finishers: finished.length,
    remaining: states.filter(
      (s) => !s.withdrew && s.standing !== 'disqualified' && s.standing !== 'gated',
    ).length,
    rank: HashMap.fromIterable(ranked.map((r, i) => [r.entrant, i + 1] as const)),
  }
}

/* ── the fold ────────────────────────────────────────────────────────────── */

/**
 * Every entrant's day, from the document's rules and the bridge's log.
 *
 * Total: a rule that cannot be evaluated does not fire, and never throws. A
 * rehearsal against a ghost field of ten thousand is one call to this.
 */
export const fold = (
  rules: ReadonlyArray<TKernelRule>,
  log: ReadonlyArray<TObservation>,
): ReadonlyArray<TEntrantState> => {
  const ordered = settle(log)

  // Pass one: the observations, in time order, into per-entrant state. The log
  // is partitioned once, so this pass is linear in the log.
  let states = by_entrant(ordered).map(({ entrant, seen }): TEntrantState => ({
    ...seen.reduce(absorb, blank(entrant)),
    seen,
  }))

  // Then the rules, stratum by stratum, each stratum seeing the field as the
  // strata below it left it.
  const by_stratum = Arr.sort(
    rules,
    Order.combine(
      Order.mapInput(Order.Number, (r: TKernelRule) => r.stratum),
      Order.mapInput(Order.Number, (r: TKernelRule) => r.ordinal),
    ),
  )
  const strata = Arr.dedupe(by_stratum.map((r) => r.stratum))
  for (const stratum of strata) {
    const field = survey(states)
    const here = by_stratum.filter((r) => r.stratum === stratum)
    states = states.map((state) =>
      here.reduce(
        (s, rule) =>
          !dormant(rule, s) && holds(rule.when, s, rule, field)
            ? apply(s, rule, rule.then, occurrences(rule.when, s))
            : s,
        state,
      ),
    )
  }
  return states
}

/* ── why, not just what ──────────────────────────────────────────────────── */

/**
 * One atom, in words a person can check against the sentence.
 *
 * Deliberately terse and mechanical rather than prose: this sits *under* the
 * sentence somebody wrote, and its job is to say what the engine is actually
 * asking, not to paraphrase the rule again. If the two disagree, the sentence
 * is wrong — which is exactly the disagreement worth being able to see.
 */
export const says = (atom: TAtom): string => {
  const where = (place: TPlace) => place.point ?? `${(place.along_m / 1000).toFixed(1)} km`
  const cmp: Readonly<Record<string, string>> = {
    lt: '<',
    lte: '≤',
    gt: '>',
    gte: '≥',
    eq: '=',
    ne: '≠',
  }
  switch (atom._tag) {
    case 'observed':
      return `${atom.kind} at ${where(atom.at)}`
    case 'order':
      return `in order: ${atom.sequence.map(where).join(' → ')}`
    case 'clock': {
      if (atom.measure === 'wall') {
        return `arrives ${cmp[atom.cmp]} ${atom.value_at === null ? '?' : DateTime.formatIso(atom.value_at).slice(11, 16)}`
      }
      const value = atom.value_ms === null ? '?' : `${Math.round(atom.value_ms / 60_000)} min`
      if (atom.measure === 'split') {
        return `${atom.from === null ? '?' : where(atom.from)} → ${atom.to === null ? '?' : where(atom.to)} ${cmp[atom.cmp]} ${value}`
      }
      return `${atom.measure} ${cmp[atom.cmp]} ${value}`
    }
    case 'count':
      return `${atom.what} ${cmp[atom.cmp]} ${atom.value}`
    case 'quantity':
      return `${atom.name} ${cmp[atom.cmp]} ${atom.value}`
    case 'flag':
      return `flagged ${atom.name}`
    case 'standing':
      return `standing is ${atom.is}`
    case 'withdrawn':
      return 'withdrew'
    case 'field':
      return `${atom.aggregate} ${cmp[atom.cmp]} ${atom.ratio === null ? atom.value : `${atom.ratio}×`}`
  }
}

/** How many of the field one clause, and one whole rule, is true for. */
export type TSelectivity = {
  readonly id_rule: TRuleId
  readonly sentence: string
  readonly combine: 'all' | 'any'
  /** Entrants the whole predicate holds for, dormancy included. */
  readonly fires_for: number
  /** Entrants the rule cannot yet judge, because they have not reached its place. */
  readonly dormant_for: number
  readonly clauses: ReadonlyArray<{
    readonly says: string
    readonly negated: boolean
    readonly true_for: number
  }>
}

/**
 * Which clause of which rule is doing the work.
 *
 * A rule that fires for nobody is either a rule nobody breaks or a rule that
 * cannot fire, and from the outside those look identical. Broken down by
 * clause they do not: *"observed at 30 km — true for 3 of 150"* says the mat is
 * missing everybody, and *"elapsed > 240 min — true for 0"* says the cut-off is
 * slack. That is the difference between a rule being satisfied and a rule being
 * unsatisfiable, which is the single most useful thing a person authoring rules
 * can be shown.
 *
 * Computed against the field as the states already are, so it answers *now* —
 * mid-scrub as readily as at the finish.
 */
export const selectivity = (
  rules: ReadonlyArray<TKernelRule>,
  states: ReadonlyArray<TEntrantState>,
): ReadonlyArray<TSelectivity> => {
  const field = survey(states)
  return rules.map((rule) => ({
    id_rule: rule.id,
    sentence: rule.sentence,
    combine: rule.when.combine,
    fires_for: states.filter(
      (state) => !dormant(rule, state) && holds(rule.when, state, rule, field),
    ).length,
    dormant_for: states.filter((state) => dormant(rule, state)).length,
    clauses: rule.when.clauses.map((clause) => ({
      says: says(clause.atom),
      negated: clause.negated,
      true_for: states.filter(
        (state) => answers(clause.atom, state, rule, field) !== clause.negated,
      ).length,
    })),
  }))
}
