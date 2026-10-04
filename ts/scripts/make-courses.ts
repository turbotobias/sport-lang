/**
 * The synthetic courses — the geometry every generated conformance case runs on.
 *
 * The corpus has to carry lines, and an organiser's GPX is theirs, not ours to
 * relicense. So every course here is drawn by this file: procedural, seeded,
 * and placed in open sea off 0.5° N 0.5° E, where nobody will mistake one for a
 * race that exists.
 *
 * ```
 * node ts/scripts/make-courses.ts
 * ```
 *
 * ## What they have to be, and why
 *
 * **The same length, exactly.** A generated case's log is a function of the
 * places' `along_m` and nothing else — the simulator never reads a coordinate —
 * so a course's `drawn_m` is its whole contract with the conformance corpus.
 * Each one is scaled until its measured length rounds to its target, to the
 * metre, and the script refuses to write one that does not.
 *
 * **Unevenly spaced.** SPEC.md §2.2: a line has no spacing guarantee. A GPX
 * clusters vertices on the bends and runs long gaps down the straights, and a
 * reader that assumes otherwise puts every mat in the wrong place. So these are
 * thinned the way a real file is: a vertex wherever the heading has turned a few
 * degrees, and on a straight only every few hundred metres to a few kilometres.
 * Every vertex carries its own `along_m`, measured on the rounded coordinates
 * it is stored with.
 *
 * **Heights from a smooth profile.** A sum of sines over the distance, shifted
 * above zero and scaled until the stored heights climb what the course says it
 * climbs. Integer frequencies, so a loop ends at the height it started. The
 * flat course is zero everywhere, which is a profile an implementation must not
 * special-case.
 *
 * **Deterministic.** One mulberry32 stream per course, from a fixed seed. The
 * same script writes the same bytes on every machine, for ever.
 *
 * @see ts/src/build.ts — `CourseFile`, the shape written
 * @see ts/scripts/make-conformance.ts — what reads them
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import * as Schema from 'effect/Schema'

import { CourseFile } from '../src/build.ts'
import { render } from './render.ts'

const OUT = join(import.meta.dirname, '../../corpus/courses')

/* ── a seeded stream (the simulator's own, so one algorithm is in play) ──── */

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
const between = (next: () => number, lo: number, hi: number) => lo + (hi - lo) * next()

/* ── the sphere every length here is measured on ─────────────────────────── */

/**
 * The mean-radius sphere, and it says so: each course file carries
 * `distance_method: "mean-sphere-2d"`. The courses are synthetic, so there is
 * no organiser's figure to agree with — only an honest label for the one used.
 */
