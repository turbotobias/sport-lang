//! pace-geojson: the evaluator.
//!
//! A race's results are a fold over an ordered log of observations, and nothing
//! else. Reproducible, late-tolerant, explainable and pure — all four fall out
//! of that one decision.
//!
//! Stratified, because some rules are about the field: every stratum-0 rule
//! against every entrant first, then the aggregates computed from those
//! results, then the rules that read them. A stratum may only read aggregates
//! over strata below it, so there is no cycle to diverge in.

use crate::kernel::{
    Aggregate, Atom, ClockMeasure, Combine, Consequence, Countable, KernelRule, ObservationKind, Place, Predicate,
    Standing, Where,
};
use crate::observe::{settle, Instant, Observation};
use serde::{Serialize, Serializer};
use std::collections::HashMap;

/// How near a place an observation has to be to count as *at* it.
///
/// A mat is laid across a road and a course is resampled before anyone measures
/// where 30 km is. Ten metres is tighter than either error and far looser than
/// the gap between two distinct points on any course anybody races.
const AT_TOLERANCE_M: f64 = 10.0;

fn at_place(observation: &Observation, place: &Place) -> bool {
    match (&place.point, &observation.at.point) {
        (Some(wanted), Some(seen)) => wanted == seen,
        _ => (observation.at.along_m - place.along_m).abs() <= AT_TOLERANCE_M,
    }
}

/// One rule firing, kept so a result can explain itself rather than assert.
#[derive(Debug, Clone, PartialEq)]
pub struct Applied {
    pub id_rule: String,
    pub kind: String,
    pub sentence: String,
    pub times: f64,
    pub added_ms: f64,
}

/// Where one entrant's day ended up.
#[derive(Debug, Clone, PartialEq)]
pub struct EntrantState {
    pub entrant: String,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
    pub withdrew: bool,
    pub seen: Vec<Observation>,
    pub quantities: Vec<(String, f64)>,
    pub flags: Vec<String>,
    pub laps: u32,
    pub punches: u32,
    pub standing: Standing,
    pub adjustment_ms: f64,
    pub neutralised_ms: f64,
    pub classes: Vec<(String, String)>,
    pub awards: Vec<String>,
    pub applied: Vec<Applied>,
}

impl EntrantState {
    fn blank(entrant: &str) -> Self {
        Self {
            entrant: entrant.to_string(),
            started_at: None,
            finished_at: None,
            withdrew: false,
            seen: Vec::new(),
            quantities: Vec::new(),
            flags: Vec::new(),
            laps: 0,
            punches: 0,
            standing: Standing::Clean,
            adjustment_ms: 0.0,
            neutralised_ms: 0.0,
            classes: Vec::new(),
            awards: Vec::new(),
            applied: Vec::new(),
        }
    }

    /// Wall-clock from the start to the finish, or to the last thing seen.
    pub fn elapsed_ms(&self) -> Option<f64> {
        let started = self.started_at?;
        let last = self.finished_at.or_else(|| self.seen.last().map(|o| o.epoch_ms()))?;
        Some((last - started) as f64)
    }

    /// Elapsed, less anything the document neutralised.
    pub fn moving_ms(&self) -> Option<f64> {
        self.elapsed_ms().map(|e| e - self.neutralised_ms)
    }

    /// The total a placing is decided on: moving time plus every penalty.
    pub fn total_ms(&self) -> Option<f64> {
        self.moving_ms().map(|m| m + self.adjustment_ms)
    }

    fn absorb(&mut self, o: Observation) {
        let t = o.epoch_ms();
        if o.kind == ObservationKind::Started && self.started_at.is_none() {
            self.started_at = Some(t);
        }
        // The *last* finish, not the first: a lapped course crosses the line
        // every lap.
        if o.kind == ObservationKind::Finished {
            self.finished_at = Some(t);
            self.laps += 1;
        }
        if o.kind == ObservationKind::Withdrew {
            self.withdrew = true;
        }
        if o.kind == ObservationKind::Punched {
            self.punches += 1;
        }
        if let (Some(name), Some(value)) = (&o.quantity_name, o.quantity_value) {
            self.quantities.retain(|(n, _)| n != name);
            self.quantities.push((name.clone(), value));
        }
        for flag in &o.flags {
            if !self.flags.contains(flag) {
                self.flags.push(flag.clone());
            }
        }
        self.seen.push(o);
    }

    fn first_at(&self, place: &Place) -> Option<&Observation> {
        self.seen.iter().find(|o| at_place(o, place))
    }
}

