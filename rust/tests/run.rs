//! The one call a host makes, and the JSON it answers in.
//!
//! The answer is the wire between this engine and everything else — the
//! WebAssembly build returns exactly these bytes — so it is pinned here as
//! JSON, the way a consumer reads it, and not as Rust values.

use pace_geojson::{packs, run::run};
use serde_json::{json, Value};

fn read(path: &str) -> String {
    let path = format!("{}/../{path}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn answer(document: &str, log: &str) -> Value {
    serde_json::to_value(run(&packs::all(), document, log)).expect("an answer serialises")
}

fn the_10k() -> (Value, Value) {
    (
        serde_json::from_str(&read("examples/10k/document.json")).expect("a document"),
        serde_json::from_str(&read("examples/10k/log.json")).expect("a log"),
    )
}

#[test]
fn a_run_says_who_finished_who_did_not_and_why() {
    let (document, log) = the_10k();
    let text = serde_json::to_string(&run(&packs::all(), &document.to_string(), &log.to_string())).expect("json");
    // Whole milliseconds are written as the corpus writes them: `2790000`,
    // never `2790000.0`.
    assert!(!text.contains(".0,") && !text.contains(".0}"), "{text}");
    let value: Value = serde_json::from_str(&text).expect("json");
    assert_eq!(value["kind"], "ran");
    let ana = &value["states"][0];
    assert_eq!(ana["entrant"], "ent_ana");
    assert_eq!(ana["total_ms"], json!(2_790_000));
    assert_eq!(ana["started_at"], "2027-05-02T07:00:00.000Z");
    assert!(ana["finished_at"].is_string(), "a finisher has a finish");
    assert_eq!(ana["withdrew"], false);
    assert_eq!(ana["awards"], json!(["sub-50"]));
    // Every member a consumer needs to tell a finisher from a non-finisher,
    // and to say why a penalty is there.
    for member in [
        "entrant",
        "standing",
        "started_at",
        "finished_at",
        "withdrew",
        "total_ms",
        "adjustment_ms",
        "neutralised_ms",
        "laps",
        "punches",
        "awards",
        "classes",
        "applied",
    ] {
        assert!(ana.get(member).is_some(), "no {member}");
    }
    let cy = value["states"]
        .as_array()
        .expect("states")
        .iter()
        .find(|s| s["entrant"] == "ent_cy")
        .expect("ent_cy");
    assert_eq!(cy["applied"][0]["id_rule"], "rul_station");
    assert_eq!(cy["applied"][0]["sentence"], "Missing km-5 costs 2:00.");
}

#[test]
fn a_refusal_is_data_naming_the_rule_and_the_reason() {
    // It used to be a Debug string: `not runnable: [] missing, 1 refused, []
    // broken`, with no rule id in it.
    let (mut document, log) = the_10k();
    document["pace:rules"][1]["at"] = Value::Null;
    document["pace:rules"][0]["params"]["at"] = json!("2027-05-02T09:40:00+02:00");
    let value = answer(&document.to_string(), &log.to_string());
    assert_eq!(value["kind"], "refused");
    assert_eq!(
        value["why"],
        json!({
            "unknown_version": null,
            "missing_dialects": [],
            "refused": [
                { "id": "rul_gate", "dialect": "athletics@1", "kind": "cutoff_at", "why": "parameters do not fit" },
                { "id": "rul_station", "dialect": "athletics@1", "kind": "station_required", "why": "needs a place" },
            ],
            "broken": [],
        })
    );
}

#[test]
fn a_broken_law_is_named_with_what_broke_it() {
    let (mut document, log) = the_10k();
    document["features"][2]["properties"]["kind"] = json!("aid");
    let value = answer(&document.to_string(), &log.to_string());
    assert_eq!(value["kind"], "refused");
    assert_eq!(
        value["why"]["broken"],
        json!([{
            "law": "a rule requires an observation the place never produces",
            "what": "rul_station wants punched at km-5, a aid which produces passed",
        }])
    );
}

#[test]
fn a_log_that_is_not_one_is_malformed_never_run() {
    let (document, log) = the_10k();
    for bad in ["not a time", "2027-05-02T09:00:00+02:00"] {
        let mut broken = log.clone();
        broken[0]["t"] = json!(bad);
        let value = answer(&document.to_string(), &broken.to_string());
        assert_eq!(value["kind"], "malformed", "{bad}");
        assert_eq!(value["broken"], json!([]));
    }
    let mut twice = log.clone();
    let first = twice[0].clone();
    twice.as_array_mut().expect("an array").push(first);
    let value = answer(&document.to_string(), &twice.to_string());
    assert_eq!(value["kind"], "malformed");
    assert_eq!(
        value["broken"],
        json!([{ "law": "an observation id is used twice", "what": log[0]["id"] }])
    );
}
