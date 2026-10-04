/**
 * pace-geojson: the kernel.
 *
 * The rules of a race, in a language small enough that every sentence in it can
 * be *simulated* before anyone runs. That is the whole design constraint: the
 * vocabulary is closed, because a rule nobody can simulate is a rule nobody can
 * publish — and it is still wide enough for a backyard ultra's hourly corral, a
 * triathlon's drafting zone and an orienteer's controls punched in order.
 *
 * ## Why it splits in two
 *
 * Inventing a rule shape per sport ends with a vocabulary nobody can simulate. So
 * this file is the **kernel** — what every sporting rule reduces to, closed,
 * and changing about once a year — and `pack.ts` is the **dialect**: a
 * versioned set of rule kinds per sport, each expanding into kernel terms.
 * Adding orienteering is adding a pack. It touches nothing here.
 *
 * ## What it deliberately cannot do
 *
 * No recursion, no user functions, no arithmetic beyond comparison, no IO. A
 * predicate is a finite tree over facts the race already knows. Every one of
 * those absences is load-bearing:
 *
 * - **it always terminates**, so a rehearsal over a ghost field of ten thousand
 *   cannot hang, and neither can a live fold;
 * - **it can always be explained**, because a rule that fired has a finite
 *   witness and a sentence that a person wrote;
 * - **it is safe to hand to a stranger**, since a document carries data and
 *   never code. An embedded scripting language would be none of those.
 *
 * ## Where the facts come from
 *
 * Only from an ordered log of {@link Observation}s. pace-geojson has no clock of
 * its own, no database and no network — see `observe.ts` for why the bridge is
 * outside, and `fold.ts` for the evaluation order.
 *
 * @see SPEC.md §3.2
 */
import { PointId, RuleId } from './ids.ts'
import * as Schema from 'effect/Schema'
import * as SchemaTransformation from 'effect/SchemaTransformation'

/* ── when ────────────────────────────────────────────────────────────────── */

/**
 * The one instant shape: `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`.
 * SPEC.md §2.3.
 *
 * UTC and nothing else, because the bridge corrects clocks before anything is
 * logged. An offset is refused rather than converted: `07:50:00+02:00` is read
 * neither as 05:50 nor as 07:50, so no two readers can disagree about which it
 * was. `[0-9]` rather than `\d`, so the pattern means the same in a regex
 * engine whose `\d` matches every Unicode digit.
 */
export const INSTANT_PATTERN =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]{3})?Z$/

const leap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/**
 * A day that exists, an hour below 24, a minute and a second below 60.
 *
 * The pattern alone passes `2027-02-30T25:61:00Z`, and a date parser then
 * rolls it into March or refuses it depending on whose parser it is. No leap
 * second: a 60th second is not on a timeline every reader shares.
 */
