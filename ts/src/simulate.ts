/**
 * A ghost field: a course document in, an observation log out.
 *
 * Every log sport-lang has been exercised against so far was written by hand,
 * which is fine for pinning a rule and useless for the two things wanted next —
 * a simulator somebody can turn dials on, and enough conformance cases that a
 * second implementation cannot quietly diverge. Both need plausible races by
 * the thousand.
 *
 * ## Deterministic, from a seed
 *
 * No `Math.random`. The same seed and the same config give the same log,
 * byte for byte, forever — which is the same promise the fold makes and for the
 * same reason: a simulated race that cannot be reproduced cannot be used to
 * argue about a rule, and a conformance case generated from one would rot.
 *
 * ## It simulates movement, not judgement
 *
 * The simulator decides where people are and when. It never decides that
 * somebody was gated, penalised or crowned — the rules do that, from the log.
 * So a backyard ultra needs no special case here: give runners a pace spread
 * and some of them will fail to close a lap inside the hour, and `backyard@1`
 * will put them out. That separation is what makes turning the dials an
 * assessment of the *language* rather than of this file.
 *
 * @see src/fold.ts — what consumes the log
 * @see SPEC.md — §2.3, the shape being produced
 */
import { DeviceId, EntrantId, ObservationId } from './ids.ts'
import * as Arr from 'effect/Array'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Order from 'effect/Order'
import * as Schema from 'effect/Schema'

import type { TCourseDocument } from './document.ts'
import { points_of, produces } from './document.ts'
import { ObservationKind } from './kernel.ts'
import type { TObservation, TSourceKind } from './observe.ts'

/* ── a seeded stream ─────────────────────────────────────────────────────── */

/**
 * mulberry32 — thirty-two bits of state, uniform enough for a ghost field.
 *
 * Written out rather than pulled in because the requirement is not statistical
 * quality, it is that *this* sequence is the same in a browser, in a Worker,
 * and in whatever language reads a generated case back. A dependency that
 * changes its algorithm in a minor release would invalidate every stored log.
 */
const stream = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296
  }
}

/** Box–Muller, so a pace spread is a bell rather than a block. */
const normal = (next: () => number): number => {
  const u = Math.max(next(), Number.EPSILON)
  const v = next()
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)
}

/* ── the dials ───────────────────────────────────────────────────────────── */

export const FieldConfig = Schema.Struct({
  /** The whole run is a function of this. Change it for a different field. */
  seed: Schema.Finite,
  entrants: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  /** When the gun goes. Everyone starts together unless `wave_gap_s` says otherwise. */
  start_at: Schema.DateTimeUtcFromString,
  /** The median runner's pace, in seconds per kilometre. */
  pace_s_per_km: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  /**
   * How spread the field is, as a fraction of the median pace.
   *
   * 0.15 is a road race — the tail finishes about half again as slowly as the
   * middle. 0.35 is a trail ultra, where the spread is the story.
   */
  pace_spread: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** Seconds between waves. Zero is a mass start. */
  wave_gap_s: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** How many runners per wave. Ignored when `wave_gap_s` is zero. */
  wave_size: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(1)),
  /**
   * The chance a mat does not see a runner it should have.
   *
   * The reason two read points exist on a real timing mat, and the reason this
   * dial matters: a rule that fires on *not observed here* is only as good as
   * the hardware, and a simulator that never drops a read would let somebody
   * design a rule that falls apart on the day.
   */
  mat_miss: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Seconds of noise on each read, either side. */
  read_jitter_s: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
  /** The chance a runner stops somewhere and does not come back. */
  dnf: Schema.Finite.check(Schema.isBetween({ minimum: 0, maximum: 1 })),
  /** Flags an official might raise, and how often, per entrant per place. */
  flags: Schema.Array(Schema.Struct({ name: Schema.String, chance: Schema.Finite })),
  /** A measurement taken at the start — water temperature, a pack's weight. */
  quantities: Schema.Array(
    Schema.Struct({ name: Schema.String, mean: Schema.Finite, spread: Schema.Finite }),
  ),
  /**
   * How often a corral releases, in seconds. Zero means nobody waits.
   *
   * Without it, with pace alone, lap two begins the instant lap one ends, so a runner who
   * loses the hour once loses it every time and the field never separates. A
   * backyard's whole shape is that everybody who made it starts the next lap
   * *together*, on the hour, and the rest of the field is waiting.
   *
   * It generalises past backyards: this is what a wave start, a staged start
   * and a Le Mans start all are.
   */
  corral_s: Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),
})
export type TFieldConfig = typeof FieldConfig.Type

/** The canonical table returns a string; the log wants the closed kind. */
const as_kind = Schema.decodeUnknownSync(ObservationKind)

/**
 * A field of ghosts running a course.
 *
 * Points are visited in `along_m` order, so a lapped document — where a lap is
 * a place rather than a repetition — is walked correctly without this knowing
 * what a lap is.
 */
