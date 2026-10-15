//! A course at a glance — how long it is, how much it climbs, its heights from
//! the start to the finish, what is underfoot, and where its places are — read
//! from the document and from nothing else.
//!
//! The same answer as the TypeScript reference's `summary_of`, held to it by
//! `corpus/summary/`: every app that shows a course in miniature, in either
//! language, gives the same summary of the same file. The rules it keeps are
//! the reference's, in its words:
//!
//! - **Where a vertex falls.** Each vertex's distance is measured from the
//!   geometry on the WGS84 ellipsoid ([`crate::geodesic`]) and laid on the
//!   document's own metres. A line the path runs whole — every slice of it from
//!   its start to one same end — is stretched or shrunk so its measured length
//!   is that end; a line run in part is read in its measured metres.
//! - **The climb** is `pace:measure`'s, or none.
//! - **Heights** only where every position of the lines the path runs has one.
//! - **Ground** only where the `surface:` segments cover the course in order,
//!   with no gap and no overlap; `:inferred` dropped; a material outside the
//!   family is `unknown`.

use serde::Serialize;
use serde_json::Value;

use crate::document::{CourseDocument, FeatureProperties};
use crate::geodesic::alongs_m;

/// How many heights a summary has unless asked for another number.
pub const SUMMARY_HEIGHTS: usize = 48;

/// What a cover may be out by at a join, for a writer that rounded: half a metre.
const JOIN_M: f64 = 0.5;

/// The `surface:` family (SPEC.md §2.2).
const MATERIALS: [&str; 8] = [
    "paved", "cobbles", "gravel", "trail", "sand", "track", "water", "unknown",
];

/// One place on the course, by its address.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct SummaryPlace {
    pub id: String,
    pub kind: String,
    pub name: Option<String>,
    pub along_m: f64,
}

/// A course at a glance.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Summary {
    /// `path_length`: the course's length as far as any rule is concerned.
    pub length_m: f64,
    pub stated_m: Option<f64>,
    pub ascent_m: Option<f64>,
    pub descent_m: Option<f64>,
    /// Heights at even steps from the start to the finish, to a tenth of a metre; empty without heights.
    pub heights: Vec<f64>,
    /// `[from_m, to_m, material]` in order, neighbours of one material joined; empty when the ground is not said.
    pub ground: Vec<(f64, f64, &'static str)>,
    /// Every place, nearest the start first.
    pub places: Vec<SummaryPlace>,
}

/// `surface:gravel:inferred` → `gravel`; a material outside the family → `unknown`.
fn material_of(kind: &str) -> &'static str {
    let said = kind.split(':').nth(1).unwrap_or("");
    MATERIALS.iter().find(|m| **m == said).copied().unwrap_or("unknown")
}

/// A line's positions, each `[lon, lat]` and maybe a height.
fn positions(geometry: &Value) -> Vec<&Vec<Value>> {
    geometry
        .get("coordinates")
        .and_then(Value::as_array)
        .map(|all| all.iter().filter_map(Value::as_array).collect())
        .unwrap_or_default()
}

/// A line as the summary reads it.
struct LaidLine<'a> {
    id: &'a str,
    heights: Option<Vec<f64>>,
    along: Vec<f64>,
}

/// JavaScript's `Math.round`: halves go up, so −2.5 is −2, as the reference rounds.
fn round_tenth(value: f64) -> f64 {
    (value * 10.0 + 0.5).floor() / 10.0
}

impl CourseDocument {
    /// A course at a glance, from its document: `steps` heights.
    pub fn summary(&self, steps: usize) -> Summary {
        let mut places: Vec<SummaryPlace> = self
            .features
            .iter()
            .filter_map(|feature| match &feature.properties {
                FeatureProperties::Point {
                    id,
                    kind,
                    name,
                    along_m,
                } => Some(SummaryPlace {
                    id: id.clone(),
                    kind: kind.clone(),
                    name: name.clone(),
                    along_m: *along_m,
                }),
                _ => None,
            })
            .collect();
        places.sort_by(|a, b| a.along_m.total_cmp(&b.along_m));
        Summary {
            length_m: self.path_length_m(),
            stated_m: self.measure.stated_m,
            ascent_m: self.measure.ascent_m,
            descent_m: self.measure.descent_m,
            heights: self.heights(steps),
            ground: self.ground(),
            places,
        }
    }

