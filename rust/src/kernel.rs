//! sport-lang: the kernel.
//!
//! The second implementation. Its whole purpose is to be written *from the
//! specification* — `SPEC.md` and the conformance corpus
//! beside it — rather than from the TypeScript, so that where the spec is
//! ambiguous the two disagree and a case gets added.
//!
//! Nine atoms, combined by one `all` or one `any` over a flat list of clauses.
//! Two levels, no recursion, and no floating point in a decision: every time is
//! an integer of milliseconds and every distance an integer of metres, because
//! `f64` accumulation order is the classic way two implementations of one fold
//! come to different answers.

use serde::{Deserialize, Deserializer, Serialize};

use crate::observe::Instant;

/// A nullable member that must still be **present** — written `null`, never
/// left out — as the reference reads every one of them (§2.1).
///
/// serde reads a missing `Option` field as `None` unless the field names its
/// own deserializer, so every such field names this one. Without it a document
/// missing `polyline` or `ascent_threshold_m` ran here and was rejected there.
pub fn present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}

/// A place on the course, addressed by how far along it is.
///
/// `along_m`, never a coordinate: a course that doubles back has two places at
/// one latitude and longitude and exactly one at 31 400 m.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Place {
    #[serde(deserialize_with = "present")]
    pub point: Option<String>,
    pub along_m: f64,
}

/// A stretch of the course — a drafting zone, a neutralised descent, a lap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Span {
    pub from_m: f64,
    pub to_m: f64,
}

/// Where a rule applies. `None` is the whole day.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Where {
    At(Place),
    Over(Span),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ObservationKind {
    Started,
    Passed,
    Entered,
    Left,
    Punched,
    Checked,
    Finished,
    Withdrew,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Cmp {
    Lt,
    Lte,
    Gt,
    Gte,
    Eq,
    Ne,
}

impl Cmp {
    /// The one place a comparison happens. There is no other arithmetic.
    pub fn holds(self, left: f64, right: f64) -> bool {
        match self {
            Cmp::Lt => left < right,
            Cmp::Lte => left <= right,
            Cmp::Gt => left > right,
            Cmp::Gte => left >= right,
            Cmp::Eq => left == right,
            Cmp::Ne => left != right,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClockMeasure {
    Elapsed,
    Moving,
    Wall,
    Split,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Countable {
    Laps,
    Punches,
    Penalties,
    Observations,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Aggregate {
    WinnerElapsed,
    Rank,
    Remaining,
    Finishers,
}

/// Where a day ended up. Ordered by severity, which is also their precedence:
/// a disqualified runner is not also gated.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Standing {
    Clean,
    Penalised,
    Gated,
    Disqualified,
}

/// One fact about an entrant, asked of the log. The whole of what a rule may know.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "_tag", rename_all = "snake_case")]
pub enum Atom {
    Observed {
        at: Place,
        kind: ObservationKind,
    },
    Order {
        sequence: Vec<Place>,
    },
    Clock {
        measure: ClockMeasure,
        cmp: Cmp,
        value_ms: Option<f64>,
        /// A wall-clock instant, parsed once when the rule is compiled.
        value_at: Option<Instant>,
        from: Option<Place>,
        to: Option<Place>,
    },
    Count {
        what: Countable,
        cmp: Cmp,
        value: f64,
    },
    Quantity {
        name: String,
        cmp: Cmp,
        value: f64,
    },
    Flag {
        name: String,
    },
    Standing {
        is: Standing,
    },
    Withdrawn,
    Field {
        aggregate: Aggregate,
        cmp: Cmp,
        value: f64,
        ratio: Option<f64>,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Clause {
    pub negated: bool,
    pub atom: Atom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Combine {
    All,
    Any,
}

/// The `when` half: two levels, and no more.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Predicate {
    pub combine: Combine,
    pub clauses: Vec<Clause>,
}

/// The `then` half. Five, and every rule any sport has needed reduces to them.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "_tag", rename_all = "snake_case")]
pub enum Consequence {
    AdjustTime { by_ms: f64, each_time: bool },
    SetStanding { standing: Standing, reason: String },
    Classify { dimension: String, value: String },
    Award { name: String },
    Neutralise { from: Place, to: Place },
}

/// One rule, expanded into the kernel.
#[derive(Debug, Clone, PartialEq)]
pub struct KernelRule {
    pub id: String,
    pub dialect: String,
    pub kind: String,
    pub ordinal: f64,
    pub at: Option<Where>,
    pub when: Predicate,
    pub then: Consequence,
    /// The sentence as a person read it. Never a regenerated paraphrase.
    pub sentence: String,
    pub stratum: u8,
}

/// Does this predicate read the field? Decides which stratum a rule is in.
pub fn reads_field(predicate: &Predicate) -> bool {
    predicate
        .clauses
        .iter()
        .any(|clause| matches!(clause.atom, Atom::Field { .. }))
}
