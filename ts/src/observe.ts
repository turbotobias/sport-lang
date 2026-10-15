/**
 * The one thing pace-geojson consumes, and the boundary it consumes it across.
 *
 * **pace-geojson has no IO.** A transponder mat, a GPS tracker, a judge's tablet,
 * a partner timing system's webhook, a runner uploading the FIT off their
 * watch: not one of them appears in the language. They sit behind a *bridge*
 * whose only output is an ordered log of the observations below.
 *
 * The line is drawn exactly here because everything genuinely hard about timing
 * is an IO problem wearing a rules costume, and each of the four would make the
 * language untestable if it were inside it:
 *
 * 1. **Identity.** A transponder id is not an entrant. Tags are reassigned,
 *    swapped, and worn by the wrong person. The bridge owns the tag ↔ entrant
 *    binding *over time*, so a log carries entrant ids and a correction is a
 *    rebinding rather than a rewrite of history.
 * 2. **Clock discipline.** Every reader's clock drifts. The bridge stamps three
 *    times — the device's, the received-at, and the corrected — and owns the
 *    correction. pace-geojson sees one monotonic timeline, without which *"arrives
 *    after 16:30"* is a lottery.
 * 3. **Dedupe.** A mat sees a tag forty times in three seconds. One `passed`
 *    comes out with the first-seen time; the forty raw reads stay for the protest.
 * 4. **Lateness.** A reader that was offline uploads an hour later. The log is
 *    append-only but *ordered by observation time*, so a late arrival means
 *    re-folding from that point — correct by construction precisely because the
 *    fold is deterministic. A timing system that cannot re-fold has to guess.
 *
 * **A correction never edits.** It supersedes, which is what gives a protest an
 * audit trail and what lets the same log be re-folded to reproduce any result
 * the race ever showed.
 *
 * @see SPEC.md §2.3
 */
import { DeviceId, EntrantId, ObservationId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as HashSet from 'effect/HashSet'
import * as MutableHashSet from 'effect/MutableHashSet'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'
import { decodeResult, decodeUnknownResult } from 'effect/SchemaParser'

import { Instant, ObservationKind, Place } from './kernel.ts'
import { JsonText } from './text.ts'

/**
 * Where an observation came from, and how much to believe it.
 *
 * `manual` exists so that the thing which saves a race when the mat fails — a
 * timestamped video, a hand-pressed button — arrives through the same door as
 * everything else, at a lower confidence, rather than through a side channel
 * nobody modelled.
 *
 * `virtual` is a body that ran in a simulation rather than on a road: a
 * simulated field, a rehearsal, a virtual participant. It is a *source*, not a
 * mode — the fold does not branch on it and must not, because every entrant in
 * a race is scored by the same rules. It is recorded so a result list can say
 * which of its entrants were virtual.
 */
export const SourceKind = Schema.Literals([
  'transponder',
  'gps',
  'watch_upload',
  'manual',
  'partner',
  'virtual',
])
export type TSourceKind = typeof SourceKind.Type

export const Observation = Schema.Struct({
  id: ObservationId,
  entrant: EntrantId,
  at: Place,
  kind: ObservationKind,
  /** The corrected instant. The device's own clock never reaches this far. */
  t: Instant,
  /** A measurement taken here — a pack's weight, the water's temperature. */
  quantity_name: Schema.NullOr(Schema.String),
  quantity_value: Schema.NullOr(Schema.Finite),
  /** What an official declared here. */
  flags: Schema.Array(Schema.String),
  source: SourceKind,
  device: Schema.NullOr(DeviceId),
  confidence: Schema.Finite,
  /** A correction names what it replaces. The replaced row stays. */
  supersedes: Schema.NullOr(ObservationId),
})
export type TObservation = typeof Observation.Type

/** A log: a JSON array of observations, in any order (SPEC.md §2.3). */
export const Log = Schema.Array(Observation)
/** A log from **its text**: SPEC.md §4.2's `parse_log`, the laws of the text included. */
export const parse_log = decodeResult(JsonText.pipe(Schema.decodeTo(Log)))
/** A log from a value a JSON parser already made: the per-field rules, and not the text's. */
export const decode_log = decodeUnknownResult(Log)
export const encode_log = Schema.encodeSync(Log)

/* ── the law a per-field check cannot see ────────────────────────────────── */

/** A log that decoded but does not hold together. */
export type TBrokenLogLaw = {
  readonly law: 'an observation id is used twice'
  readonly what: string
}

/**
 * Everything true of a log that a per-field check cannot express. One law.
 *
 * **An id is unique within a log.** It is the second sort key and what a
 * `supersedes` names, so two rows sharing one make a result depend on the
 * order they arrived in — a stable sort keeps them as they came — and a
 * correction naming the id removes both. A reader numbering reads per device,
 * or merging two feeds, produces exactly this; the producer namespaces its ids
 * (by device, say) and a reader refuses the log rather than guess.
 *
 * Separate from {@link settle} and {@link fold} on purpose: those stay total —
 * a rehearsal never fails — and a host that takes a log from outside asks this
 * first, as the WebAssembly `run` does.
 */
export const broken_log_laws = (log: ReadonlyArray<TObservation>): ReadonlyArray<TBrokenLogLaw> => {
  const seen = MutableHashSet.empty<string>()
  const twice = MutableHashSet.empty<string>()
  const broken: Array<TBrokenLogLaw> = []
  for (const o of log) {
    if (!MutableHashSet.has(seen, o.id)) MutableHashSet.add(seen, o.id)
    else if (!MutableHashSet.has(twice, o.id)) {
      MutableHashSet.add(twice, o.id)
      broken.push({ law: 'an observation id is used twice', what: o.id })
    }
  }
  return broken
}

/** An observation with its instant read out once, for the sort. */
type TKeyed = { readonly o: TObservation; readonly ms: number }

/**
 * The log as the fold must see it: superseded rows dropped, then ordered.
 *
 * Ordered by instant, then by id — the second key is not decoration. Two mats
 * can stamp the same millisecond, and a fold whose result depends on which one
 * the database happened to return first is not reproducible, which would cost
 * the whole design its point. That holds for a log whose ids are unique, which
 * {@link broken_log_laws} checks.
 *
 * Linear before the sort: the superseded ids are a set, and each instant is
 * read once rather than at every comparison.
 */
export const settle = (log: ReadonlyArray<TObservation>): ReadonlyArray<TObservation> => {
  const replaced = HashSet.fromIterable(
    log.flatMap((o) => (o.supersedes === null ? [] : [o.supersedes])),
  )
  const kept = HashSet.size(replaced) === 0 ? log : log.filter((o) => !HashSet.has(replaced, o.id))
  return Arr.sort(
    kept.map((o): TKeyed => ({ o, ms: DateTime.toEpochMillis(o.t) })),
    Order.combine(
      Order.mapInput(Order.Number, (k: TKeyed) => k.ms),
      Order.mapInput(Order.String, (k: TKeyed) => k.o.id),
    ),
  ).map((k) => k.o)
}