/// A settled log, partitioned by entrant: entrants in order of first
/// appearance (SPEC.md §3.1), each with their own observations in settled
/// order.
///
/// One pass and a hash index. Finding each entrant's observations by filtering
/// the whole log instead makes a fold cost the log times the field. The map is
/// only an index into the vector, so its iteration order never reaches a
/// result.
pub fn by_entrant(ordered: Vec<Observation>) -> Vec<(String, Vec<Observation>)> {
    let mut groups: Vec<(String, Vec<Observation>)> = Vec::new();
    let mut index: HashMap<String, usize> = HashMap::new();
    for o in ordered {
        match index.get(&o.entrant) {
            Some(&slot) => groups[slot].1.push(o),
            None => {
                index.insert(o.entrant.clone(), groups.len());
                groups.push((o.entrant.clone(), vec![o]));
            }
        }
    }
    groups
}

/// What the field looks like, recomputed between strata.
struct Field {
    winner_ms: Option<f64>,
    finishers: usize,
    remaining: usize,
    /// Keyed, so a `rank` atom is one lookup rather than a scan of the field.
    rank: HashMap<String, usize>,
}

fn survey(states: &[EntrantState]) -> Field {
    let finished: Vec<&EntrantState> = states
        .iter()
        .filter(|s| s.finished_at.is_some() && s.standing != Standing::Disqualified)
        .collect();
    let mut totals: Vec<(&str, f64)> = finished
        .iter()
        .filter_map(|s| s.total_ms().map(|t| (s.entrant.as_str(), t)))
        .collect();
    totals.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    Field {
        winner_ms: totals.first().map(|t| t.1),
        finishers: finished.len(),
        remaining: states
            .iter()
            .filter(|s| !s.withdrew && s.standing != Standing::Disqualified && s.standing != Standing::Gated)
            .count(),
        rank: totals
            .iter()
            .enumerate()
            .map(|(i, t)| (t.0.to_string(), i + 1))
            .collect(),
    }
}

fn answers(atom: &Atom, state: &EntrantState, rule: &KernelRule, field: &Field) -> bool {
    match atom {
        Atom::Observed { at, kind } => state.seen.iter().any(|o| at_place(o, at) && o.kind == *kind),

        // A subsequence, not a contiguous run: passing extra mats between two
        // controls is normal and is not a mispunch.
        Atom::Order { sequence } => {
            let mut cursor = 0usize;
            for o in &state.seen {
                if let Some(wanted) = sequence.get(cursor) {
                    if at_place(o, wanted) {
                        cursor += 1;
                    }
                }
            }
            cursor == sequence.len()
        }

        Atom::Clock {
            measure,
            cmp,
            value_ms,
            value_at,
            from,
            to,
        } => match measure {
            ClockMeasure::Wall => {
                let Some(at) = value_at else { return false };
                // Against the rule's own place: "arrives after 16:30" is about
                // arriving *there*. A rule with no place is about the finish.
                let arrival = match &rule.at {
                    Some(Where::At(place)) => state.first_at(place).map(|o| o.epoch_ms()),
                    _ => state.finished_at,
                };
                match arrival {
                    None => false,
                    Some(t) => cmp.holds(t as f64, at.epoch_ms() as f64),
                }
            }
            ClockMeasure::Split => {
                let (Some(from), Some(to), Some(value)) = (from, to, value_ms) else {
                    return false;
                };
                match (state.first_at(from), state.first_at(to)) {
                    (Some(a), Some(b)) => cmp.holds((b.epoch_ms() - a.epoch_ms()) as f64, *value),
                    _ => false,
                }
            }
            ClockMeasure::Elapsed | ClockMeasure::Moving => {
                let measured = if *measure == ClockMeasure::Elapsed {
                    state.elapsed_ms()
                } else {
                    state.moving_ms()
                };
                match (measured, value_ms) {
                    (Some(m), Some(v)) => cmp.holds(m, *v),
                    _ => false,
                }
            }
        },

        Atom::Count { what, cmp, value } => {
            let n = match what {
                Countable::Laps => state.laps as f64,
                Countable::Punches => state.punches as f64,
                Countable::Penalties => state.applied.iter().filter(|a| a.added_ms > 0.0).count() as f64,
                Countable::Observations => state.seen.len() as f64,
            };
            cmp.holds(n, *value)
        }

        // A measurement nobody took is not a measurement that passed: a kit rule
        // has to fire on the runner whose pack was never weighed.
        Atom::Quantity { name, cmp, value } => match state.quantities.iter().find(|(n, _)| n == name) {
            Some((_, found)) => cmp.holds(*found, *value),
            None => false,
        },

        Atom::Flag { name } => state.flags.contains(name),
        Atom::Standing { is } => state.standing == *is,
        Atom::Withdrawn => state.withdrew,

        Atom::Field {
            aggregate,
            cmp,
            value,
            ratio,
        } => match aggregate {
            Aggregate::WinnerElapsed => match (field.winner_ms, state.total_ms()) {
                (Some(winner), Some(mine)) => cmp.holds(mine, winner * ratio.unwrap_or(1.0)),
                _ => false,
            },
            Aggregate::Rank => {
                let n = field
                    .rank
                    .get(state.entrant.as_str())
                    .map(|r| *r as f64)
                    .unwrap_or(f64::INFINITY);
                cmp.holds(n, *value)
            }
            Aggregate::Finishers => cmp.holds(field.finishers as f64, *value),
            Aggregate::Remaining => cmp.holds(field.remaining as f64, *value),
        },
    }
}

