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
//! A case carries its document as a value (`document`) or, where the law under
//! test is one only the text can break, as the text itself (`document_text`),
//! and its log likewise (`log` or `log_text`). A text goes to `parse_document`
//! as it is written; a value goes through serde, and is also written out and
//! parsed, because a lawful value's text must get the same verdict.
//!
//! Nothing here is shared with the reference beyond the JSON files.

use pace_geojson::{
    document::{parse_document, CourseDocument},
    observe::{broken_log_laws, parse_log, Observation},
    packs,
    text::{HALF_A_PAIR, NAMED_TWICE},
};
use serde::Deserialize;

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
    /// The document as a value, or — for a law of the text — as its text. One of the two.
    #[serde(default)]
    document: Option<serde_json::Value>,
    #[serde(default)]
    document_text: Option<String>,
    /// The log beside it, the same two ways.
    #[serde(default)]
    log: Option<serde_json::Value>,
    #[serde(default)]
    log_text: Option<String>,
}

impl Case {
    /// The case's document, read the way the case carries it — and, for a
    /// value, whether its text got the same verdict.
    fn document(&self) -> (Result<CourseDocument, String>, bool) {
        match (&self.document, &self.document_text) {
            (Some(value), None) => {
                let decoded = serde_json::from_value::<CourseDocument>(value.clone()).map_err(|e| e.to_string());
                let as_text = parse_document(&value.to_string());
                let same = decoded.is_ok() == as_text.is_ok();
                (decoded, same)
            }
            (None, Some(text)) => (parse_document(text), true),
            _ => (
                Err("the case carries its document both ways, or neither".to_string()),
                false,
            ),
        }
    }

