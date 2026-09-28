//! The course document — GeoJSON that is also a program.
//!
//! Valid GeoJSON, and **stricter** than GeoJSON: a profile. Every document is
//! GeoJSON any tool can draw, and not every valid GeoJSON is a document. The
//! spec leaves `properties` free-form, which is right for an interchange format
//! and wrong for a file that decides who finished.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::kernel::{present, KernelRule};
use crate::packs::{compile, DocumentRule, Pack, Refusal};

#[derive(Debug, Clone, Deserialize)]
pub struct Measure {
    #[serde(deserialize_with = "present")]
    pub distance_m: Option<f64>,
    #[serde(deserialize_with = "present")]
    pub distance_method: Option<String>,
    #[serde(deserialize_with = "present")]
    pub stated_m: Option<f64>,
    #[serde(deserialize_with = "present")]
    pub certified_m: Option<f64>,
    #[serde(deserialize_with = "present")]
    pub ascent_m: Option<f64>,
    #[serde(deserialize_with = "present")]
    pub descent_m: Option<f64>,
    #[serde(deserialize_with = "present")]
    pub elevation_source: Option<String>,
    #[serde(deserialize_with = "present")]
    pub elevation_smoothing: Option<String>,
    #[serde(deserialize_with = "present")]
    pub ascent_threshold_m: Option<f64>,
}

/// A slice of a line, run a number of times.
///
/// `try_from` rather than a plain derive because §2.1's per-field laws are
/// **parse-time** laws: a slice run zero times is not part of the way in, and a
/// reader that accepts `repeat: 0` is a reader that silently loses a lap. Plain
/// serde accepts any `f64` for all three, which is how the decode corpus found
/// this crate accepting six documents the reference rejects.
#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "RawPathEntry")]
pub struct PathEntry {
    pub line: String,
    pub from_m: f64,
    pub to_m: f64,
    pub repeat: f64,
}

#[derive(Deserialize)]
struct RawPathEntry {
    line: String,
    from_m: f64,
    to_m: f64,
    repeat: f64,
}

impl TryFrom<RawPathEntry> for PathEntry {
    type Error = String;

    fn try_from(raw: RawPathEntry) -> Result<Self, Self::Error> {
        along("from_m", raw.from_m)?;
        along("to_m", raw.to_m)?;
        if !raw.repeat.is_finite() || raw.repeat < 1.0 {
            return Err(format!(
                "repeat is {}, and a slice run zero times is not part of the way in",
                raw.repeat
            ));
        }
        Ok(PathEntry {
            line: raw.line,
            from_m: raw.from_m,
            to_m: raw.to_m,
            repeat: raw.repeat,
        })
    }
}

/// A distance along the course: finite and never negative — §2.1.
///
/// Finiteness is checked first and explicitly. The reference's `Along` is
/// `Schema.Finite` with a `>= 0` check, and a NaN compares false to everything
/// — including `< 0.0` — so a bare comparison would let one through to draw a
/// mark nowhere. No corpus case can cover it: JSON has no way to write NaN.
fn along(field: &str, value: f64) -> Result<(), String> {
    if !value.is_finite() || value < 0.0 {
        return Err(format!(
            "{field} is {value}, and nothing on a course is a negative distance from the start"
        ));
    }
    Ok(())
}

/// The format version this build runs. SPEC.md §7.
///
/// Decoding and running are separate questions. Any positive whole number is a
/// version (a per-field law: `1.5`, `0` and `-1` are not documents); only this
/// one is a version this build can *run*. A document of any other version is
/// readable but not runnable, exactly like one naming a dialect this build does
/// not ship: it draws, and [`CourseDocument::plan`] refuses it by name.
pub const FORMAT_VERSION: u64 = 1;

/// The largest whole number every JSON reader holds exactly (2^53 − 1), which
/// is where the TypeScript engine's `Schema.Int` stops.
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// `sport:version`: a whole number from 1, read as a JSON number of any
/// spelling (`1` and `1.0` are the same number, as they are to every other
/// JSON reader) — a plain `u32` refused the second and ran `0`.
fn format_version<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<u64, D::Error> {
    let value = f64::deserialize(deserializer)?;
    if value.fract() != 0.0 || !(1.0..=MAX_SAFE).contains(&value) {
        return Err(serde::de::Error::custom(format!(
            "sport:version is {value}, and a format version is a whole number from 1"
        )));
    }
    Ok(value as u64)
}