    /// Each line's positions laid on the document's metres.
    fn laid_lines(&self) -> Vec<LaidLine<'_>> {
        self.features
            .iter()
            .filter_map(|feature| match &feature.properties {
                FeatureProperties::Line { id, .. } => Some((id.as_str(), &feature.geometry)),
                _ => None,
            })
            .map(|(id, geometry)| {
                let positions = positions(geometry);
                let flat: Vec<[f64; 2]> = positions
                    .iter()
                    .map(|p| {
                        [
                            p.first().and_then(Value::as_f64).unwrap_or(0.0),
                            p.get(1).and_then(Value::as_f64).unwrap_or(0.0),
                        ]
                    })
                    .collect();
                let measured = alongs_m(&flat);
                let total = measured.last().copied().unwrap_or(0.0);
                let slices: Vec<_> = self.path.iter().filter(|slice| slice.line == id).collect();
                let scale = match slices.first() {
                    Some(first)
                        if total > 0.0
                            && slices
                                .iter()
                                .all(|s| s.from_m <= JOIN_M && (s.to_m - first.to_m).abs() <= JOIN_M) =>
                    {
                        first.to_m / total
                    }
                    _ => 1.0,
                };
                let heights = if positions.iter().all(|p| p.len() == 3) {
                    Some(
                        positions
                            .iter()
                            .map(|p| p.get(2).and_then(Value::as_f64).unwrap_or(0.0))
                            .collect(),
                    )
                } else {
                    None
                };
                LaidLine {
                    id,
                    heights,
                    along: measured.iter().map(|m| m * scale).collect(),
                }
            })
            .collect()
    }

    /// The heights at `steps` even steps along the path.
    fn heights(&self, steps: usize) -> Vec<f64> {
        let length = self.path_length_m();
        if steps < 2 || length <= 0.0 || self.path.is_empty() {
            return Vec::new();
        }
        let lines = self.laid_lines();
        let mut runs: Vec<(f64, f64, f64, &LaidLine<'_>, &Vec<f64>)> = Vec::new();
        for slice in &self.path {
            // Found by id in a list: a line called `constructor` is a line like any other.
            let Some(line) = lines.iter().find(|line| line.id == slice.line) else {
                return Vec::new();
            };
            let Some(heights) = &line.heights else {
                return Vec::new();
            };
            runs.push((slice.from_m, slice.to_m - slice.from_m, slice.repeat, line, heights));
        }
        (0..steps)
            .map(|step| {
                let mut wanted = length * step as f64 / (steps - 1) as f64;
                for (index, (from_m, span_m, repeat, line, heights)) in runs.iter().enumerate() {
                    let run_m = span_m * repeat;
                    let last = index == runs.len() - 1;
                    if wanted < run_m || last {
                        // Inside this slice: which lap, and how far into it. The very
                        // end of the last slice is its end, not a lap nobody runs.
                        let into = if last && wanted >= run_m {
                            *span_m
                        } else {
                            wanted % span_m
                        };
                        return round_tenth(height_on(&line.along, heights, from_m + into));
                    }
                    wanted -= run_m;
                }
                0.0
            })
            .collect()
    }

    /// The ground, from the `surface:` segments when they cover the course.
    fn ground(&self) -> Vec<(f64, f64, &'static str)> {
        let length = self.path_length_m();
        let mut stretches: Vec<(f64, f64, &str)> = self
            .features
            .iter()
            .filter_map(|feature| match &feature.properties {
                FeatureProperties::Segment { kind, from_m, to_m, .. } if kind.starts_with("surface:") => {
                    Some((*from_m, *to_m, kind.as_str()))
                }
                _ => None,
            })
            .collect();
        if stretches.is_empty() {
            return Vec::new();
        }
        stretches.sort_by(|a, b| a.0.total_cmp(&b.0));
        let mut reached = 0.0;
        for (from_m, to_m, _) in &stretches {
            if (from_m - reached).abs() > JOIN_M {
                return Vec::new();
            }
            reached = *to_m;
        }
        if (reached - length).abs() > JOIN_M {
            return Vec::new();
        }
        let mut joined: Vec<(f64, f64, &'static str)> = Vec::new();
        for (from_m, to_m, kind) in stretches {
            let material = material_of(kind);
            match joined.last_mut() {
                Some(last) if last.2 == material => last.1 = to_m,
                _ => joined.push((from_m, to_m, material)),
            }
        }
        joined
    }
}

/// The height at `m` metres along a laid line: between its two nearest positions.
fn height_on(along: &[f64], heights: &[f64], m: f64) -> f64 {
    let Some(last) = along.len().checked_sub(1) else {
        return 0.0;
    };
    if m <= along[0] {
        return heights[0];
    }
    if m >= along[last] {
        return heights[last];
    }
    let (mut low, mut high) = (0, last);
    while high - low > 1 {
        let middle = (low + high) >> 1;
        if along[middle] < m {
            low = middle;
        } else {
            high = middle;
        }
    }
    let (a, b) = (along[low], along[high]);
    let share = if b - a <= 0.0 { 0.0 } else { (m - a) / (b - a) };
    heights[low] + (heights[high] - heights[low]) * share
}