/// The whole `when`: every clause, or any clause, each possibly denied.
fn holds(predicate: &Predicate, state: &EntrantState, rule: &KernelRule, field: &Field) -> bool {
    let truth = |clause: &crate::kernel::Clause| answers(&clause.atom, state, rule, field) != clause.negated;
    match predicate.combine {
        Combine::All => predicate.clauses.iter().all(truth),
        Combine::Any => predicate.clauses.iter().any(truth),
    }
}

/// How many times the thing the rule is about happened.
fn occurrences(predicate: &Predicate, state: &EntrantState) -> f64 {
    let counts: Vec<usize> = predicate
        .clauses
        .iter()
        .filter_map(|clause| match &clause.atom {
            Atom::Observed { at, kind } => {
                Some(state.seen.iter().filter(|o| at_place(o, at) && o.kind == *kind).count())
            }
            _ => None,
        })
        .collect();
    counts.into_iter().max().unwrap_or(1) as f64
}

/// A rule bound to a place cannot judge somebody who has not got there yet.
///
/// Stated as `not(observed at 30 km)` a station rule is **true** at 10 km —
/// every negative predicate is, before the thing it denies has had its chance.
/// The final result is the same either way; this exists for the live and
/// replayed views, which is the only place the difference is visible.
fn dormant(rule: &KernelRule, state: &EntrantState) -> bool {
    let Some(Where::At(place)) = &rule.at else { return false };
    if state.finished_at.is_some() || state.withdrew {
        return false;
    }
    let furthest = state.seen.iter().fold(0.0f64, |far, o| far.max(o.at.along_m));
    furthest + AT_TOLERANCE_M < place.along_m
}

/// A standing only ever gets worse.
fn worse_of(a: Standing, b: Standing) -> Standing {
    if b > a {
        b
    } else {
        a
    }
}

fn apply(state: &mut EntrantState, rule: &KernelRule, times: f64) {
    let note = |added_ms: f64| Applied {
        id_rule: rule.id.clone(),
        kind: format!("{}.{}", rule.dialect, rule.kind),
        sentence: rule.sentence.clone(),
        times,
        added_ms,
    };
    match &rule.then {
        Consequence::AdjustTime { by_ms, each_time } => {
            let added = by_ms * if *each_time { times } else { 1.0 };
            state.adjustment_ms += added;
            if added > 0.0 {
                state.standing = worse_of(state.standing, Standing::Penalised);
            }
            state.applied.push(note(added));
        }
        Consequence::SetStanding { standing, .. } => {
            state.standing = worse_of(state.standing, *standing);
            state.applied.push(note(0.0));
        }
        Consequence::Classify { dimension, value } => {
            state.classes.retain(|(d, _)| d != dimension);
            state.classes.push((dimension.clone(), value.clone()));
            state.applied.push(note(0.0));
        }
        Consequence::Award { name } => {
            if !state.awards.contains(name) {
                state.awards.push(name.clone());
            }
            state.applied.push(note(0.0));
        }
        Consequence::Neutralise { from, to } => {
            let off = match (state.first_at(from), state.first_at(to)) {
                (Some(a), Some(b)) => ((b.epoch_ms() - a.epoch_ms()) as f64).max(0.0),
                _ => 0.0,
            };
            state.neutralised_ms += off;
            state.applied.push(note(-off));
        }
    }
}

