//! What a document means, where the corpus cannot say it.
//!
//! The conformance corpus asserts the fold and the decode corpus the verdicts.
//! Three things fall between them: the sentence each kind generates (not
//! conformance — SPEC.md §3.4 — but it has to be true, and both engines have to
//! say it), the producer table on kinds a file can name and a map cannot hold,
//! and how `pace-geojson` is spelled.

use pace_geojson::document::{produces, CourseDocument, FORMAT_VERSION};
use pace_geojson::packs::{self, compile, DocumentRule};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Said {
    dialect: String,
    kind: String,
    at: serde_json::Value,
    params: serde_json::Value,
    sentence: String,
}

/// The table `ts/test/dialects.test.ts` reads too, so the two engines say the same words.
fn said() -> Vec<Said> {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../ts/test/support/sentences.json");
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path} did not decode: {e}"))
}

#[test]
fn every_kind_says_what_its_expansion_does() {
    let packs = packs::all();
    let rows = said();
    for pack in &packs {
        for kind in pack.kinds {
            assert!(
                rows.iter().any(|r| r.dialect == pack.dialect() && r.kind == *kind),
                "no sentence row for {} {kind}",
                pack.dialect()
            );
        }
    }
    for (i, row) in rows.iter().enumerate() {
        let rule: DocumentRule = serde_json::from_value(serde_json::json!({
            "id": format!("rul_{i}"),
            "dialect": row.dialect,
            "kind": row.kind,
            "ordinal": 0,
            "at": row.at,
            "params": row.params,
        }))
        .unwrap_or_else(|e| panic!("row {i}: {e}"));
        let (rules, refused) = compile(&packs, &[rule]);
        assert!(refused.is_empty(), "row {i}: {refused:?}");
        let sentences: Vec<&str> = rules.iter().map(|r| r.sentence.as_str()).collect();
        assert_eq!(
            sentences,
            vec![row.sentence.as_str()],
            "row {i}: {} {}",
            row.dialect,
            row.kind
        );
    }
}

#[test]
fn a_place_kind_is_looked_up_never_inherited() {
    // Free text in the file. The TypeScript engine once indexed an object
    // literal with it and answered these with Object.prototype's functions.
    for kind in [
        "constructor",
        "toString",
        "__proto__",
        "hasOwnProperty",
        "anything else",
    ] {
        assert_eq!(produces(kind), "passed", "{kind}");
    }
    assert_eq!(produces("control"), "punched");
}

fn base() -> serde_json::Value {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../corpus/decode/the-base-accepts.json");
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let case: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
    case["document"].clone()
}

fn with_version(text: &str) -> Result<CourseDocument, serde_json::Error> {
    let json = serde_json::to_string(&base()).expect("the base serialises");
    serde_json::from_str(&json.replacen("\"pace-geojson\":1", &format!("\"pace-geojson\":{text}"), 1))
}

#[test]
fn a_version_is_a_whole_number_from_one_however_it_is_spelled() {
    // `1.0` is the number 1 to every JSON reader; a `u32` field refused it.
    assert_eq!(with_version("1.0").expect("1.0 is 1").version, FORMAT_VERSION);
    assert_eq!(with_version("1").expect("1").version, FORMAT_VERSION);
    for bad in ["1.5", "0", "-1", "\"1\"", "1e300"] {
        assert!(with_version(bad).is_err(), "{bad} decoded as a version");
    }
    // The refusal names the member, as the file spells it.
    let why = with_version("1.5").expect_err("1.5 is no version").to_string();
    assert!(
        why.starts_with("`pace-geojson` is 1.5, and a format version is a whole number from 1"),
        "{why}"
    );
}

#[test]
fn a_version_this_build_does_not_run_draws_and_is_refused_by_name() {
    let later = with_version("2").expect("2 is a version");
    assert!(!later.points().is_empty(), "it still draws");
    let refused = later.plan(&packs::all()).expect_err("version 2 does not run here");
    assert_eq!(refused.unknown_version, Some(2));
    assert!(refused.broken.is_empty() && refused.refused.is_empty() && refused.missing_dialects.is_empty());
    assert!(with_version("1").expect("1").plan(&packs::all()).is_ok());
}