/// The document's `type`, which GeoJSON fixes: `FeatureCollection`.
fn feature_collection<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    let kind = String::deserialize(deserializer)?;
    if kind != "FeatureCollection" {
        return Err(serde::de::Error::custom(format!(
            "a document's type is FeatureCollection, not {kind}"
        )));
    }
    Ok(kind)
}

/// One `[lon, lat]` or `[lon, lat, ele]`, in GeoJSON's order — §2.1.
fn position(value: &Value) -> Result<(), String> {
    let pair = value.as_array().ok_or_else(|| "a position is an array".to_string())?;
    if pair.len() < 2 || pair.len() > 3 {
        return Err(format!("a position has two or three numbers, not {}", pair.len()));
    }
    let numbers: Vec<f64> = pair
        .iter()
        .map(|n| n.as_f64().ok_or_else(|| "a position is numbers".to_string()))
        .collect::<Result<_, _>>()?;
    if !(-180.0..=180.0).contains(&numbers[0]) {
        return Err(format!("longitude {} is outside [-180, 180]", numbers[0]));
    }
    if !(-90.0..=90.0).contains(&numbers[1]) {
        return Err(format!("latitude {} is outside [-90, 90]", numbers[1]));
    }
    Ok(())
}

/// The geometry a role may have, and the positions inside it — §2.1, §2.2.
///
/// The role decides the geometry: a zone is a polygon and a point is a point.
/// GeoJSON leaves the two loosely coupled, which is right for an interchange
/// format and wrong for a file that decides who finished.
fn geometry_for(role: &str, geometry: &Value) -> Result<(), String> {
    let kind = geometry
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| "a geometry has a type".to_string())?;
    let coordinates = geometry
        .get("coordinates")
        .ok_or_else(|| "a geometry has coordinates".to_string())?;

    let want = match role {
        "line" | "segment" => "LineString",
        "point" => "Point",
        "zone" => "Polygon",
        other => return Err(format!("no role called {other}")),
    };
    if kind != want {
        return Err(format!("a {role} is a {want}, not a {kind}"));
    }

    match want {
        "Point" => position(coordinates),
        "LineString" => {
            let positions = coordinates
                .as_array()
                .ok_or_else(|| "a LineString is an array".to_string())?;
            // A line needs two points. GeoJSON says so; this makes it a decode
            // failure rather than something the drawing code discovers.
            if positions.len() < 2 {
                return Err(format!(
                    "a LineString has two or more positions, not {}",
                    positions.len()
                ));
            }
            positions.iter().try_for_each(position)
        }
        _ => {
            let rings = coordinates
                .as_array()
                .ok_or_else(|| "a Polygon is an array".to_string())?;
            rings.iter().try_for_each(|ring| {
                ring.as_array()
                    .ok_or_else(|| "a Polygon's ring is an array".to_string())?
                    .iter()
                    .try_for_each(position)
            })
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct Provenance {
    pub source: String,
    #[serde(deserialize_with = "present")]
    pub origin_url: Option<String>,
    #[serde(deserialize_with = "present")]
    pub sha256: Option<String>,
    #[serde(deserialize_with = "present")]
    pub format: Option<String>,
    #[serde(deserialize_with = "present")]
    pub verified_by: Option<String>,
    #[serde(deserialize_with = "present")]
    pub verified_at: Option<String>,
}

/// A feature's properties, discriminated on `role`.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "role", rename_all = "snake_case")]
pub enum FeatureProperties {
    Line {
        id: String,
        #[serde(deserialize_with = "present")]
        polyline: Option<String>,
    },
    Point {
        id: String,
        kind: String,
        #[serde(deserialize_with = "present")]
        name: Option<String>,
        along_m: f64,
    },
    Segment {
        id: String,
        kind: String,
        #[serde(deserialize_with = "present")]
        name: Option<String>,
        from_m: f64,
        to_m: f64,
    },
    Zone {
        id: String,
        kind: String,
        #[serde(deserialize_with = "present")]
        name: Option<String>,
    },
}

impl FeatureProperties {
    pub fn id(&self) -> &str {
        match self {
            FeatureProperties::Line { id, .. }
            | FeatureProperties::Point { id, .. }
            | FeatureProperties::Segment { id, .. }
            | FeatureProperties::Zone { id, .. } => id,
        }
    }
}

/// A feature, typed by the role it plays.
///
/// `try_from` for the same reason [`PathEntry`] has one: §2.1's per-field
/// laws are parse-time laws, and `geometry: Value` means plain serde never
/// looks at a coordinate. A longitude of 181 has nowhere to be drawn, so it is
/// not a document rather than a document that cannot be run.
#[derive(Debug, Clone, Deserialize)]
#[serde(try_from = "RawFeature")]
pub struct Feature {
    #[allow(dead_code)]
    pub kind: String,
    pub properties: FeatureProperties,
    pub geometry: Value,
}

#[derive(Deserialize)]
struct RawFeature {
    #[serde(rename = "type")]
    kind: String,
    properties: FeatureProperties,
    geometry: Value,
}

impl TryFrom<RawFeature> for Feature {
    type Error = String;

    fn try_from(raw: RawFeature) -> Result<Self, Self::Error> {
        if raw.kind != "Feature" {
            return Err(format!("a feature's type is Feature, not {}", raw.kind));
        }
        let role = match &raw.properties {
            FeatureProperties::Line { .. } => "line",
            FeatureProperties::Point { along_m, .. } => {
                along("along_m", *along_m)?;
                "point"
            }
            FeatureProperties::Segment { from_m, to_m, .. } => {
                along("from_m", *from_m)?;
                along("to_m", *to_m)?;
                "segment"
            }
            FeatureProperties::Zone { .. } => "zone",
        };
        geometry_for(role, &raw.geometry).map_err(|why| format!("{}: {why}", raw.properties.id()))?;
        Ok(Feature {
            kind: raw.kind,
            properties: raw.properties,
            geometry: raw.geometry,
        })
    }
}

#[derive(Debug, Clone, Deserialize)]
pub struct CourseDocument {
    /// Always `FeatureCollection`: anything else is not GeoJSON's, so not ours.
    #[serde(rename = "type", deserialize_with = "feature_collection")]
    pub kind: String,
    #[serde(rename = "sport:version", deserialize_with = "format_version")]
    pub version: u64,
    #[serde(rename = "sport:id")]
    pub id: String,
    #[serde(rename = "sport:event")]
    pub event: String,
    #[serde(rename = "sport:way", deserialize_with = "present")]
    pub way: Option<String>,
    #[serde(rename = "sport:name")]
    pub name: String,
    #[serde(rename = "sport:dialects")]
    pub dialects: Vec<String>,
    #[serde(rename = "sport:measure")]
    pub measure: Measure,
    #[serde(rename = "sport:provenance")]
    pub provenance: Vec<Provenance>,
    #[serde(rename = "sport:path")]
    pub path: Vec<PathEntry>,
    #[serde(rename = "sport:rules")]
    pub rules: Vec<DocumentRule>,
    pub features: Vec<Feature>,
}

/// A named place on the course, with its address.
pub struct NamedPlace<'a> {
    pub id: &'a str,
    pub kind: &'a str,
    pub along_m: f64,
}

/// The observation kind a place of this `kind` yields when somebody reaches it.
///
/// Normative: a rule requiring a kind the place never produces can never fire.
pub fn produces(kind: &str) -> &'static str {
    match kind {
        "start" => "started",
        "finish" | "lap" => "finished",
        "control" => "punched",
        "check" => "checked",
        "transition_in" | "zone_in" => "entered",
        "transition_out" | "zone_out" => "left",
        _ => "passed",
    }
}

