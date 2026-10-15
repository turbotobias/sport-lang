//! How far apart two positions are, as the format measures it: horizontally,
//! on the WGS84 ellipsoid (SPEC.md §2.2).
//!
//! The same arithmetic as the TypeScript reference's `geodesic.ts`, step for
//! step, so a vertex falls at the same metre in both engines: Vincenty's
//! inverse for [`geodesic_m`], and the ellipsoid's local radii for a line's
//! short steps in [`alongs_m`]. Positions are GeoJSON's, longitude first.

const A: f64 = 6_378_137.0;
const F: f64 = 1.0 / 298.257_223_563;
const B: f64 = A * (1.0 - F);
/// The mean radius (IUGG), for the one case that falls back to a sphere.
const MEAN_RADIUS_M: f64 = 6_371_008.8;
const E2: f64 = F * (2.0 - F);
/// Below this a step is measured on the ellipsoid's local radii; above it, whole.
const LOCAL_M: f64 = 20_000.0;

fn rad(degrees: f64) -> f64 {
    degrees * std::f64::consts::PI / 180.0
}

/// Great-circle metres on a sphere of the mean radius: only the fallback of [`geodesic_m`].
fn sphere_m(from: [f64; 2], to: [f64; 2]) -> f64 {
    let d_lat = rad(to[1] - from[1]);
    let d_lon = rad(to[0] - from[0]);
    let h = (d_lat / 2.0).sin().powi(2) + rad(from[1]).cos() * rad(to[1]).cos() * (d_lon / 2.0).sin().powi(2);
    2.0 * MEAN_RADIUS_M * h.sqrt().min(1.0).asin()
}

/// Metres between two positions on the WGS84 ellipsoid (Vincenty's inverse).
///
/// 0 for one position twice. Where the iteration does not settle — two points
/// nearly opposite each other on the globe, which no course has — a sphere's
/// answer, and never `NaN`.
pub fn geodesic_m(from: [f64; 2], to: [f64; 2]) -> f64 {
    let l = rad(to[0] - from[0]);
    let u1 = ((1.0 - F) * rad(from[1]).tan()).atan();
    let u2 = ((1.0 - F) * rad(to[1]).tan()).atan();
    let (sin_u1, cos_u1) = (u1.sin(), u1.cos());
    let (sin_u2, cos_u2) = (u2.sin(), u2.cos());

    let mut lambda = l;
    let mut iterations = 0;
    let (mut sin_sigma, mut cos_sigma, mut sigma, mut cos_sq_alpha, mut cos_2sigma_m);
    loop {
        let (sin_lambda, cos_lambda) = (lambda.sin(), lambda.cos());
        sin_sigma = ((cos_u2 * sin_lambda).powi(2) + (cos_u1 * sin_u2 - sin_u1 * cos_u2 * cos_lambda).powi(2)).sqrt();
        if sin_sigma == 0.0 {
            return 0.0;
        }
        cos_sigma = sin_u1 * sin_u2 + cos_u1 * cos_u2 * cos_lambda;
        sigma = sin_sigma.atan2(cos_sigma);
        let sin_alpha = cos_u1 * cos_u2 * sin_lambda / sin_sigma;
        cos_sq_alpha = 1.0 - sin_alpha * sin_alpha;
        // Zero on an equatorial line, where the term it guards drops out anyway.
        cos_2sigma_m = if cos_sq_alpha == 0.0 {
            0.0
        } else {
            cos_sigma - 2.0 * sin_u1 * sin_u2 / cos_sq_alpha
        };
        let c = F / 16.0 * cos_sq_alpha * (4.0 + F * (4.0 - 3.0 * cos_sq_alpha));
        let previous = lambda;
        lambda = l
            + (1.0 - c)
                * F
                * sin_alpha
                * (sigma + c * sin_sigma * (cos_2sigma_m + c * cos_sigma * (-1.0 + 2.0 * cos_2sigma_m.powi(2))));
        iterations += 1;
        if (lambda - previous).abs() <= 1e-12 || iterations >= 100 {
            break;
        }
    }
    if iterations >= 100 {
        return sphere_m(from, to);
    }

    let u_sq = cos_sq_alpha * (A * A - B * B) / (B * B);
    let cap_a = 1.0 + u_sq / 16384.0 * (4096.0 + u_sq * (-768.0 + u_sq * (320.0 - 175.0 * u_sq)));
    let cap_b = u_sq / 1024.0 * (256.0 + u_sq * (-128.0 + u_sq * (74.0 - 47.0 * u_sq)));
    let d_sigma = cap_b
        * sin_sigma
        * (cos_2sigma_m
            + cap_b / 4.0
                * (cos_sigma * (-1.0 + 2.0 * cos_2sigma_m.powi(2))
                    - cap_b / 6.0
                        * cos_2sigma_m
                        * (-3.0 + 4.0 * sin_sigma.powi(2))
                        * (-3.0 + 4.0 * cos_2sigma_m.powi(2))));
    B * cap_a * (sigma - d_sigma)
}

/// Metres of one step along a line: the ellipsoid's meridian and prime
/// vertical radii at the step's middle latitude, within a millimetre of
/// [`geodesic_m`] below 20 km; a longer step, or one across the antimeridian,
/// measured whole.
fn step_m(from: [f64; 2], to: [f64; 2]) -> f64 {
    let d_lon = to[0] - from[0];
    if d_lon.abs() > 180.0 {
        return geodesic_m(from, to);
    }
    let middle = rad((from[1] + to[1]) / 2.0);
    let sin = middle.sin();
    let w = (1.0 - E2 * sin * sin).sqrt();
    let north = A * (1.0 - E2) / (w * w * w) * rad(to[1] - from[1]);
    let east = A / w * middle.cos() * rad(d_lon);
    let local = (north * north + east * east).sqrt();
    if local < LOCAL_M {
        local
    } else {
        geodesic_m(from, to)
    }
}

/// How far along a line each of its positions is, from its first: `[0, …, its length]`.
pub fn alongs_m(line: &[[f64; 2]]) -> Vec<f64> {
    let mut along = Vec::with_capacity(line.len());
    let mut total = 0.0;
    for (i, here) in line.iter().enumerate() {
        if i > 0 {
            total += step_m(line[i - 1], *here);
        }
        along.push(total);
    }
    along
}
