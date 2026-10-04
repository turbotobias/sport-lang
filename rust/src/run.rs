//! A document and a log in, one answer out — SPEC.md §4's four calls as one.
//!
//! Three answers and no fourth, member for member the reference's `run`:
//!
//! - **ran** — every entrant's state, as [`EncodedState`].
//! - **refused** — the document draws and does not run, and `why` says which
//!   version, dialects, rules (with their ids) and laws (§3.3).
//! - **malformed** — the bytes are not a document or not a log: a per-field
//!   law, or a log law such as an id used twice (`broken`).
//!
//! `why` on a malformed answer is each engine's own wording; everything else
//! is the same in both.

use serde::Serialize;

use crate::document::{BrokenLaw, CourseDocument, NotRunnable};
use crate::fold::{fold, EncodedState};
use crate::observe::{broken_log_laws, Observation};
use crate::packs::Pack;

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Answer {
    /// The document ran, and this is what the rules made of the field.
    Ran { states: Vec<EncodedState> },
    /// Readable but not runnable, and why, as data.
    Refused { why: NotRunnable },
    /// The bytes were not a document or not a log.
    Malformed {
        why: String,
        /// The log laws broken, when that is why. Empty when the bytes did not decode.
        broken: Vec<BrokenLaw>,
    },
}

/// Decode both, plan, check the log, fold, encode. Total: every input has an
/// answer, and nothing panics.
pub fn run(packs: &[Pack], document_json: &str, log_json: &str) -> Answer {
    let document: CourseDocument = match serde_json::from_str(document_json) {
        Ok(d) => d,
        Err(e) => {
            return Answer::Malformed {
                why: format!("the document did not decode: {e}"),
                broken: Vec::new(),
            }
        }
    };
    let log: Vec<Observation> = match serde_json::from_str(log_json) {
        Ok(l) => l,
        Err(e) => {
            return Answer::Malformed {
                why: format!("the log did not decode: {e}"),
                broken: Vec::new(),
            }
        }
    };
    let rules = match document.plan(packs) {
        Ok(r) => r,
        Err(why) => return Answer::Refused { why },
    };
    let broken = broken_log_laws(&log);
    if !broken.is_empty() {
        return Answer::Malformed {
            why: "the log breaks a law".to_string(),
            broken,
        };
    }
    Answer::Ran {
        states: fold(&rules, &log).iter().map(|s| s.encoded()).collect(),
    }
}