const EARTH_M = 6_371_008.8
const rad = (deg: number) => (deg * Math.PI) / 180
const haversine = (a: TLonLat, b: TLonLat): number => {
  const d_lat = rad(b[1] - a[1])
  const d_lon = rad(b[0] - a[0])
  const h =
    Math.sin(d_lat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(d_lon / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.sqrt(h))
}

type TXY = readonly [number, number]
type TLonLat = readonly [number, number]

/* ── dense shapes, in local metres (x east, y north) ─────────────────────── */

const STEP_M = 2

/**
 * A road that wanders: straights, and bends that are smooth bumps of curvature.
 *
 * Each bend turns `turn` radians over `width` metres with a raised-cosine
 * curvature, so the heading never jumps. The sign of each bend is chosen to
 * keep the heading within `leash` of where the road set out, which is what
 * makes it go somewhere rather than coil.
 */
const wander = (
  next: () => number,
  length_m: number,
  bends: number,
  heading: number,
  leash: number,
): ReadonlyArray<TXY> => {
  const spec = Array.from({ length: bends }, (_, k) => ({
    at: ((k + 0.5 + between(next, -0.3, 0.3)) / bends) * length_m,
    width: between(next, 60, 700),
    turn: rad(between(next, 15, 100)),
    sign: next() < 0.5 ? -1 : 1,
  }))
  // Settle the signs in order, so the leash holds.
  let net = 0
  const signed = spec.map((bend) => {
    const sign = Math.abs(net + bend.sign * bend.turn) > leash ? -bend.sign : bend.sign
    net += sign * bend.turn
    return { ...bend, turn: sign * bend.turn }
  })
  const curvature = (s: number) =>
    signed.reduce(
      (k, bend) =>
        Math.abs(s - bend.at) < bend.width / 2
          ? k +
            (bend.turn * (1 + Math.cos((2 * Math.PI * (s - bend.at)) / bend.width))) / bend.width
          : k,
      0,
    )
  const out: Array<TXY> = [[0, 0]]
  let h = heading
  let x = 0
  let y = 0
  for (let s = STEP_M; s <= length_m; s += STEP_M) {
    h += curvature(s - STEP_M / 2) * STEP_M
    x += Math.cos(h) * STEP_M
    y += Math.sin(h) * STEP_M
    out.push([x, y])
  }
  return out
}

/**
 * Out, a hairpin, and back on the other side of the road.
 *
 * The return runs `apart` metres to the right of the way out, the way a closed
 * road's two carriageways do, so the line never lies on itself.
 */
const out_and_back = (
  next: () => number,
  length_m: number,
  bends: number,
  heading: number,
  apart = 12,
): ReadonlyArray<TXY> => {
  const out = wander(next, (length_m - (Math.PI * apart) / 2) / 2, bends, heading, rad(70))
  const heading_at = (i: number) => {
    const a = out[Math.max(0, i - 1)] ?? [0, 0]
    const b = out[Math.min(out.length - 1, i + 1)] ?? a
    return Math.atan2(b[1] - a[1], b[0] - a[0])
  }
  const right = (i: number): TXY => {
    const h = heading_at(i)
    return [Math.sin(h) * apart, -Math.cos(h) * apart]
  }
  const end = out[out.length - 1] ?? [0, 0]
  const h_end = heading_at(out.length - 1)
  const r = right(out.length - 1)
  const centre: TXY = [end[0] + r[0] / 2, end[1] + r[1] / 2]
  // Left of centre, through ahead, to right of centre.
  const hairpin_steps = Math.ceil((Math.PI * apart) / 2 / STEP_M)
  const hairpin = Array.from({ length: hairpin_steps - 1 }, (_, i): TXY => {
    const a = h_end + Math.PI / 2 - (Math.PI * (i + 1)) / hairpin_steps
    return [centre[0] + (Math.cos(a) * apart) / 2, centre[1] + (Math.sin(a) * apart) / 2]
  })
  const back = out
    .map((p, i): TXY => {
      const o = right(i)
      return [p[0] + o[0], p[1] + o[1]]
    })
    .reverse()
  return [...out, ...hairpin, ...back]
}

/**
 * A closed loop: a superellipse — straight-ish sides, rounded corners — with a
 * wobble on the radius so no two sides are alike. Closed by construction, and
 * the last vertex is the first.
 */
const loop = (
  next: () => number,
  length_m: number,
  squareness: number,
  wobble: number,
): ReadonlyArray<TXY> => {
  const aspect = between(next, 0.55, 0.9)
  const phases = [next(), next(), next()].map((p) => p * 2 * Math.PI)
  const samples = Math.ceil(length_m / STEP_M) * 4
  const start = between(next, 0, 2 * Math.PI)
  const raw = Array.from({ length: samples + 1 }, (_, i): TXY => {
    const t = start + (2 * Math.PI * i) / samples
    const c = Math.cos(t)
    const s = Math.sin(t)
    const e = 2 / squareness
    const bump =
      1 +
      wobble *
        (0.6 * Math.sin(3 * t + (phases[0] ?? 0)) +
          0.3 * Math.sin(5 * t + (phases[1] ?? 0)) +
          0.1 * Math.sin(9 * t + (phases[2] ?? 0)))
    return [
      Math.sign(c) * Math.abs(c) ** e * 1000 * bump,
      Math.sign(s) * Math.abs(s) ** e * 1000 * aspect * bump,
    ]
  })
  const first = raw[0] ?? [0, 0]
  // Drawn at the length it will be, so thinning's metres are the course's metres.
  const perimeter = raw.reduce(
    (m, p, i) =>
      m + (i === 0 ? 0 : Math.hypot(p[0] - (raw[i - 1]?.[0] ?? 0), p[1] - (raw[i - 1]?.[1] ?? 0))),
    0,
  )
  const k = length_m / perimeter
  return raw.map((p, i): TXY =>
    i === samples ? [0, 0] : [(p[0] - first[0]) * k, (p[1] - first[1]) * k],
  )
}

/* ── thinning: dense on the bends, sparse on the straights ───────────────── */

/**
 * Keep a vertex wherever the heading has turned `turn_deg` since the last one
 * kept, or the straight has run a gap drawn fresh from `gap_m` each time — so
 * two straights of the same length are not thinned alike. Never closer than
 * `floor_m`, so every stored `along_m` is distinct once rounded to the metre.
 */
const thin = (
  next: () => number,
  dense: ReadonlyArray<TXY>,
  turn_deg: number,
  gap_m: readonly [number, number],
  floor_m = 3,
): ReadonlyArray<TXY> => {
  const first = dense[0]
  const last = dense[dense.length - 1]
  if (first === undefined || last === undefined) return []
  const kept: Array<TXY> = [first]
  let turned = 0
  let run = 0
  let gap = between(next, gap_m[0], gap_m[1])
  let heading: number | null = null
  for (let i = 1; i < dense.length - 1; i += 1) {
    const a = dense[i - 1]
    const b = dense[i]
    if (a === undefined || b === undefined) continue
    const h = Math.atan2(b[1] - a[1], b[0] - a[0])
    if (heading !== null) {
      let d = h - heading
      while (d > Math.PI) d -= 2 * Math.PI
      while (d < -Math.PI) d += 2 * Math.PI
      turned += Math.abs(d)
    }
    heading = h
    run += Math.hypot(b[0] - a[0], b[1] - a[1])
    if (run >= floor_m && (turned >= rad(turn_deg) || run >= gap)) {
      kept.push(b)
      turned = 0
      run = 0
      gap = between(next, gap_m[0], gap_m[1])
    }
  }
  kept.push(last)
  return kept
}

/* ── metres to degrees, and the length that comes out ────────────────────── */

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

const place = (points: ReadonlyArray<TXY>, origin: TLonLat, scale: number, rounded: boolean) => {
  const per_lat = 180 / (Math.PI * EARTH_M)
  const per_lon = per_lat / Math.cos(rad(origin[1]))
  return points.map((p): TLonLat => {
    const lon = origin[0] + p[0] * scale * per_lon
    const lat = origin[1] + p[1] * scale * per_lat
    return rounded ? [round6(lon), round6(lat)] : [lon, lat]
  })
}

const along_of = (line: ReadonlyArray<TLonLat>): ReadonlyArray<number> => {
  const along: Array<number> = [0]
  for (let i = 1; i < line.length; i += 1) {
    const a = line[i - 1]
    const b = line[i]
    along.push((along[i - 1] ?? 0) + (a !== undefined && b !== undefined ? haversine(a, b) : 0))
  }
  return along
}

/**
 * The scale at which the stored line measures `drawn_m`, to the metre.
 *
 * Newton on the ratio gets within a rounding of it; the rounding of every
 * coordinate to a micro-degree then makes the last metre a step function, so
 * the neighbourhood is walked until a scale lands on it exactly.
 */
const fit = (thinned: ReadonlyArray<TXY>, origin: TLonLat, drawn_m: number): number | null => {
  const length_at = (scale: number) => {
    const along = along_of(place(thinned, origin, scale, true))
    return along[along.length - 1] ?? 0
  }
  let scale = 1
  for (let i = 0; i < 8; i += 1) scale *= drawn_m / length_at(scale)
  for (let k = 0; k < 20_000; k += 1) {
    const step = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 2e-8
    if (Math.round(length_at(scale * (1 + step))) === drawn_m) return scale * (1 + step)
  }
  return null
}

/* ── heights ─────────────────────────────────────────────────────────────── */

const ascent_of = (heights: ReadonlyArray<number>) =>
  heights.reduce((up, h, i) => up + Math.max(0, h - (heights[i - 1] ?? h)), 0)

/**
 * A smooth profile over the fraction of the way along, scaled until the stored
 * (whole-metre) heights climb `ascent_m`. Returns the heights and what they climb.
 */
const heights_of = (
  next: () => number,
  fraction: ReadonlyArray<number>,
  ascent_m: number,
  base_m: number,
  frequencies: ReadonlyArray<number>,
) => {
  if (ascent_m === 0) return { heights: fraction.map(() => 0), ascent_m: 0 }
  const waves = frequencies.map((f, i) => ({
    f,
    a: (1 / (i + 1)) * between(next, 0.7, 1.3),
    p: next() * 2 * Math.PI,
  }))
  const raw = fraction.map((u) =>
    waves.reduce((h, w) => h + w.a * Math.sin(2 * Math.PI * w.f * u + w.p), 0),
  )
  const low = Math.min(...raw)
  const at = (gain: number) => raw.map((h) => Math.round(base_m + (h - low) * gain))
  let gain = 1
  for (let i = 0; i < 30; i += 1) {
    const climbed = ascent_of(at(gain))
    if (climbed === ascent_m || climbed === 0) break
    gain *= ascent_m / climbed
  }
  const heights = at(gain)
  return { heights, ascent_m: ascent_of(heights) }
}

/* ── the set ─────────────────────────────────────────────────────────────── */

type TShape =
  | {
      readonly kind: 'out-and-back' | 'point-to-point'
      readonly bends: number
      readonly heading_deg: number
    }
  | { readonly kind: 'loop'; readonly squareness: number; readonly wobble: number }

type TSpec = {
  readonly id: string
  readonly name: string
  readonly discipline: string
  /** The one number that matters: every generated log is a function of it. */
  readonly drawn_m: number
  readonly ascent_m: number
  readonly base_m: number
  readonly frequencies: ReadonlyArray<number>
  readonly shape: TShape
  readonly turn_deg: number
  readonly gap_m: readonly [number, number]
  /** Where it starts: all within a few tenths of a degree of 0.5° N 0.5° E. */
  readonly origin: TLonLat
  readonly seed: number
}

const SPECS: ReadonlyArray<TSpec> = [
  {
    id: 'half-flat',
    name: 'Flat half marathon',
    discipline: 'road',
    drawn_m: 21_326,
    ascent_m: 0,
    base_m: 0,
    frequencies: [],
    shape: { kind: 'out-and-back', bends: 22, heading_deg: 20 },
    turn_deg: 7,
    gap_m: [180, 1_400],
    origin: [0.42, 0.61],
    seed: 101,
  },
  {
    id: 'half-hilly',
    name: 'Hilly half marathon',
    discipline: 'road',
    drawn_m: 20_868,
    ascent_m: 500,
    base_m: 4,
    frequencies: [1, 3, 7, 13],
    shape: { kind: 'out-and-back', bends: 30, heading_deg: 115 },
    turn_deg: 7,
    gap_m: [150, 1_100],
    origin: [0.58, 0.44],
    seed: 102,
  },
  {
    id: 'marathon',
    name: 'Marathon',
    discipline: 'road',
    drawn_m: 42_044,
    ascent_m: 280,
    base_m: 3,
    frequencies: [1, 2, 5, 11],
    shape: { kind: 'point-to-point', bends: 34, heading_deg: -30 },
    turn_deg: 7,
    gap_m: [200, 1_600],
    origin: [0.36, 0.55],
    seed: 103,
  },
  {
    id: 'trail-50k',
    name: '50 km trail loop',
    discipline: 'trail',
    drawn_m: 49_170,
    ascent_m: 2_100,
    base_m: 120,
    frequencies: [1, 2, 4, 9, 17],
    shape: { kind: 'loop', squareness: 6, wobble: 0.1 },
    turn_deg: 6,
    gap_m: [120, 900],
    origin: [0.5, 0.5],
    seed: 104,
  },
  {
    id: 'ride-500k',
    name: '500 km ride',
    discipline: 'cycling',
    drawn_m: 497_372,
    ascent_m: 9_400,
    base_m: 6,
    frequencies: [2, 5, 11, 23, 47],
    shape: { kind: 'point-to-point', bends: 70, heading_deg: -110 },
    turn_deg: 8,
    gap_m: [1_200, 9_000],
    origin: [0.66, 0.68],
    seed: 105,
  },
  {
    id: 'loop-6720',
    name: '6.72 km loop',
    discipline: 'trail',
    drawn_m: 6_720,
    ascent_m: 80,
    base_m: 9,
    frequencies: [1, 2, 5],
    shape: { kind: 'loop', squareness: 4, wobble: 0.06 },
    turn_deg: 6,
    gap_m: [60, 450],
    origin: [0.47, 0.39],
    seed: 106,
  },
  {
    id: 'road-44k',
    name: '44 km road course',
    discipline: 'road',
    drawn_m: 44_000,
    ascent_m: 150,
    base_m: 2,
    frequencies: [1, 3, 8],
    shape: { kind: 'point-to-point', bends: 16, heading_deg: 60 },
    turn_deg: 7,
    gap_m: [300, 2_500],
    origin: [0.3, 0.33],
    seed: 107,
  },
]

const encode = Schema.encodeUnknownSync(CourseFile)

mkdirSync(OUT, { recursive: true })
const index: Array<Record<string, unknown>> = []
for (const spec of SPECS) {
  const next = stream(spec.seed)
  const shape = spec.shape
  // Drawn a little long; `fit` scales it to the metre.
  const dense =
    shape.kind === 'loop'
      ? loop(next, spec.drawn_m, shape.squareness, shape.wobble)
      : shape.kind === 'out-and-back'
        ? out_and_back(next, spec.drawn_m, shape.bends, rad(shape.heading_deg))
        : wander(next, spec.drawn_m, shape.bends, rad(shape.heading_deg), rad(80))
  const thinned = thin(next, dense, spec.turn_deg, spec.gap_m)
  const scale = fit(thinned, spec.origin, spec.drawn_m)
  if (scale === null) {
    process.stderr.write(`${spec.id}: no scale measures ${spec.drawn_m} m — nothing written\n`)
    process.exitCode = 1
    continue
  }
  const line = place(thinned, spec.origin, scale, true)
  // A loop ends where it starts, to the micro-degree.
  const closed =
    shape.kind === 'loop' && line[0] !== undefined ? [...line.slice(0, -1), line[0]] : line
  const along = along_of(closed)
  const drawn_m = Math.round(along[along.length - 1] ?? 0)
  const full = along_of(place(dense, spec.origin, scale, false))
  const distance_m = Math.round(full[full.length - 1] ?? 0)
  const { heights, ascent_m } = heights_of(
    next,
    along.map((m) => m / drawn_m),
    spec.ascent_m,
    spec.base_m,
    spec.frequencies,
  )

  const course = encode({
    id: spec.id,
    name: spec.name,
    race: 'synthetic',
    // ISO 3166's user-assigned code: no country, because there is no place.
    country: 'ZZ',
    discipline: spec.discipline,
    source: 'synthetic',
    origin_url: null,
    sha256: null,
    distance_m,
    distance_method: 'mean-sphere-2d',
    drawn_m,
    elevation_gain_m: ascent_m,
    points_original: dense.length,
    line: closed.map((p, i) => [p[0], p[1], heights[i] ?? 0, Math.round(along[i] ?? 0)]),
  })
  writeFileSync(join(OUT, `${spec.id}.json`), render(course))
  index.push({
    id: spec.id,
    name: spec.name,
    race: 'synthetic',
    country: 'ZZ',
    discipline: spec.discipline,
    distance_m,
    elevation_gain_m: ascent_m,
    points: closed.length,
  })

  const gaps = along
    .slice(1)
    .map((m, i) => m - (along[i] ?? 0))
    .sort((a, b) => a - b)
  const median = gaps[Math.floor(gaps.length / 2)] ?? 0
  process.stdout.write(
    `${spec.id.padEnd(12)} ${String(drawn_m).padStart(7)} m drawn · ${String(distance_m).padStart(7)} m full · ` +
      `${String(ascent_m).padStart(6)} m up · ${String(closed.length).padStart(4)} vertices · ` +
      `spacing ${(gaps[0] ?? 0).toFixed(0)}–${median.toFixed(0)}–${(gaps[gaps.length - 1] ?? 0).toFixed(0)} m` +
      `${drawn_m === spec.drawn_m ? '' : `  ✗ wanted ${spec.drawn_m}`}\n`,
  )
  if (drawn_m !== spec.drawn_m) process.exitCode = 1
  // Rounded to the metre, every vertex must still be further along than the last.
  const stored = along.map((m) => Math.round(m))
  if (stored.some((m, i) => i > 0 && m <= (stored[i - 1] ?? -1))) {
    process.stderr.write(`${spec.id}: two vertices share an along_m once rounded\n`)
    process.exitCode = 1
  }
}
writeFileSync(join(OUT, 'index.json'), render(index))
