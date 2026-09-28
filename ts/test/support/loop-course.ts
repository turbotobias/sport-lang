/**
 * A 6.72 km loop, as a document's line would carry it.
 *
 * Synthetic — `corpus/courses/loop-6720.json`, drawn by `scripts/make-courses.ts`
 * — and the hardest shape the design has to hold: a backyard ultra has no
 * distance, no cut-off and no finish line in the ordinary sense, and a winner
 * decided by the field.
 *
 * The line starts and ends on the same coordinate, which is what makes it a
 * loop and what makes the path the right way to store it (SPEC.md §2.1): one
 * geometry, and a lap is an entry rather than a copy.
 */
import { createHash } from 'node:crypto'

import { course, course_bytes } from './courses.ts'

const LOOP = course('loop-6720')
const first = LOOP.line[0]
const last = LOOP.line[LOOP.line.length - 1]

/**
 * The encoded-polyline form of a line (precision 5, latitude first) — the
 * compact string a map tile or a URL carries. `polyline` on a line feature is
 * an optional cache of exactly this; nothing in the fold reads it.
 */
const encode_polyline = (line: ReadonlyArray<readonly [number, number, ...Array<unknown>]>) => {
  const chunk = (value: number) => {
    let v = value < 0 ? ~(value << 1) : value << 1
    let out = ''
    while (v >= 0x20) {
      out += String.fromCharCode((0x20 | (v & 0x1f)) + 63)
      v >>= 5
    }
    return out + String.fromCharCode(v + 63)
  }
  let lat = 0
  let lon = 0
  return line
    .map(([x, y]) => {
      const dlat = Math.round(y * 1e5) - lat
      const dlon = Math.round(x * 1e5) - lon
      lat += dlat
      lon += dlon
      return chunk(dlat) + chunk(dlon)
    })
    .join('')
}

export const LOOP_COURSE = {
  name: LOOP.name,
  /** The digest of the course file the document is made from. */
  sha256: createHash('sha256').update(course_bytes('loop-6720')).digest('hex'),
  points: LOOP.line.length,
  /** The line as drawn, which is the length the path claims. */
  distance_m: LOOP.drawn_m,
  elevation_gain_m: LOOP.elevation_gain_m,
  /** `[lon, lat]`, GeoJSON's order. */
  start: [first?.[0] ?? 0, first?.[1] ?? 0] as const,
  end: [last?.[0] ?? 0, last?.[1] ?? 0] as const,
  polyline: encode_polyline(LOOP.line),
} as const
