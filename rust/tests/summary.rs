//! The summary corpus, read by this implementation.
//!
//! `corpus/summary/*.json` is a document and the summary the TypeScript
//! reference reads off it. This engine must read the same: the length, the
//! measure, the ground and the places exactly, and every height to the tenth
//! of a metre it is written to — two runtimes' sines may round one height the
//! other way across a tenth, and never further.
//!
//! Nothing here is shared with the reference beyond the JSON files themselves.

use pace_geojson::document::CourseDocument;
use serde::Deserialize;
use serde_json::Value;

#[derive(Debug, Deserialize)]
struct Case {
    name: String,
    steps: usize,
    document: Value,
    expect: Value,
}

fn corpus() -> Vec<Case> {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../corpus/summary/*.json");
    let mut cases: Vec<Case> = glob::glob(root)
        .expect("the corpus path is a valid glob")
        .filter_map(Result::ok)
        .map(|path| {
            let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
            serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path:?} did not decode: {e}"))
        })
        .collect();
    cases.sort_by(|a, b| a.name.cmp(&b.name));
    cases
}

/// Two JSON values alike, a number compared by its value and not by how it was written.
fn same(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Number(x), Value::Number(y)) => x.as_f64() == y.as_f64(),
        (Value::Array(x), Value::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(p, q)| same(p, q)),
        (Value::Object(x), Value::Object(y)) => {
            x.len() == y.len()
                && x.iter()
                    .all(|(key, value)| y.get(key).is_some_and(|other| same(value, other)))
        }
        _ => a == b,
    }
}

#[test]
fn the_corpus_has_its_eight_cases() {
    assert_eq!(corpus().len(), 8);
}

#[test]
fn every_summary_is_the_references() {
    for case in corpus() {
        let document: CourseDocument = serde_json::from_value(case.document)
            .unwrap_or_else(|e| panic!("{}: the document did not decode: {e}", case.name));
        let said = serde_json::to_value(document.summary(case.steps)).expect("a summary is JSON");
        let name = &case.name;

        // Everything but the heights, exactly: a number as a number, so 21326
        // read from the file is 21326.0 written by this engine.
        for member in ["length_m", "stated_m", "ascent_m", "descent_m", "ground", "places"] {
            assert!(
                same(&said[member], &case.expect[member]),
                "{name}: {member}: {} against {}",
                said[member],
                case.expect[member]
            );
        }

        // The heights, to the tenth they are written to.
        let expected: Vec<f64> = case.expect["heights"]
            .as_array()
            .expect("heights are rows")
            .iter()
            .flat_map(|row| {
                row.as_array()
                    .expect("a row is numbers")
                    .iter()
                    .map(|h| h.as_f64().expect("a height"))
            })
            .collect();
        let heights: Vec<f64> = said["heights"]
            .as_array()
            .expect("heights")
            .iter()
            .map(|h| h.as_f64().expect("a height"))
            .collect();
        assert_eq!(heights.len(), expected.len(), "{name}: how many heights");
        for (step, (height, reference)) in heights.iter().zip(&expected).enumerate() {
            assert!(
                (height - reference).abs() <= 0.1 + 1e-9,
                "{name}: step {step} is {height}, the reference {reference}"
            );
        }
    }
}
