//! The conformance corpus, run against this implementation.
//!
//! This is the test the crate exists for. `corpus/conformance/*.json`
//! is a document, an observation log, and the state every entrant must end in;
//! the TypeScript reference produces those answers and so must this. Where the
//! two disagree, either the spec was ambiguous or one of them is wrong, and
//! both are worth finding out.
//!
//! Nothing here is shared with the reference beyond the JSON files themselves.

use pace_geojson::{document::CourseDocument, fold::fold, observe::Observation, packs};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Expected {
    entrant: String,
    standing: String,
    total_ms: Option<f64>,
    adjustment_ms: f64,
    awards: Vec<String>,
    laps: u32,
}

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    why: String,
    document: serde_json::Value,
    log: Vec<Observation>,
    expect: Vec<Expected>,
}

fn corpus() -> Vec<(String, Case)> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../corpus/conformance/*.json");
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
    // Nineteen today: eleven written by hand — the README's own race among
    // them — and eight generated on synthetic courses, the cut-off edge pair
    // among those. Fewer means a case went missing.
    assert!(
        corpus().len() >= 19,
        "the conformance corpus has at least nineteen cases"
    );
}

/// Every kind of every dialect this build ships is run by at least one case,
/// and `controls` both in order and in any order. A kind no case reaches is a
/// kind two engines can disagree on with nothing to say so.
#[test]
fn every_kind_is_reached_by_a_case() {
    let mut reached: Vec<String> = Vec::new();
    for (_path, case) in corpus() {
        for rule in case.document["pace:rules"].as_array().into_iter().flatten() {
            let (dialect, kind) = (
                rule["dialect"].as_str().unwrap_or(""),
                rule["kind"].as_str().unwrap_or(""),
            );
            reached.push(format!("{dialect} · {kind}"));
            if kind == "controls" {
                reached.push(format!("{dialect} · {kind} · in_order {}", rule["params"]["in_order"]));
            }
        }
    }
    let mut wanted: Vec<String> = packs::all()
        .iter()
        .flat_map(|pack| {
            pack.kinds
                .iter()
                .map(move |kind| format!("{} · {kind}", pack.dialect()))
        })
        .collect();
    wanted.push("orienteering@1 · controls · in_order true".into());
    wanted.push("orienteering@1 · controls · in_order false".into());
    let missing: Vec<&String> = wanted.iter().filter(|w| !reached.contains(w)).collect();
    assert!(missing.is_empty(), "no conformance case reaches {missing:?}");
    assert_eq!(wanted.len(), 13, "eleven kinds and the two orders of `controls`");
}

#[test]
fn every_case_agrees_with_the_reference() {
    let packs = packs::all();
    let mut checked = 0usize;

    for (path, case) in corpus() {
        let document: CourseDocument = serde_json::from_value(case.document.clone())
            .unwrap_or_else(|e| panic!("{path}: the document did not decode: {e}"));

        let rules = document
            .plan(&packs)
            .unwrap_or_else(|e| panic!("{}: did not plan — {e}", case.name));

        let states = fold(&rules, &case.log);

        // Every entrant the corpus names, and no others: an implementation that
        // invents a state, or loses one, fails here rather than later.
        let mut got: Vec<&str> = states.iter().map(|s| s.entrant.as_str()).collect();
        let mut want: Vec<&str> = case.expect.iter().map(|e| e.entrant.as_str()).collect();
        got.sort_unstable();
        want.sort_unstable();
        assert_eq!(got, want, "{}: the field is not the field ({})", case.name, case.why);

        for expected in &case.expect {
            let state = states
                .iter()
                .find(|s| s.entrant == expected.entrant)
                .unwrap_or_else(|| panic!("{}: {} missing", case.name, expected.entrant));

            let standing = serde_json::to_value(state.standing)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default();
            assert_eq!(
                standing, expected.standing,
                "{} · {} standing",
                case.name, expected.entrant
            );

            assert_eq!(
                state.total_ms(),
                expected.total_ms,
                "{} · {} total",
                case.name,
                expected.entrant
            );
            assert_eq!(
                state.adjustment_ms, expected.adjustment_ms,
                "{} · {} adjustment",
                case.name, expected.entrant
            );
            assert_eq!(
                state.awards, expected.awards,
                "{} · {} awards",
                case.name, expected.entrant
            );
            assert_eq!(state.laps, expected.laps, "{} · {} laps", case.name, expected.entrant);
            checked += 1;
        }
    }

    assert!(checked > 0, "the corpus asserted nothing");
    println!("{checked} entrant states across {} cases", corpus().len());
}
