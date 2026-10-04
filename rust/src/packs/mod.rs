//! pace-geojson: a dialect per sport.
//!
//! The kernel is closed and changes about once a year. A pack is how a sport
//! gets a vocabulary of its own without touching it: a named, versioned set of
//! rule *kinds*, each with parameters, an expansion into kernel terms, and the
//! sentence a person reads.
//!
//! An unknown dialect, an unknown kind, or parameters that do not fit make a
//! document **readable but not runnable**. The geometry still draws; the
//! implementation must refuse to produce results rather than running what it
//! happened to understand. Silently dropping a rule is how a timing system
//! disqualifies the wrong person.

use serde_json::Value;

use crate::kernel::{KernelRule, Where};

mod athletics;
mod backyard;
mod orienteering;
mod triathlon;

/// What a kind produces once its parameters are known.
pub struct Expansion {
    pub when: crate::kernel::Predicate,
    pub then: crate::kernel::Consequence,
    pub sentence: String,
}

/// A dialect: a name, a version, and the kinds it can compile.
pub struct Pack {
    pub name: &'static str,
    pub version: u32,
    pub modes: &'static [&'static str],
    /// Every kind `compile` understands — what a coverage check walks, since a
    /// `match` cannot be listed.
    pub kinds: &'static [&'static str],
    /// The kinds that mean nothing without a place — a station, a finish.
    /// Bound to `null` or to a span, `compile` refuses them: `needs a place`.
    pub placed: &'static [&'static str],
    pub compile: fn(kind: &str, params: &Value, at: &Option<Where>) -> Option<Expansion>,
}

impl Pack {
    pub fn dialect(&self) -> String {
        format!("{}@{}", self.name, self.version)
    }
}

/// The dialects this build understands.
pub fn all() -> Vec<Pack> {
    vec![
        athletics::pack(),
        backyard::pack(),
        orienteering::pack(),
        triathlon::pack(),
    ]
}

/// Why a rule could not be compiled: `unknown dialect`, `unknown kind`,
/// `needs a place` or `parameters do not fit`, byte-identical to the reference.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
pub struct Refusal {
    pub id: String,
    pub dialect: String,
    pub kind: String,
    pub why: &'static str,
}

/// A rule as it appears in a course document: a dialect, a kind, and parameters.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct DocumentRule {
    pub id: String,
    pub dialect: String,
    pub kind: String,
    pub ordinal: f64,
    #[serde(deserialize_with = "crate::kernel::present")]
    pub at: Option<Where>,
    pub params: Value,
}

/// Compile a document's rules against the packs we ship.
///
/// Returns both halves on purpose: a caller that wants to *draw* the course
/// uses `rules`, and a caller that wants **results** must refuse when `refused`
/// is non-empty.
pub fn compile(packs: &[Pack], document: &[DocumentRule]) -> (Vec<KernelRule>, Vec<Refusal>) {
    let mut rules = Vec::new();
    let mut refused = Vec::new();
    for row in document {
        let refusal = |why: &'static str| Refusal {
            id: row.id.clone(),
            dialect: row.dialect.clone(),
            kind: row.kind.clone(),
            why,
        };
        let Some(pack) = packs.iter().find(|p| p.dialect() == row.dialect) else {
            refused.push(refusal("unknown dialect"));
            continue;
        };
        if !pack.kinds.contains(&row.kind.as_str()) {
            refused.push(refusal("unknown kind"));
            continue;
        }
        if pack.placed.contains(&row.kind.as_str()) && !matches!(row.at, Some(Where::At(_))) {
            refused.push(refusal("needs a place"));
            continue;
        }
        // Every kind's parameters are an object, even an empty one.
        let expansion = if row.params.is_object() {
            (pack.compile)(&row.kind, &row.params, &row.at)
        } else {
            None
        };
        match expansion {
            None => refused.push(refusal("parameters do not fit")),
            Some(expansion) => rules.push(KernelRule {
                id: row.id.clone(),
                dialect: row.dialect.clone(),
                kind: row.kind.clone(),
                ordinal: row.ordinal,
                at: row.at.clone(),
                stratum: if crate::kernel::reads_field(&expansion.when) {
                    1
                } else {
                    0
                },
                when: expansion.when,
                then: expansion.then,
                sentence: expansion.sentence,
            }),
        }
    }
    (rules, refused)
}

/* ── shared shorthand, so a pack reads like the rule it says ─────────────── */

pub(crate) fn f(params: &Value, key: &str) -> Option<f64> {
    params.get(key).and_then(Value::as_f64)
}

pub(crate) fn s(params: &Value, key: &str) -> Option<String> {
    params.get(key).and_then(Value::as_str).map(str::to_string)
}

pub(crate) fn b(params: &Value, key: &str) -> Option<bool> {
    params.get(key).and_then(Value::as_bool)
}

pub(crate) fn all_of(clauses: Vec<crate::kernel::Clause>) -> crate::kernel::Predicate {
    crate::kernel::Predicate {
        combine: crate::kernel::Combine::All,
        clauses,
    }
}

pub(crate) fn any_of(clauses: Vec<crate::kernel::Clause>) -> crate::kernel::Predicate {
    crate::kernel::Predicate {
        combine: crate::kernel::Combine::Any,
        clauses,
    }
}

pub(crate) fn is(atom: crate::kernel::Atom) -> crate::kernel::Clause {
    crate::kernel::Clause { negated: false, atom }
}

pub(crate) fn not(atom: crate::kernel::Atom) -> crate::kernel::Clause {
    crate::kernel::Clause { negated: true, atom }
}

pub(crate) fn place(point: &str, along_m: f64) -> crate::kernel::Place {
    crate::kernel::Place {
        point: Some(point.to_string()),
        along_m,
    }
}

/// A duration for a sentence — `m:ss`, or `h:mm:ss` from an hour — and `.mmm`
/// only when it is not whole seconds, so no parameter is rounded into a number
/// the rule does not use. The magnitude only: the caller says which way it goes.
pub(crate) fn span(ms: f64) -> String {
    let exact = ms.abs().round() as i64;
    let (total, rest) = (exact / 1000, exact % 1000);
    let (h, m, s) = (total / 3600, (total % 3600) / 60, total % 60);
    let clock = if h > 0 {
        format!("{h}:{m:02}:{s:02}")
    } else {
        format!("{}:{s:02}", total / 60)
    };
    if rest == 0 {
        clock
    } else {
        format!("{clock}.{}", format!("{rest:03}").trim_end_matches('0'))
    }
}

/// What an `adjust_time` of `ms` does to the total, said: a penalty costs, a bonus gives back.
pub(crate) fn costs(ms: f64) -> String {
    if ms < 0.0 {
        format!("gives back {}", span(ms))
    } else {
        format!("costs {}", span(ms))
    }
}

/// A place as a sentence names it: its point id, else the start line, else its distance.
pub(crate) fn place_name(place: &crate::kernel::Place) -> String {
    match &place.point {
        Some(point) => point.clone(),
        None if place.along_m == 0.0 => "the start".to_string(),
        None => format!("the place at {} m", place.along_m),
    }
}

/// Where a wall-clock gate is judged: the rule's own place, or the finish when
/// it has none (SPEC.md §3.2, `clock wall`).
pub(crate) fn judged_at(at: &Option<Where>) -> String {
    match at {
        Some(Where::At(p)) => place_name(p),
        _ => "the finish".to_string(),
    }
}
