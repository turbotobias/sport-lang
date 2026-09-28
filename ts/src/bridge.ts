/**
 * The bridge — everything hard about timing, kept out of the language.
 *
 * sport-lang has no IO. A transponder mat, a GPS tracker, a judge's tablet, a
 * partner's webhook, a runner uploading the FIT off their watch: not one of
 * them appears in the kernel. They arrive here, and what leaves is an ordered
 * log of observations and nothing else.
 *
 * The line is drawn exactly here because each of the four problems below would
 * make the language untestable if it were inside it, and none of them is about
 * rules:
 *
 * 1. **Identity.** A transponder id is not an entrant. Tags are reassigned
 *    between races, swapped at the expo, and worn by the wrong person. The
 *    binding is owned *over time*, so a correction is a rebinding rather than a
 *    rewrite of history — and a read whose tag nobody assigned is reported
 *    rather than dropped, because on the day that is a person standing at a mat
 *    wondering why the beep did not happen.
 * 2. **Clock discipline.** Every reader's clock drifts. A read carries three
 *    instants — the device's, the received-at, and the corrected — and only the
 *    third reaches the fold. Without it *"arrives after 16:30"* is a lottery.
 * 3. **Dedupe.** A mat sees a tag forty times in three seconds. One `passed`
 *    comes out, stamped with the *first* sighting, and the forty are counted so
 *    a protest can ask.
 * 4. **Lateness.** A reader offline for an hour uploads late. Nothing here
 *    needs to know: the log is ordered by observation time and the fold is a
 *    function of the log, so a late arrival is a re-fold and is correct by
 *    construction.
 *
 * ## Nothing is thrown away
 *
 * Every function here returns what it could not use alongside what it could.
 * A bridge that silently dropped an unbindable read would be a timing system
 * that loses people quietly, which is the failure mode that ends up in a
 * newspaper.
 *
 * @see src/observe.ts — the shape that leaves here
 * @see SPEC.md — §4, the boundary
 */