    /// And its log, or `None` when it carries none.
    fn log(&self) -> Option<(Result<Vec<Observation>, String>, bool)> {
        match (&self.log, &self.log_text) {
            (Some(value), None) => {
                let decoded = serde_json::from_value::<Vec<Observation>>(value.clone()).map_err(|e| e.to_string());
                let same = decoded.is_ok() == parse_log(&value.to_string()).is_ok();
                Some((decoded, same))
            }
            (None, Some(text)) => Some((parse_log(text), true)),
            (None, None) => None,
            (Some(_), Some(_)) => Some((Err("the case carries its log both ways".to_string()), false)),
        }
    }
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
    // nothing passes. Fifty-four today — fourteen accepts, twenty-three
    // rejects, seventeen refuses, eight of the accepts judging a log — and the
    // count is exact: fewer is a file that went missing, and more is a file
    // the generator no longer writes, which it never deletes.
    let cases = corpus();
    let count = |verdict: &str| cases.iter().filter(|(_, case)| case.expect.verdict == verdict).count();
    assert_eq!(
        (count("accepts"), count("rejects"), count("refuses"), cases.len()),
        (14, 23, 17, 54),
        "accepts, rejects, refuses, and the whole decode corpus"
    );
    // Eleven of them carry a text: nine a document's, two a log's.
    let documents = cases.iter().filter(|(_, case)| case.document_text.is_some()).count();
    let logs = cases.iter().filter(|(_, case)| case.log_text.is_some()).count();
    assert_eq!((documents, logs), (9, 2), "the cases that carry a text");
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
        let (decoded, same_as_text) = case.document();
        if !same_as_text {
            problems.push(format!(
                "{}: the document as a value and as its text are judged differently",
                case.name
            ));
        }

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
                    judge_log(&case.name, want, case.log(), &mut problems);
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
fn judge_log(
    name: &str,
    want: &LogExpect,
    log: Option<(Result<Vec<Observation>, String>, bool)>,
    problems: &mut Vec<String>,
) {
    let Some((log, same_as_text)) = log else {
        problems.push(format!("{name}: judges a log and carries none"));
        return;
    };
    if !same_as_text {
        problems.push(format!(
            "{name}: the log as a value and as its text are judged differently"
        ));
    }
    match log {
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

/// One case, by its name.
fn case_of(name: &str) -> Case {
    let found = corpus().into_iter().find(|(_, case)| case.name == name);
    found.unwrap_or_else(|| panic!("the corpus has no {name}")).1
}

/// One case's document, by the case's name.
fn document_of(name: &str) -> serde_json::Value {
    case_of(name)
        .document
        .unwrap_or_else(|| panic!("{name} carries no document as a value"))
}

/// `rejects` is one bit here too, and a text case could be rejected for a typo
/// in its own edit. So each is held to the law it is about, by the sentence —
/// and to the other half of the claim: that the value a parser makes of it is
/// lawful, so nothing but the text could have shown it.
#[test]
fn a_text_that_breaks_a_law_of_the_text_is_rejected_for_that_law() {
    let cases = [
        ("rejects-a-version-written-twice", NAMED_TWICE, "pace-geojson"),
        ("rejects-a-measure-with-a-member-twice", NAMED_TWICE, "distance_m"),
        ("rejects-a-rule-with-a-parameter-twice", NAMED_TWICE, "within_ms"),
        ("rejects-a-foreign-member-written-twice", NAMED_TWICE, "x:note"),
        ("rejects-a-name-written-twice-under-an-escape", NAMED_TWICE, "pace:way"),
        (
            "rejects-a-string-with-half-a-surrogate-pair",
            HALF_A_PAIR,
            "evt_\\\\ud83d",
        ),
        (
            "rejects-a-foreign-string-with-half-a-surrogate-pair",
            HALF_A_PAIR,
            "\\\\ude00",
        ),
        ("rejects-a-log-with-a-member-twice", NAMED_TWICE, "entrant"),
        ("rejects-a-log-with-half-a-surrogate-pair", HALF_A_PAIR, "ent_\\\\ud83d"),
    ];

    // Every text case that is rejected is in that list, so a new one cannot go unheld.
    let mut rejected: Vec<String> = corpus()
        .into_iter()
        .filter(|(_, case)| {
            (case.document_text.is_some() && case.expect.verdict == "rejects") || case.log_text.is_some()
        })
        .map(|(_, case)| case.name)
        .collect();
    rejected.sort();
    let mut named: Vec<&str> = cases.iter().map(|(name, _, _)| *name).collect();
    named.sort_unstable();
    assert_eq!(rejected, named);

    for (name, law, what) in cases {
        let case = case_of(name);
        let why = match (&case.document_text, &case.log_text) {
            (_, Some(text)) => parse_log(text).expect_err("the log parsed"),
            (Some(text), None) => parse_document(text).expect_err("the document parsed"),
            (None, None) => panic!("{name} carries no text"),
        };
        assert_eq!(why, format!("{law}: \"{what}\", line 1"), "{name}");

        // What a host that parses first is left holding: serde_json's `Value`
        // keeps the last of two members, as `JSON.parse` does.
        let text = case.log_text.as_ref().or(case.document_text.as_ref()).expect("a text");
        if law == NAMED_TWICE {
            let value: serde_json::Value = serde_json::from_str(text).expect("it is JSON");
            let lawful = match case.log_text {
                Some(_) => serde_json::from_value::<Vec<Observation>>(value).is_ok(),
                None => serde_json::from_value::<CourseDocument>(value).is_ok(),
            };
            assert!(lawful, "{name}: the value does not decode: the edit broke more");
        } else {
            // Half a pair has no value here at all: this language's strings cannot hold one.
            assert!(serde_json::from_str::<serde_json::Value>(text).is_err(), "{name}");
        }
    }
}

/// A pair written whole, and an escaped backslash before the same letters, are text.
#[test]
fn a_whole_pair_and_an_escaped_backslash_are_text() {
    let case = case_of("accepts-a-text-with-a-whole-pair-and-an-escaped-backslash");
    let document = parse_document(case.document_text.as_deref().expect("a text")).expect("it parses");
    assert_eq!(document.event, "evt_\u{1f600}_\\ud83d");
}

/// Why a document was rejected, in serde's words.
fn rejected_for(document: serde_json::Value) -> String {
    serde_json::from_value::<CourseDocument>(document)
        .expect_err("it decoded")
        .to_string()
}

/// A document's `<namespace>:<name>` members, or everything else at its root.
fn root_of(document: &serde_json::Value, members: bool) -> impl Iterator<Item = (String, serde_json::Value)> + '_ {
    let root = document.as_object().expect("a document is an object");
    root.iter()
        .filter(move |(key, _)| key.contains(':') == members)
        .map(|(key, value)| (key.clone(), value.clone()))
}

/// `rejects` is one bit, and a document in an earlier namespace breaks two
/// laws at once: its root member is missing and so is every member. A reader
/// with an alias for either half still rejects all three, so the reason is
/// asserted here: the root member, which is the first thing asked for.
#[test]
fn a_document_under_another_name_is_rejected_for_the_root_member() {
    for name in [
        "rejects-a-document-missing-its-version",
        "rejects-the-old-race-namespace",
        "rejects-the-old-sport-namespace",
    ] {
        assert_eq!(
            rejected_for(document_of(name)),
            "missing field `pace-geojson`",
            "{name}"
        );
    }
}

/// The two halves apart, which is what a rename by find-and-replace leaves
/// behind: the earlier draft's members under the current root member, and the
/// current members under the earlier root. Neither is read.
#[test]
fn a_half_renamed_document_is_rejected_for_the_half_that_is_old() {
    let current = document_of("the-base-accepts");
    let earlier = document_of("rejects-the-old-race-namespace");
    let graft = |members: &serde_json::Value, rest: &serde_json::Value| {
        let root: serde_json::Map<String, serde_json::Value> =
            root_of(members, true).chain(root_of(rest, false)).collect();
        serde_json::Value::Object(root)
    };

    let old_members = graft(&earlier, &current);
    assert_eq!(old_members["pace-geojson"], 1, "the current root member is there");
    assert_eq!(rejected_for(old_members), "missing field `pace:id`");

    let old_root = graft(&current, &earlier);
    assert_eq!(old_root["pace:id"], current["pace:id"], "the current members are there");
    assert_eq!(rejected_for(old_root), "missing field `pace-geojson`");
}