/// A law a document or a log breaks: the sentence, byte-identical to the
/// reference's, and what broke it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct BrokenLaw {
    pub law: &'static str,
    pub what: String,
}

/// Why a document that draws cannot also be run. Serialised with the
/// reference's member names, so a refusal crosses a boundary as data.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct NotRunnable {
    /// The document's `sport:version` when this build does not run it.
    pub unknown_version: Option<u64>,
    pub missing_dialects: Vec<String>,
    pub refused: Vec<Refusal>,
    pub broken: Vec<BrokenLaw>,
}

impl std::fmt::Display for NotRunnable {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "not runnable: ")?;
        if let Some(version) = self.unknown_version {
            write!(f, "version {version} is not one this build runs, ")?;
        }
        let refused: Vec<String> = self.refused.iter().map(|r| format!("{} {}", r.id, r.why)).collect();
        let broken: Vec<String> = self.broken.iter().map(|b| format!("{} ({})", b.law, b.what)).collect();
        write!(
            f,
            "dialects missing {:?}; rules refused {refused:?}; laws broken {broken:?}",
            self.missing_dialects
        )
    }
}

impl std::error::Error for NotRunnable {}

impl CourseDocument {
    pub fn points(&self) -> Vec<NamedPlace<'_>> {
        self.features
            .iter()
            .filter_map(|f| match &f.properties {
                FeatureProperties::Point { id, kind, along_m, .. } => Some(NamedPlace {
                    id,
                    kind,
                    along_m: *along_m,
                }),
                _ => None,
            })
            .collect()
    }

    /// How long the way in is, following the playlist rather than the line.
    pub fn path_length_m(&self) -> f64 {
        self.path.iter().map(|e| (e.to_m - e.from_m) * e.repeat).sum()
    }

    /// Everything true of a document that a per-field check cannot express.
    pub fn broken_laws(&self) -> Vec<BrokenLaw> {
        let mut broken = Vec::new();
        let ids: Vec<&str> = self.features.iter().map(|f| f.properties.id()).collect();
        for id in &ids {
            if ids.iter().filter(|other| *other == id).count() > 1 && !broken.iter().any(|b: &BrokenLaw| b.what == **id)
            {
                broken.push(BrokenLaw {
                    law: "a feature id is used twice",
                    what: (*id).to_string(),
                });
            }
        }

        let lines: Vec<&str> = self
            .features
            .iter()
            .filter_map(|f| match &f.properties {
                FeatureProperties::Line { id, .. } => Some(id.as_str()),
                _ => None,
            })
            .collect();
        if lines.is_empty() {
            broken.push(BrokenLaw {
                law: "the document carries no line",
                what: self.name.clone(),
            });
        }

        for entry in &self.path {
            if entry.to_m <= entry.from_m {
                broken.push(BrokenLaw {
                    law: "a path slice ends before it starts",
                    what: entry.line.clone(),
                });
            }
            if !lines.contains(&entry.line.as_str()) {
                broken.push(BrokenLaw {
                    law: "the path names a line the document does not carry",
                    what: entry.line.clone(),
                });
            }
        }

        for feature in &self.features {
            if let FeatureProperties::Segment { id, from_m, to_m, .. } = &feature.properties {
                if to_m <= from_m {
                    broken.push(BrokenLaw {
                        law: "a segment ends before it starts",
                        what: id.clone(),
                    });
                }
            }
        }

        let length = self.path_length_m();
        let places = self.points();
        for place in &places {
            if place.along_m > length {
                broken.push(BrokenLaw {
                    law: "a place is beyond the end of the course",
                    what: place.id.to_string(),
                });
            }
        }

        for rule in &self.rules {
            if let Some(crate::kernel::Where::At(at)) = &rule.at {
                if let Some(point) = &at.point {
                    if !places.iter().any(|p| p.id == point) {
                        broken.push(BrokenLaw {
                            law: "a rule names a point the document does not carry",
                            what: format!("{} → {point}", rule.id),
                        });
                    }
                }
            }
        }
        broken
    }

    /// The law that needs the compiled rules, so it cannot live with the others.
    pub fn mismatched_kinds(&self, rules: &[KernelRule]) -> Vec<BrokenLaw> {
        let places = self.points();
        let mut broken = Vec::new();
        for rule in rules {
            for clause in &rule.when.clauses {
                let crate::kernel::Atom::Observed { at, kind } = &clause.atom else {
                    continue;
                };
                let Some(point) = &at.point else { continue };
                let Some(place) = places.iter().find(|p| p.id == point) else {
                    continue;
                };
                let yields = produces(place.kind);
                let wanted = serde_json::to_value(kind)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string));
                let wanted = wanted.unwrap_or_default();
                if wanted != yields {
                    broken.push(BrokenLaw {
                        law: "a rule requires an observation the place never produces",
                        what: format!(
                            "{} wants {wanted} at {point}, a {} which produces {yields}",
                            rule.id, place.kind
                        ),
                    });
                }
            }
        }
        broken
    }

    /// The rules this document runs under, or the reason it cannot be run.
    ///
    /// Two outcomes and deliberately no third. The third — *run what you
    /// understood* — is how a timing system disqualifies the wrong person.
    pub fn plan(&self, packs: &[Pack]) -> Result<Vec<KernelRule>, NotRunnable> {
        let unknown_version = (self.version != FORMAT_VERSION).then_some(self.version);
        let shipped: Vec<String> = packs.iter().map(Pack::dialect).collect();
        let missing_dialects: Vec<String> = self.dialects.iter().filter(|d| !shipped.contains(d)).cloned().collect();
        let (rules, refused) = compile(packs, &self.rules);
        let mut broken = self.broken_laws();
        broken.extend(self.mismatched_kinds(&rules));
        if unknown_version.is_none() && missing_dialects.is_empty() && refused.is_empty() && broken.is_empty() {
            Ok(rules)
        } else {
            Err(NotRunnable {
                unknown_version,
                missing_dialects,
                refused,
                broken,
            })
        }
    }
}