import { DeviceId, EntrantId, ObservationId, ReadId } from './ids.ts'
import type { TEntrantId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import { produces, type TCourseDocument } from './document.ts'
import { ObservationKind } from './kernel.ts'
import type { TObservation, TSourceKind } from './observe.ts'

/* ── what a device actually emits ────────────────────────────────────────── */

/**
 * One raw sighting, before anybody knows who it was or exactly when.
 *
 * `device_t` and `received_t` are both kept because their *difference* is the
 * evidence: a reader whose clock has drifted an hour shows it here, and a
 * reader that was offline for an hour shows it here too, and they are not the
 * same problem.
 */
export const RawRead = Schema.Struct({
  id: ReadId,
  device: DeviceId,
  /** What the reader saw — an EPC, a chip code, a bib number. Not an entrant. */
  tag: Schema.String,
  /** Where the device is on the course. A mat does not move. */
  at: Schema.Struct({ point: Schema.NullOr(Schema.String), along_m: Schema.Finite }),
  /** The device's own clock, which is wrong by an amount only it knows. */
  device_t: Schema.DateTimeUtcFromString,
  /** When it reached us. Later than the truth, never earlier. */
  received_t: Schema.DateTimeUtcFromString,
  /**
   * Signal strength, when the reader reports it. Kept, not read: this bridge
   * stamps a burst at its first sighting, and choosing the strongest read — the
   * closest pass — is an integrator's refinement (SPEC.md §4).
   */
  rssi: Schema.NullOr(Schema.Finite),
})
export type TRawRead = typeof RawRead.Type

/**
 * A tag belonging to an entrant, for a while.
 *
 * `to` is null while it still does. Bounded rather than absolute because the
 * same chip is worn by somebody else next season, and a log re-folded a year
 * later must not silently give last year's result to this year's runner.
 */
export const TagBinding = Schema.Struct({
  tag: Schema.String,
  entrant: EntrantId,
  from: Schema.DateTimeUtcFromString,
  to: Schema.NullOr(Schema.DateTimeUtcFromString),
})
export type TTagBinding = typeof TagBinding.Type

/** What to add to a device's clock to get the truth. Measured, not guessed. */
export const Drift = Schema.Struct({ device: DeviceId, offset_ms: Schema.Finite })
export type TDrift = typeof Drift.Type

/** A read the bridge could not use, and why. Never silently dropped. */
export type TStranded = {
  readonly read: TRawRead
  readonly why: 'no tag binding' | 'the binding had expired' | 'the place is not on the course'
}

export type TBridged = {
  readonly observations: ReadonlyArray<TObservation>
  /** Reads nobody could be identified from. On the day, these are people. */
  readonly stranded: ReadonlyArray<TStranded>
  /** How many raw reads each observation stands for, so a protest can ask. */
  readonly collapsed: ReadonlyArray<{ readonly observation: string; readonly reads: number }>
}

/* ── the pipeline ────────────────────────────────────────────────────────── */

const ms = (t: DateTime.Utc) => DateTime.toEpochMillis(t)
const as_kind = Schema.decodeUnknownSync(ObservationKind)

/**
 * The instant a read actually happened.
 *
 * The device's clock plus its measured drift. A device with no measured drift
 * is trusted, which is a decision rather than an oversight: inventing a
 * correction would be worse than using the number the hardware reported.
 */
export const corrected = (read: TRawRead, drifts: ReadonlyArray<TDrift>): DateTime.Utc => {
  const drift = drifts.find((d) => d.device === read.device)
  return drift === undefined
    ? read.device_t
    : DateTime.addDuration(read.device_t, Duration.millis(drift.offset_ms))
}

/** Who was wearing this tag at this instant, if anybody. */
export const bound_to = (
  tag: string,
  at: DateTime.Utc,
  bindings: ReadonlyArray<TTagBinding>,
): TEntrantId | null => {
  const found = bindings.find(
    (b) => b.tag === tag && ms(b.from) <= ms(at) && (b.to === null || ms(at) < ms(b.to)),
  )
  return found?.entrant ?? null
}

/**
 * Raw reads into observations.
 *
 * The order matters and is the order of the four problems: correct the clock
 * first, because everything downstream is decided by time; then identify,
 * because a burst can only be collapsed per person; then collapse; and never
 * sort by arrival, because the log's order is observation time and lateness is
 * somebody else's problem — specifically, the fold's, which handles it by being
 * a function.
 */
export const bridge = (
  reads: ReadonlyArray<TRawRead>,
  document: TCourseDocument,
  options: {
    readonly bindings: ReadonlyArray<TTagBinding>
    readonly drifts: ReadonlyArray<TDrift>
    /** Reads of one tag at one place inside this window are one sighting. */
    readonly debounce_ms: number
  },
): TBridged => {
  const places = document.features.flatMap((f) =>
    f.properties.role === 'point' && f.geometry.type === 'Point'
      ? [{ id: f.properties.id, kind: f.properties.kind, along_m: f.properties.along_m }]
      : [],
  )

  const stranded: Array<TStranded> = []
  // The places keep their branded ids: annotating them as `string` here would
  // throw the brand away and cost a cast at every use of it below.
  const resolved: Array<{
    readonly read: TRawRead
    readonly t: DateTime.Utc
    readonly entrant: TEntrantId
    readonly place: (typeof places)[number]
  }> = []

  for (const read of reads) {
    const t = corrected(read, options.drifts)
    const place =
      places.find((p) => p.id === read.at.point) ??
      places.find((p) => Math.abs(p.along_m - read.at.along_m) <= 10)
    if (place === undefined) {
      stranded.push({ read, why: 'the place is not on the course' })
      continue
    }
    const entrant = bound_to(read.tag, t, options.bindings)
    if (entrant === null) {
      // Was it ever bound? "Nobody has this tag" and "somebody had it last
      // season" are different conversations at the timing tent.
      const ever = options.bindings.some((b) => b.tag === read.tag)
      stranded.push({ read, why: ever ? 'the binding had expired' : 'no tag binding' })
      continue
    }
    resolved.push({ read, t, entrant, place })
  }

  // A burst is one sighting: same entrant, same place, inside the window. The
  // *first* is the crossing — a runner is at the mat when the mat first sees
  // them, and the reads after it are them walking away.
  const ordered = Arr.sort(
    resolved,
    Order.combine(
      Order.mapInput(Order.Number, (r: (typeof resolved)[number]) => ms(r.t)),
      Order.mapInput(Order.String, (r: (typeof resolved)[number]) => r.read.id),
    ),
  )

  const observations: Array<TObservation> = []
  const collapsed: Array<{ observation: string; reads: number }> = []
  const opened: Array<{ key: string; index: number; until: number }> = []

  for (const row of ordered) {
    const key = `${row.entrant}|${row.place.id}`
    const open = opened.find((o) => o.key === key && ms(row.t) <= o.until)
    if (open !== undefined) {
      const tally = collapsed[open.index]
      if (tally !== undefined) collapsed[open.index] = { ...tally, reads: tally.reads + 1 }
      continue
    }
    const id = ObservationId.make(`obs_${row.entrant}_${row.place.id}_${ms(row.t)}`)
    observations.push({
      id,
      entrant: row.entrant,
      at: { point: row.place.id, along_m: row.place.along_m },
      kind: as_kind(produces(row.place.kind)),
      t: row.t,
      quantity_name: null,
      quantity_value: null,
      flags: [],
      source: 'transponder' satisfies TSourceKind,
      device: row.read.device,
      confidence: 1,
      supersedes: null,
    })
    collapsed.push({ observation: id, reads: 1 })
    opened.push({ key, index: collapsed.length - 1, until: ms(row.t) + options.debounce_ms })
  }

  return { observations, stranded, collapsed }
}

/* ── the first device: a watch ───────────────────────────────────────────── */

/** A recorded track: `[lat, lon, seconds from the start]`, in order. */
export type TTrack = ReadonlyArray<readonly [number, number, number]>

export type TSelfTimed = {
  readonly observations: ReadonlyArray<TObservation>
  /** Null when the track is a race; a reason when it is not this race. */
  readonly refused: string | null
}

/**
 * A runner's own watch as the timing system.
 *
 * The cheapest timing system that exists and, for most small races, the only
 * one that ever will: a FIT off a watch, decoded by the host, crossed against
 * the document's places. It costs nothing and it works today.
 *
 * **It refuses a track that is not this course.** A watch will happily record a
 * different race, a training run, or a drive home, and accepting one would put
 * a finish time on somebody who was not there. The test is the only one
 * available without map-matching — the track's own length against the course's
 * — and it is deliberately generous, because a watch that lost signal in a
 * tunnel is still that runner's race.
 */
export const self_timed = (
  track: TTrack,
  document: TCourseDocument,
  entrant: TEntrantId,
  started_at: DateTime.Utc,
  options: { readonly tolerance: number } = { tolerance: 0.15 },
): TSelfTimed => {
  const places = Arr.sort(
    document.features.flatMap((f) =>
      f.properties.role === 'point' && f.geometry.type === 'Point'
        ? [{ id: f.properties.id, kind: f.properties.kind, along_m: f.properties.along_m }]
        : [],
    ),
    Order.mapInput(Order.Number, (p: { readonly along_m: number }) => p.along_m),
  )
  const course_m = document['sport:path'].reduce(
    (total, e) => total + (e.to_m - e.from_m) * e.repeat,
    0,
  )
  if (track.length < 2 || course_m <= 0)
    return { observations: [], refused: 'the track has no line in it' }

  // Distance along the track, on a sphere: the track is only compared with the
  // course within the 15% gate below, where the sphere's 0.5% does not matter.
  const along: Array<number> = [0]
  for (let i = 1; i < track.length; i += 1) {
    const a = track[i - 1]
    const b = track[i]
    along.push((along[i - 1] ?? 0) + (a !== undefined && b !== undefined ? haversine(a, b) : 0))
  }
  const track_m = along[along.length - 1] ?? 0
  const off = Math.abs(track_m - course_m) / course_m
  if (off > options.tolerance) {
    return {
      observations: [],
      refused: `the track is ${(track_m / 1000).toFixed(1)} km against a course of ${(course_m / 1000).toFixed(1)} km`,
    }
  }

  // Where the runner was when they had covered this much of their own track.
  const at_distance = (metres: number): number => {
    const wanted = Math.min(metres, track_m)
    let i = 1
    while (i < along.length && (along[i] ?? 0) < wanted) i += 1
    const a = track[i - 1]
    const b = track[i] ?? a
    const before = along[i - 1] ?? 0
    const after = along[i] ?? before
    if (a === undefined || b === undefined) return 0
    const share = after - before <= 0 ? 0 : (wanted - before) / (after - before)
    return a[2] + (b[2] - a[2]) * share
  }

  const observations = places.map((place): TObservation => {
    // The runner's own distance, scaled to the course's — a watch that measured
    // 42.6 km on a 42.2 km course did not add four hundred metres of race.
    const seconds = at_distance((place.along_m / course_m) * track_m)
    return {
      id: ObservationId.make(`obs_${entrant}_${place.id}`),
      entrant,
      at: { point: place.id, along_m: place.along_m },
      kind: as_kind(produces(place.kind)),
      t: DateTime.addDuration(started_at, Duration.millis(Math.round(seconds * 1000))),
      quantity_name: null,
      quantity_value: null,
      flags: [],
      // Said plainly, so a result can show where it came from. A watch is not a
      // mat, and a race that mixes them should be able to say which is which.
      source: 'watch_upload' satisfies TSourceKind,
      device: DeviceId.make(`dev_watch_${entrant}`),
      confidence: 0.8,
      supersedes: null,
    }
  })

  return { observations, refused: null }
}

const EARTH_M = 6_371_008.8
const rad = (deg: number) => (deg * Math.PI) / 180

/**
 * Great-circle metres, for the track's own length only.
 *
 * A sphere is right here and wrong for the course: this figure is compared
 * against the course's within a 15% gate, where a tenth of a percent cannot
 * matter, and the course's own length is measured on the ellipsoid where it
 * does (SPEC.md §2.4).
 */
const haversine = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): number => {
  const d_lat = rad(b[0] - a[0])
  const d_lon = rad(b[1] - a[1])
  const h =
    Math.sin(d_lat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(d_lon / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}
