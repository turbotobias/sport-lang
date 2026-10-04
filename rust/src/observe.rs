//! The one thing pace-geojson consumes, and the boundary it consumes it across.
//!
//! pace-geojson has no IO. A transponder mat, a GPS tracker, a judge's tablet, a
//! partner's webhook, a runner uploading the FIT off their watch: not one
//! appears in the language. They sit behind a *bridge* whose only output is an
//! ordered log of the observations below, because everything genuinely hard
//! about timing — identity over time, clock drift, forty reads of one tag, a
//! mat that uploads an hour late — is an IO problem wearing a rules costume.

use std::collections::HashSet;

use serde::{Deserialize, Deserializer, Serialize, Serializer};

use crate::document::BrokenLaw;
use crate::kernel::{present, ObservationKind, Place};

/// An instant: epoch milliseconds, read from exactly one text shape — §2.3.
///
/// `YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`, UTC, a day that
/// exists, an hour below 24, a minute and a second below 60. Anything else is
/// not an instant, so a document or a log carrying one does not decode: a
/// malformed file, never 1970 and never an offset quietly read as UTC. Written
/// back as `YYYY-MM-DDTHH:MM:SS.sssZ`, the shape the reference writes.
///
/// Parsed by hand rather than with a date library: a dependency here would be
/// a second opinion about what a timestamp means.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Instant(i64);

impl Instant {
    /// An instant from epoch milliseconds. Every `i64` in the years 0–9999 is one.
    pub fn from_epoch_ms(ms: i64) -> Self {
        Instant(ms)
    }

    pub fn epoch_ms(self) -> i64 {
        self.0
    }

    /// The §2.3 shape, or why the text is not in it.
    pub fn parse(text: &str) -> Result<Self, String> {
        let refuse = || format!("{text:?} is not an instant: YYYY-MM-DDTHH:MM:SS[.sss]Z, in UTC (SPEC.md §2.3)");
        let b = text.as_bytes();
        let shape_ok = (b.len() == 20 || b.len() == 24)
            && b[4] == b'-'
            && b[7] == b'-'
            && b[10] == b'T'
            && b[13] == b':'
            && b[16] == b':'
            && b[b.len() - 1] == b'Z'
            && (b.len() == 20 || b[19] == b'.');
        if !shape_ok {
            return Err(refuse());
        }
        let digits = |from: usize, to: usize| -> Option<i64> {
            let part = &b[from..to];
            part.iter()
                .all(u8::is_ascii_digit)
                .then(|| part.iter().fold(0i64, |n, d| n * 10 + i64::from(d - b'0')))
        };
        let fields = (
            digits(0, 4),
            digits(5, 7),
            digits(8, 10),
            digits(11, 13),
            digits(14, 16),
            digits(17, 19),
            if b.len() == 24 { digits(20, 23) } else { Some(0) },
        );
        let (Some(y), Some(mo), Some(d), Some(h), Some(mi), Some(s), Some(ms)) = fields else {
            return Err(refuse());
        };
        if !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 || s > 59 {
            return Err(refuse());
        }
        Ok(Instant(
            (days_from_civil(y, mo, d) * 86_400 + h * 3_600 + mi * 60 + s) * 1_000 + ms,
        ))
    }
}

impl std::fmt::Display for Instant {
    /// `YYYY-MM-DDTHH:MM:SS.sssZ`.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (days, rest) = (self.0.div_euclid(86_400_000), self.0.rem_euclid(86_400_000));
        let (y, m, d) = civil_from_days(days);
        write!(
            f,
            "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z",
            rest / 3_600_000,
            rest / 60_000 % 60,
            rest / 1_000 % 60,
            rest % 1_000
        )
    }
}

impl std::str::FromStr for Instant {
    type Err = String;
    fn from_str(text: &str) -> Result<Self, String> {
        Instant::parse(text)
    }
}

impl Serialize for Instant {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.collect_str(self)
    }
}

impl<'de> Deserialize<'de> for Instant {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let text = String::deserialize(deserializer)?;
        Instant::parse(&text).map_err(serde::de::Error::custom)
    }
}

fn leap(y: i64) -> bool {
    (y % 4 == 0 && y % 100 != 0) || y % 400 == 0
}

fn days_in_month(y: i64, m: i64) -> i64 {
    match m {
        2 if leap(y) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Howard Hinnant's `days_from_civil`: days since 1970-01-01, no leap seconds.
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// Its inverse, `civil_from_days`.
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (yoe + era * 400 + i64::from(m <= 2), m, d)
}

/// Where an observation came from. Provenance: the fold never reads it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceKind {
    Transponder,
    Gps,
    WatchUpload,
    Manual,
    Partner,
    Virtual,
}

/// One thing a bridge saw — §2.3. Every member is required; the nullable ones
/// are written `null`, never left out, exactly as the reference reads them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Observation {
    pub id: String,
    pub entrant: String,
    pub at: Place,
    pub kind: ObservationKind,
    /// The corrected instant. A device's own clock never reaches here.
    pub t: Instant,
    #[serde(deserialize_with = "present")]
    pub quantity_name: Option<String>,
    #[serde(deserialize_with = "present")]
    pub quantity_value: Option<f64>,
    pub flags: Vec<String>,
    pub source: SourceKind,
    #[serde(deserialize_with = "present")]
    pub device: Option<String>,
    pub confidence: f64,
    /// A correction names what it replaces. The replaced row stays.
    #[serde(deserialize_with = "present")]
    pub supersedes: Option<String>,
}

impl Observation {
    /// Epoch milliseconds.
    pub fn epoch_ms(&self) -> i64 {
        self.t.epoch_ms()
    }
}

/// Everything true of a log that a per-field check cannot express — §2.3.
///
/// One law: **an id is unique within a log.** It is the second sort key and
/// what a `supersedes` names, so two rows sharing one make a result depend on
/// the order they arrived in, and a correction naming it removes both. `settle`
/// and `fold` stay total; a host taking a log from outside asks this first.
/// The sentence is byte-identical to the reference's.
pub fn broken_log_laws(log: &[Observation]) -> Vec<BrokenLaw> {
    let mut seen: HashSet<&str> = HashSet::new();
    let mut twice: HashSet<&str> = HashSet::new();
    let mut broken = Vec::new();
    for o in log {
        if !seen.insert(o.id.as_str()) && twice.insert(o.id.as_str()) {
            broken.push(BrokenLaw {
                law: "an observation id is used twice",
                what: o.id.clone(),
            });
        }
    }
    broken
}

/// The log as the fold must see it: superseded rows dropped, then ordered.
///
/// Ordered by instant, then by id. The second key is not decoration: two mats
/// can stamp the same millisecond, and a fold whose result depends on which one
/// the database happened to return first is not reproducible.
///
/// That holds for a log whose ids are unique, which [`broken_log_laws`]
/// checks. Linear before the sort: the superseded ids are a set.
pub fn settle(log: &[Observation]) -> Vec<Observation> {
    let replaced: HashSet<&str> = log.iter().filter_map(|o| o.supersedes.as_deref()).collect();
    let mut kept: Vec<(i64, &Observation)> = log
        .iter()
        .filter(|o| !replaced.contains(o.id.as_str()))
        .map(|o| (o.epoch_ms(), o))
        .collect();
    kept.sort_by(|a, b| a.0.cmp(&b.0).then_with(|| a.1.id.cmp(&b.1.id)));
    kept.into_iter().map(|(_, o)| o.clone()).collect()
}
