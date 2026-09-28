//! The decode corpus, run against this implementation.
//!
//! `conformance.rs` asserts the fold. This asserts the **file**: which
//! documents are documents, which are documents that cannot be run, and which
//! law each refusal is about. `SPEC.md` §2.1 states both groups of laws, and
//! without this nothing checks that two implementations agree about any of
//! them.
//!
//! Three verdicts:
//!
//! - **accepts** — decodes and plans.
//! - **rejects** — not a document. A per-field law, refused at parse.
//! - **refuses** — a document, and not a runnable one. The geometry is fine and
//!   a map must still draw it; only `plan` declines.
//!
//! A `refuses` case asserts *which* laws broke, by sentence, because
//! `BrokenLaw.law` is byte-identical to the reference's `TBrokenLaw.law`. The
//! sentences are compared as a sorted **multiset**: a law listed once per place
//! that broke it is a multiplicity both implementations have to agree on.
//!
//! Nothing here is shared with the reference beyond the JSON files.

use serde::Deserialize;
use sport_lang::{
    document::CourseDocument,
    observe::{broken_log_laws, Observation},
    packs,
};

#[derive(Debug, Deserialize, PartialEq)]
struct Refused {
    id: String,
    why: String,
}

#[derive(Debug, Deserialize)]
struct LogExpect {
    verdict: String,
    #[serde(default)]
    laws: Vec<String>,
}

#[derive(Debug, Deserialize)]
struct Expect {
    verdict: String,
    #[serde(default)]
    laws: Vec<String>,
    #[serde(default)]
    missing_dialects: Vec<String>,
    /// Every rule refused, by id, with the reason in the words both engines use.
    #[serde(default)]
    refused: Vec<Refused>,
    /// Absent unless the version itself is a reason to refuse.
    #[serde(default)]
    unknown_version: Option<u64>,
    /// What a reader makes of the case's `log`, when it carries one.
    #[serde(default)]
    log: Option<LogExpect>,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    why: String,
    expect: Expect,
    document: serde_json::Value,
    #[serde(default)]
    log: Option<serde_json::Value>,
}

fn corpus() -> Vec<(String, Case)> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../corpus/decode/*.json");
    let mut cases: Vec<(String, Case)> = glob::glob(root)
        .expect("the corpus path is a valid glob")
        .filter_map(Result::ok)
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
            let case: Case = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?} did not decode: {e}"));
            (path.display().to_string(), case)
        })
        .collect();
    cases.sort_by(|a, b| a.0.cmp(&b.0));
    cases
}

#[test]
fn the_corpus_exists() {
    // Every assertion below is inside a loop over these files, and a loop over
    // nothing passes. Forty today — ten accepts, thirteen rejects, seventeen
    // refuses, six of them judging a log — and fewer means a file went
    // missing, not that the corpus shrank.
    assert!(corpus().len() >= 40, "the decode corpus has at least forty cases");
}

/// Every case, and **every** disagreement rather than the first.
///
/// A panic on the first one turns a corpus of twenty into a corpus of one per
/// run, which is a slow way to find out that a whole group of laws is
/// unenforced. They are collected and printed together.
#[test]
fn every_document_gets_the_verdict_the_corpus_names() {
    let packs = packs::all();
    let mut checked = 0usize;
    let mut problems: Vec<String> = Vec::new();

    for (_path, case) in corpus() {
        checked += 1;
        let decoded: Result<CourseDocument, _> = serde_json::from_value(case.document.clone());

        if case.expect.verdict == "rejects" {
            if decoded.is_ok() {
                problems.push(format!(
                    "{}: decoded, and a per-field law was supposed to stop it — {}",
                    case.name, case.why
                ));
            }
            continue;
        }

        let document = match decoded {
            Ok(d) => d,
            Err(e) => {
                problems.push(format!(
                    "{}: did not decode, and this case is `{}`: {e}",
                    case.name, case.expect.verdict
                ));
                continue;
            }
        };

        match document.plan(&packs) {
            Ok(_) => {
                if case.expect.verdict != "accepts" {
                    problems.push(format!(
                        "{}: planned, and the corpus says `{}` — {}",
                        case.name, case.expect.verdict, case.why
                    ));
                }
                if let Some(want) = &case.expect.log {
                    judge_log(&case.name, want, case.log.as_ref(), &mut problems);
                }
            }
            Err(not_runnable) => {
                if case.expect.verdict != "refuses" {
                    problems.push(format!(
                        "{}: was refused, and the corpus says `{}` — {not_runnable}",
                        case.name, case.expect.verdict
                    ));
                    continue;
                }

                let mut laws: Vec<&str> = not_runnable.broken.iter().map(|b| b.law).collect();
                laws.sort_unstable();
                let mut want: Vec<&str> = case.expect.laws.iter().map(String::as_str).collect();
                want.sort_unstable();
                if laws != want {
                    problems.push(format!("{}: broke {laws:?}, the corpus names {want:?}", case.name));
                }

                let mut missing = not_runnable.missing_dialects.clone();
                missing.sort();
                let mut want_missing = case.expect.missing_dialects.clone();
                want_missing.sort();
                if missing != want_missing {
                    problems.push(format!(
                        "{}: missing dialects {missing:?}, the corpus names {want_missing:?}",
                        case.name
                    ));
                }

                if not_runnable.unknown_version != case.expect.unknown_version {
                    problems.push(format!(
                        "{}: unknown version {:?}, the corpus names {:?}",
                        case.name, not_runnable.unknown_version, case.expect.unknown_version
                    ));
                }

                let mut refused: Vec<Refused> = not_runnable
                    .refused
                    .iter()
                    .map(|r| Refused {
                        id: r.id.clone(),
                        why: r.why.to_string(),
                    })
                    .collect();
                refused.sort_by(|a, b| a.id.cmp(&b.id));
                if refused != case.expect.refused {
                    problems.push(format!(
                        "{}: refused {refused:?}, the corpus names {:?}",
                        case.name, case.expect.refused
                    ));
                }
            }
        }
    }

    assert!(checked > 0, "the corpus asserted nothing");
    assert!(
        problems.is_empty(),
        "{} of {checked} documents were judged differently here:\n  {}",
        problems.len(),
        problems.join("\n  ")
    );
    println!("{checked} documents judged");
}

/// The log beside an accepting document: rejected at parse, refused by a log
/// law, or accepted — the same three verdicts as the document's.
fn judge_log(name: &str, want: &LogExpect, log: Option<&serde_json::Value>, problems: &mut Vec<String>) {
    let Some(log) = log else {
        problems.push(format!("{name}: judges a log and carries none"));
        return;
    };
    match serde_json::from_value::<Vec<Observation>>(log.clone()) {
        Err(e) => {
            if want.verdict != "rejects" {
                problems.push(format!(
                    "{name}: the log did not decode, and the corpus says `{}`: {e}",
                    want.verdict
                ));
            }
        }
        Ok(observations) => {
            if want.verdict == "rejects" {
                problems.push(format!(
                    "{name}: the log decoded; a per-field law was supposed to stop it"
                ));
                return;
            }
            let mut laws: Vec<&str> = broken_log_laws(&observations).iter().map(|b| b.law).collect();
            laws.sort_unstable();
            let mut expected: Vec<&str> = want.laws.iter().map(String::as_str).collect();
            expected.sort_unstable();
            if laws != expected {
                problems.push(format!("{name}: the log broke {laws:?}, the corpus names {expected:?}"));
            }
        }
    }
}