const on_the_calendar = (text: string): boolean => {
  const year = Number(text.slice(0, 4))
  const month = Number(text.slice(5, 7))
  const day = Number(text.slice(8, 10))
  const days = [31, leap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0
  return (
    day >= 1 &&
    day <= days &&
    Number(text.slice(11, 13)) < 24 &&
    Number(text.slice(14, 16)) < 60 &&
    Number(text.slice(17, 19)) < 60
  )
}

/**
 * An instant as a document or a log carries one, decoded to a `DateTime.Utc`
 * and encoded back as `YYYY-MM-DDTHH:MM:SS.sssZ`. Anything else does not
 * decode — a malformed instant is a malformed file, never 1970.
 */
export const Instant = Schema.String.check(
  Schema.isPattern(INSTANT_PATTERN),
  Schema.makeFilter(on_the_calendar, {
    expected: 'a day that exists, an hour below 24, a minute and a second below 60',
  }),
)
  .annotate({
    description:
      'An instant in UTC: `2026-08-14T16:48:00.000Z`. Milliseconds optional, offset always `Z` (SPEC.md §2.3).',
  })
  .pipe(Schema.decodeTo(Schema.DateTimeUtc, SchemaTransformation.dateTimeUtcFromString))

/* ── where ───────────────────────────────────────────────────────────────── */

/**
 * A place on the course, addressed by how far along it is.
 *
 * `along_m`, never a coordinate. A course that doubles back has two places at
 * the same latitude and longitude and exactly one at 31 400 m, so a coordinate
 * is ambiguous exactly where a race is most likely to have a timing mat. It is
 * also the address every timing system in the world already uses.
 *
 * A named point resolves to its own `along_m` when the document is loaded; the
 * name survives into the rule so a sentence can say *"the summit station"* rather than
 * a number.
 */
export const Place = Schema.Struct({
  /** The document's id for this point, when it has one. */
  point: Schema.NullOr(PointId),
  along_m: Schema.Finite,
})
export type TPlace = typeof Place.Type

/**
 * A place, with its point id decoded.
 *
 * The one door for building a {@link Place} from a name a pack composed —
 * `lap-3-finish` — so the brand is applied once, here, rather than asserted at
 * every call site. `Id` carries no format check, so this cannot fail; it exists
 * to make the brand impossible to skip.
 */
export const place = (point: string | null, along_m: number): TPlace => ({
  point: point === null ? null : PointId.make(point),
  along_m,
})

/** A stretch of the course — a drafting zone, a neutralised descent, a lap. */
export const Span = Schema.Struct({
  from_m: Schema.Finite,
  to_m: Schema.Finite,
})
export type TSpan = typeof Span.Type

/** Where a rule applies. `null` is the whole day. */
export const Where = Schema.NullOr(Schema.Union([Place, Span]))
export type TWhere = typeof Where.Type

/* ── the facts a race knows ──────────────────────────────────────────────── */

/**
 * What happened to an entrant at a place.
 *
 * Movement only. A measurement or an official's declaration rides *on* an
 * observation rather than being a kind of its own, because both always happen
 * somewhere and at some time, and giving them their own kinds would double the
 * vocabulary to say the same thing.
 */
export const ObservationKind = Schema.Literals([
  'started',
  'passed',
  'entered',
  'left',
  'punched',
  'checked',
  'finished',
  'withdrew',
])
export type TObservationKind = typeof ObservationKind.Type

/** The comparisons. There is no arithmetic; this is the whole of it. */
export const Cmp = Schema.Literals(['lt', 'lte', 'gt', 'gte', 'eq', 'ne'])
export type TCmp = typeof Cmp.Type

/**
 * Which clock.
 *
 * `moving` excludes stretches the document neutralises and legs that stop the
 * clock — an overnight event's inn, a ferry, a stage race's transfer. `wall` is
 * the time of day, which is what a cutoff at 16:30 means. `split` is the time
 * between two places, which is what a drafting rule and a lap rule both need.
 */
export const ClockMeasure = Schema.Literals(['elapsed', 'moving', 'wall', 'split'])
export type TClockMeasure = typeof ClockMeasure.Type

/** Things there can be a number of. */
export const Countable = Schema.Literals(['laps', 'punches', 'penalties', 'observations'])
export type TCountable = typeof Countable.Type

/**
 * Something true of the rest of the field, not of one entrant.
 *
 * A 120% time cut, last-one-standing, the top three qualifying: these cannot be
 * decided from one runner's log. They are why the fold is stratified — see
 * `fold.ts`.
 */
export const Aggregate = Schema.Literals(['winner_elapsed', 'rank', 'remaining', 'finishers'])
export type TAggregate = typeof Aggregate.Type

/**
 * Where a day ended up.
 *
 * Four, in order of severity, which is also their precedence: a disqualified
 * runner is not also gated. Withdrawing is the fifth thing that happens to a
 * person, and it is a fact rather than a standing — `withdrew` on the entrant's
 * state, and the `withdrawn` atom below.
 */
export const Standing = Schema.Literals(['clean', 'penalised', 'gated', 'disqualified'])
export type TStanding = typeof Standing.Type

/* ── predicates ──────────────────────────────────────────────────────────── */

/**
 * One fact about an entrant, asked of the log.
 *
 * The eight of them are the whole of what a rule may know. Every one is
 * answerable from the accumulator in `fold.ts` with a single pass over what has
 * already been recorded, which is the property that makes a rehearsal over a
 * ghost field of ten thousand cheap.
 */
export const Atom = Schema.Union([
  /** Was there an observation of this kind at this place? */
  Schema.Struct({ _tag: Schema.Literal('observed'), at: Place, kind: ObservationKind }),
  /** Did these places happen in this order? Controls, laps, transitions. */
  Schema.Struct({ _tag: Schema.Literal('order'), sequence: Schema.Array(Place) }),
  /**
   * A clock against a span or a time of day.
   *
   * `value_ms` for a duration and `value_at` for a wall-clock instant, rather
   * than one field that means two things: seconds and milliseconds are the same
   * type, and a person writes penalties as `6:00` and cutoffs as `16:30`.
   * Being wrong by a factor of a thousand changes who finished.
   */
  Schema.Struct({
    _tag: Schema.Literal('clock'),
    measure: ClockMeasure,
    cmp: Cmp,
    value_ms: Schema.NullOr(Schema.Finite),
    value_at: Schema.NullOr(Instant),
    /** `split` only: the two places it is measured between. */
    from: Schema.NullOr(Place),
    to: Schema.NullOr(Place),
  }),
  Schema.Struct({ _tag: Schema.Literal('count'), what: Countable, cmp: Cmp, value: Schema.Finite }),
  /** Any measured thing: a pack's weight, the water's temperature, a wattage. */
  Schema.Struct({
    _tag: Schema.Literal('quantity'),
    name: Schema.String,
    cmp: Cmp,
    value: Schema.Finite,
  }),
  /** An official's declaration, or a condition of the day. */
  Schema.Struct({ _tag: Schema.Literal('flag'), name: Schema.String }),
  /**
   * Where the entrant stands *right now*, mid-fold.
   *
   * Added because the first backyard fixture crowned the runner who had just
   * been put out: last-one-standing is two conditions and only one of them is
   * about the field. Every sport has a *still in it* clause, and without this
   * each pack would have to fake one out of the observation log.
   */
  Schema.Struct({ _tag: Schema.Literal('standing'), is: Standing }),
  /**
   * Did they stop of their own accord?
   *
   * Its own atom rather than a fifth {@link Standing}, because withdrawing is
   * orthogonal to how a rule has judged you — a runner can withdraw while
   * carrying a penalty — and folding it into the standings would make
   * *"penalised"* and *"went home"* mutually exclusive, which they are not.
   *
   * Found by the end-to-end fixture: without it, `last_standing` crowned the
   * runner who had walked off two laps earlier, because she was still `clean`.
   */
  Schema.Struct({ _tag: Schema.Literal('withdrawn') }),
  /** Something true of the field. Only answerable from a later stratum. */
  Schema.Struct({
    _tag: Schema.Literal('field'),
    aggregate: Aggregate,
    cmp: Cmp,
    value: Schema.Finite,
    ratio: Schema.NullOr(Schema.Finite),
  }),
])
export type TAtom = typeof Atom.Type

/** An atom, possibly denied. `not` is a flag rather than a wrapper — see below. */
export const Clause = Schema.Struct({ negated: Schema.Boolean, atom: Atom })
export type TClause = typeof Clause.Type

/**
 * The `when` half of a rule: **two levels, and no more**.
 *
 * A combinator over a flat list of clauses, rather than a tree that nests. That
 * is a deliberate narrowing and it is worth the loss:
 *
 * - **"No recursion" becomes structural.** The kernel's central promise is that
 *   every rule terminates and can be simulated. As a self-referencing union
 *   that was a convention enforced by nobody, and it cost a handful of casts to
 *   walk. As a list it is a fact about the type.
 * - **Nothing wanted the depth.** Every kind in every dialect shipped —
 *   athletics, backyard, orienteering, triathlon — is one `all` or one `any`
 *   over at most three clauses. A rule that genuinely needed
 *   *(a and b) or (c and d)* is two rules, which is also how a person would
 *   write it down.
 * - **It stays readable.** A document's rules can be printed as a list of
 *   sentences with *and* or *or* between them, in any language a
 *   reader speaks, without a tree walk.
 */
export const Predicate = Schema.Struct({
  combine: Schema.Literals(['all', 'any']),
  clauses: Schema.Array(Clause),
})
export type TPredicate = typeof Predicate.Type

/** `all` of one clause — the shape most rules are. */
export const all_of = (...clauses: ReadonlyArray<TClause>): TPredicate => ({
  combine: 'all',
  clauses,
})
export const any_of = (...clauses: ReadonlyArray<TClause>): TPredicate => ({
  combine: 'any',
  clauses,
})
export const is = (atom: TAtom): TClause => ({ negated: false, atom })
export const not = (atom: TAtom): TClause => ({ negated: true, atom })

/* ── effects ─────────────────────────────────────────────────────────────── */

/** The `then` half. Five, and every rule any sport has needed reduces to them. */
export const Consequence = Schema.Union([
  Schema.Struct({
    _tag: Schema.Literal('adjust_time'),
    by_ms: Schema.Finite,
    each_time: Schema.Boolean,
  }),
  Schema.Struct({
    _tag: Schema.Literal('set_standing'),
    standing: Standing,
    reason: Schema.String,
  }),
  /** A dimension and a value: category, wave, lap group, placing band. */
  Schema.Struct({
    _tag: Schema.Literal('classify'),
    dimension: Schema.String,
    value: Schema.String,
  }),
  Schema.Struct({ _tag: Schema.Literal('award'), name: Schema.String }),
  /** The clock does not count between these two places. */
  Schema.Struct({ _tag: Schema.Literal('neutralise'), from: Place, to: Place }),
])
export type TConsequence = typeof Consequence.Type

/* ── a rule ──────────────────────────────────────────────────────────────── */

/**
 * One rule, expanded into the kernel.
 *
 * `dialect` and `kind` are kept even though the expansion is complete, for two
 * reasons that are worth the two columns: a reader needs to know *which sport's
 * rule this is* to argue with it, and a document written against a pack we no
 * longer ship has to be refusable by name rather than silently mis-run.
 *
 * `stratum` is 0 unless the rule reads a `field` aggregate — see `fold.ts`.
 */
export const KernelRule = Schema.Struct({
  id: RuleId,
  dialect: Schema.String,
  kind: Schema.String,
  ordinal: Schema.Finite,
  at: Where,
  when: Predicate,
  then: Consequence,
  /** The sentence as a person read it. Never a regenerated paraphrase. */
  sentence: Schema.String,
  stratum: Schema.Finite,
})
export type TKernelRule = typeof KernelRule.Type

/** Does this predicate read the field? Decides which stratum a rule belongs in. */
export const reads_field = (predicate: TPredicate): boolean =>
  predicate.clauses.some((clause) => clause.atom._tag === 'field')

/** Compare, once, in the one place the vocabulary allows it. */
export const compare = (left: number, cmp: TCmp, right: number): boolean => {
  switch (cmp) {
    case 'lt':
      return left < right
    case 'lte':
      return left <= right
    case 'gt':
      return left > right
    case 'gte':
      return left >= right
    case 'eq':
      return left === right
    case 'ne':
      return left !== right
  }
}
