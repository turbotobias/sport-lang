/**
 * How far apart two positions are, as the format measures it: horizontally, on
 * the WGS84 ellipsoid (SPEC.md §2.2, "`along_m` is horizontal distance on the
 * WGS84 ellipsoid").
 *
 * The format states the convention because nobody can derive it from a file: a
 * sphere of the mean radius is out by a few tenths of a percent, either way
 * depending on latitude and bearing — over 100 m on a marathon — and three
 * dimensional chords move a place tens of metres on a mountain. A reader that
 * lays a document's vertices along its course has to measure them the way the
 * writer did, or it puts every height and every stretch in the wrong place.
 *
 * Positions are GeoJSON's: `[longitude, latitude]`, anything after ignored.
 */

const A = 6_378_137
const F = 1 / 298.257223563
const B = A * (1 - F)
/** The mean radius (IUGG), for the one case below that falls back to a sphere. */
const MEAN_RADIUS_M = 6_371_008.8

const rad = (degrees: number): number => (degrees * Math.PI) / 180

/** A position as GeoJSON writes one: longitude, latitude, and maybe a height. */
type TPosition = readonly [number, number, ...ReadonlyArray<number>]

/** Great-circle metres on a sphere of the mean radius. Only the fallback of {@link geodesic_m}. */
const sphere_m = (from: TPosition, to: TPosition): number => {
  const d_lat = rad(to[1] - from[1])
  const d_lon = rad(to[0] - from[0])
  const h =
    Math.sin(d_lat / 2) ** 2 +
    Math.cos(rad(from[1])) * Math.cos(rad(to[1])) * Math.sin(d_lon / 2) ** 2
  return 2 * MEAN_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

/**
 * Metres between two positions on the WGS84 ellipsoid (Vincenty's inverse).
 *
 * 0 for one position twice. Where the iteration does not settle — two points
 * nearly opposite each other on the globe, which no course has — a sphere's
 * answer, a few tenths of a percent out, and never `NaN`: this feeds a running
 * total, and one `NaN` would erase a whole course.
 */
export const geodesic_m = (from: TPosition, to: TPosition): number => {
  const L = rad(to[0] - from[0])
  const U1 = Math.atan((1 - F) * Math.tan(rad(from[1])))
  const U2 = Math.atan((1 - F) * Math.tan(rad(to[1])))
  const sin_u1 = Math.sin(U1)
  const cos_u1 = Math.cos(U1)
  const sin_u2 = Math.sin(U2)
  const cos_u2 = Math.cos(U2)

  let lambda = L
  let previous = 0
  let iterations = 0
  let sin_sigma = 0
  let cos_sigma = 0
  let sigma = 0
  let cos_sq_alpha = 0
  let cos_2sigma_m = 0

  do {
    const sin_lambda = Math.sin(lambda)
    const cos_lambda = Math.cos(lambda)
    sin_sigma = Math.sqrt(
      (cos_u2 * sin_lambda) ** 2 + (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lambda) ** 2,
    )
    if (sin_sigma === 0) return 0
    cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lambda
    sigma = Math.atan2(sin_sigma, cos_sigma)
    const sin_alpha = (cos_u1 * cos_u2 * sin_lambda) / sin_sigma
    cos_sq_alpha = 1 - sin_alpha * sin_alpha
    // Zero on an equatorial line, where the term it guards drops out anyway.
    cos_2sigma_m = cos_sq_alpha === 0 ? 0 : cos_sigma - (2 * sin_u1 * sin_u2) / cos_sq_alpha
    const C = (F / 16) * cos_sq_alpha * (4 + F * (4 - 3 * cos_sq_alpha))
    previous = lambda
    lambda =
      L +
      (1 - C) *
        F *
        sin_alpha *
        (sigma + C * sin_sigma * (cos_2sigma_m + C * cos_sigma * (-1 + 2 * cos_2sigma_m ** 2)))
    iterations += 1
  } while (Math.abs(lambda - previous) > 1e-12 && iterations < 100)

  if (iterations >= 100) return sphere_m(from, to)

  const u_sq = (cos_sq_alpha * (A * A - B * B)) / (B * B)
  const cap_a = 1 + (u_sq / 16384) * (4096 + u_sq * (-768 + u_sq * (320 - 175 * u_sq)))
  const cap_b = (u_sq / 1024) * (256 + u_sq * (-128 + u_sq * (74 - 47 * u_sq)))
  const d_sigma =
    cap_b *
    sin_sigma *
    (cos_2sigma_m +
      (cap_b / 4) *
        (cos_sigma * (-1 + 2 * cos_2sigma_m ** 2) -
          (cap_b / 6) * cos_2sigma_m * (-3 + 4 * sin_sigma ** 2) * (-3 + 4 * cos_2sigma_m ** 2)))
  return B * cap_a * (sigma - d_sigma)
}

const E2 = F * (2 - F)

/** Below this a step is measured on the ellipsoid's own local radii; above it, by {@link geodesic_m}. */
const LOCAL_M = 20_000

/**
 * Metres of one step along a line: the ellipsoid's meridian and prime
 * vertical radii at the step's middle latitude, which on a step shorter than
 * {@link LOCAL_M} is within a millimetre of {@link geodesic_m} and about ten
 * times cheaper — a course is thousands of steps of tens of metres. A longer
 * step, or one across a pole or the antimeridian, is measured whole.
 */
const step_m = (from: TPosition, to: TPosition): number => {
  const d_lon = to[0] - from[0]
  if (Math.abs(d_lon) > 180) return geodesic_m(from, to)
  const middle = rad((from[1] + to[1]) / 2)
  const sin = Math.sin(middle)
  const w = Math.sqrt(1 - E2 * sin * sin)
  const north = ((A * (1 - E2)) / (w * w * w)) * rad(to[1] - from[1])
  const east = (A / w) * Math.cos(middle) * rad(d_lon)
  const local = Math.sqrt(north * north + east * east)
  return local < LOCAL_M ? local : geodesic_m(from, to)
}

/** How far along a line each of its positions is, from its first: `[0, …, its length]`. */
export const alongs_m = (line: ReadonlyArray<TPosition>): ReadonlyArray<number> => {
  const along: Array<number> = []
  let total = 0
  for (let i = 0; i < line.length; i += 1) {
    const before = line[i - 1]
    const here = line[i]
    if (before !== undefined && here !== undefined) total += step_m(before, here)
    along.push(total)
  }
  return along
}