/// Every entrant's day, from the document's rules and the bridge's log.
pub fn fold(rules: &[KernelRule], log: &[Observation]) -> Vec<EntrantState> {
    // Pass one: the observations, in time order, into per-entrant state. The
    // log is partitioned once, so this pass is linear in the log.
    let mut states: Vec<EntrantState> = by_entrant(settle(log))
        .into_iter()
        .map(|(entrant, seen)| {
            let mut state = EntrantState::blank(&entrant);
            state.seen.reserve(seen.len());
            for o in seen {
                state.absorb(o);
            }
            state
        })
        .collect();

    let mut by_stratum: Vec<&KernelRule> = rules.iter().collect();
    by_stratum.sort_by(|a, b| {
        a.stratum
            .cmp(&b.stratum)
            .then_with(|| a.ordinal.partial_cmp(&b.ordinal).unwrap_or(std::cmp::Ordering::Equal))
    });

    // Sorted by stratum, so each stratum is one run of the slice.
    for here in by_stratum.chunk_by(|a, b| a.stratum == b.stratum) {
        let field = survey(&states);
        for state in states.iter_mut() {
            for rule in here {
                if !dormant(rule, state) && holds(&rule.when, state, rule, &field) {
                    let times = occurrences(&rule.when, state);
                    apply(state, rule, times);
                }
            }
        }
    }
    states
}

/// The race as it stood at `t`. A prefix of the log, folded.
pub fn fold_until(rules: &[KernelRule], log: &[Observation], t_ms: i64) -> Vec<EntrantState> {
    let prefix: Vec<Observation> = log.iter().filter(|o| o.epoch_ms() <= t_ms).cloned().collect();
    fold(rules, &prefix)
}

/* ── what crosses a boundary ─────────────────────────────────────────────── */

/// The largest whole number every JSON reader holds exactly (2^53 − 1).
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

/// A number as the reference writes it: `2790000`, never `2790000.0`.
///
/// Every time here is an `f64` of milliseconds, and serde writes a whole `f64`
/// with a trailing `.0` — a different JSON text for the same number, and not the
/// bytes the corpus is written in.
fn number<S: Serializer>(value: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if value.fract() == 0.0 && value.abs() <= MAX_SAFE {
        serializer.serialize_i64(*value as i64)
    } else {
        serializer.serialize_f64(*value)
    }
}

fn maybe_number<S: Serializer>(value: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match value {
        Some(v) => number(v, serializer),
        None => serializer.serialize_none(),
    }
}

/// One rule firing, as it crosses a boundary.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EncodedApplied {
    pub id_rule: String,
    pub kind: String,
    pub sentence: String,
    #[serde(serialize_with = "number")]
    pub times: f64,
    #[serde(serialize_with = "number")]
    pub added_ms: f64,
}

/// A `classify` that fired: a dimension and its value.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Class {
    pub dimension: String,
    pub value: String,
}

/// One entrant's day as it crosses a boundary — SPEC.md §4, and member for
/// member the reference's `EntrantState` encoding.
///
/// It says what happened and leaves placing to the reader: a finisher has
/// `finished_at` (and, on a lapped course, every lap in `laps`, because every
/// lap line is a `finished`); an entrant who started and did not finish has `started_at`
/// and no `finished_at` (`withdrew` says whether they said so); an entrant who
/// never started is not here, because the fold's entrants are the log's.
/// `total_ms` of a non-finisher runs to their last read and is never a time to
/// rank.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EncodedState {
    pub entrant: String,
    pub standing: Standing,
    pub started_at: Option<Instant>,
    pub finished_at: Option<Instant>,
    pub withdrew: bool,
    #[serde(serialize_with = "maybe_number")]
    pub total_ms: Option<f64>,
    #[serde(serialize_with = "number")]
    pub adjustment_ms: f64,
    #[serde(serialize_with = "number")]
    pub neutralised_ms: f64,
    pub laps: u32,
    pub punches: u32,
    pub awards: Vec<String>,
    pub classes: Vec<Class>,
    pub applied: Vec<EncodedApplied>,
}

impl EntrantState {
    /// This day, in the shape that crosses a boundary.
    pub fn encoded(&self) -> EncodedState {
        EncodedState {
            entrant: self.entrant.clone(),
            standing: self.standing,
            started_at: self.started_at.map(Instant::from_epoch_ms),
            finished_at: self.finished_at.map(Instant::from_epoch_ms),
            withdrew: self.withdrew,
            total_ms: self.total_ms(),
            adjustment_ms: self.adjustment_ms,
            neutralised_ms: self.neutralised_ms,
            laps: self.laps,
            punches: self.punches,
            awards: self.awards.clone(),
            classes: self
                .classes
                .iter()
                .map(|(dimension, value)| Class {
                    dimension: dimension.clone(),
                    value: value.clone(),
                })
                .collect(),
            applied: self
                .applied
                .iter()
                .map(|a| EncodedApplied {
                    id_rule: a.id_rule.clone(),
                    kind: a.kind.clone(),
                    sentence: a.sentence.clone(),
                    times: a.times,
                    added_ms: a.added_ms,
                })
                .collect(),
        }
    }
}