export const simulate = (
  document: TCourseDocument,
  config: TFieldConfig,
): ReadonlyArray<TObservation> => {
  const next = stream(config.seed)
  const places = Arr.sort(
    points_of(document),
    Order.mapInput(Order.Number, (p: { readonly along_m: number }) => p.along_m),
  )
  const log: Array<TObservation> = []
  const device = DeviceId.make('dev_ghost')

  for (let n = 0; n < config.entrants; n += 1) {
    const entrant = EntrantId.make(`ent_ghost_${String(n).padStart(4, '0')}`)
    // A pace multiplier around 1, floored so nobody runs backwards.
    const pace = Math.max(0.35, 1 + normal(next) * config.pace_spread)
    const wave = config.wave_gap_s === 0 ? 0 : Math.floor(n / config.wave_size) * config.wave_gap_s
    const gun = DateTime.addDuration(config.start_at, Duration.seconds(wave))
    // Where they stop, if they stop. Drawn once so a runner does not flicker.
    const quits = next() < config.dnf ? Math.floor(next() * places.length) : places.length

    const seconds_over = (metres: number) =>
      (Math.max(0, metres) / 1000) * config.pace_s_per_km * pace

    const measure = (index: number) =>
      config.quantities.map((q) => ({ name: q.name, value: q.mean + normal(next) * q.spread }))[
        index
      ]

    // A measurement taken before the gun — the water, the pack on the scales.
    const first_quantity = config.quantities.length === 0 ? undefined : measure(0)
    if (first_quantity !== undefined) {
      log.push({
        id: ObservationId.make(`obs_${entrant}_check`),
        entrant,
        at: { point: null, along_m: 0 },
        kind: 'checked',
        t: DateTime.subtractDuration(gun, Duration.minutes(30)),
        quantity_name: first_quantity.name,
        quantity_value: Math.round(first_quantity.value * 100) / 100,
        flags: [],
        source: 'manual' satisfies TSourceKind,
        device: null,
        confidence: 1,
        supersedes: null,
      })
    }

    log.push({
      id: ObservationId.make(`obs_${entrant}_gun`),
      entrant,
      at: { point: null, along_m: 0 },
      kind: 'started',
      t: gun,
      quantity_name: null,
      quantity_value: null,
      flags: [],
      source: 'manual' satisfies TSourceKind,
      device: null,
      confidence: 1,
      supersedes: null,
    })

    let last_seen = gun
    // A running clock rather than a distance-times-pace sum, so a corral can
    // hold somebody and everything after it moves with them.
    let now = gun
    let at_m = 0
    places.forEach((place, index) => {
      if (index >= quits) return
      now = DateTime.addDuration(
        now,
        Duration.millis(Math.round(seconds_over(place.along_m - at_m) * 1000)),
      )
      at_m = place.along_m
      // A corral releases on a boundary. Whoever arrives inside the window
      // waits for it; whoever is late has already been judged by then, but the
      // simulator does not know that and does not need to — it moves people.
      if (config.corral_s > 0 && place.kind === 'corral') {
        const since = DateTime.toEpochMillis(now) - DateTime.toEpochMillis(gun)
        const waited = Math.ceil(since / (config.corral_s * 1000)) * config.corral_s * 1000
        now = DateTime.addDuration(gun, Duration.millis(waited))
      }
      // The start line is already recorded by the gun.
      if (place.along_m === 0 && produces(place.kind) === 'started') return
      // Every draw happens whether or not the read survives, so dropping a mat
      // does not shift the rest of the field's random stream.
      const jitter = (next() - 0.5) * 2 * config.read_jitter_s
      const missed = next() < config.mat_miss
      const raised = config.flags.filter((flag) => next() < flag.chance).map((flag) => flag.name)
      if (missed) return
      const at = DateTime.addDuration(now, Duration.millis(Math.round(jitter * 1000)))
      last_seen = at
      log.push({
        id: ObservationId.make(`obs_${entrant}_${place.id}`),
        entrant,
        at: { point: place.id, along_m: place.along_m },
        kind: as_kind(produces(place.kind)),
        t: at,
        quantity_name: null,
        quantity_value: null,
        flags: raised,
        source: 'transponder' satisfies TSourceKind,
        device,
        confidence: 1,
        supersedes: null,
      })
    })

    if (quits < places.length) {
      const where = places[Math.max(0, quits - 1)]
      // A second after whatever was last seen of them, rather than the time
      // they *should* have reached the last place: read jitter can push a mat
      // read later than the ideal arrival, and a withdrawal stamped before a
      // read of the same runner is a log that says they carried on afterwards.
      const stopped = DateTime.max(last_seen, now)
      log.push({
        id: ObservationId.make(`obs_${entrant}_out`),
        entrant,
        at: { point: where?.id ?? null, along_m: where?.along_m ?? 0 },
        kind: 'withdrew',
        t: DateTime.addDuration(stopped, Duration.seconds(1)),
        quantity_name: null,
        quantity_value: null,
        flags: [],
        source: 'manual' satisfies TSourceKind,
        device: null,
        confidence: 1,
        supersedes: null,
      })
    }
  }

  return log
}

/** A road race: a tight field, reliable mats, a few who stop. */
export const ROAD: Omit<TFieldConfig, 'start_at'> = {
  seed: 1,
  entrants: 200,
  pace_s_per_km: 330,
  pace_spread: 0.15,
  wave_gap_s: 0,
  wave_size: 1,
  mat_miss: 0.01,
  read_jitter_s: 2,
  dnf: 0.03,
  flags: [],
  quantities: [],
  corral_s: 0,
}

/** A trail ultra: the spread is the story, and the mats are further apart. */
export const TRAIL: Omit<TFieldConfig, 'start_at'> = {
  ...ROAD,
  entrants: 120,
  pace_s_per_km: 600,
  pace_spread: 0.35,
  mat_miss: 0.04,
  read_jitter_s: 15,
  dnf: 0.18,
}
