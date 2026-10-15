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

/// Three ways to write a version twice, and a parser that keeps the last would
/// run the first and the third and refuse the second. All three are one thing.
#[test]
fn a_document_naming_a_member_twice_is_malformed_whichever_value_it_would_have_kept() {
    let document = read("examples/10k/document.json");
    let log = read("examples/10k/log.json");
    for versions in [
        r#"1, "pace-geojson": 1"#,
        r#"1, "pace-geojson": 2"#,
        r#"2, "pace-geojson": 1"#,
    ] {
        let twice = document.replace(r#""pace-geojson": 1"#, &format!(r#""pace-geojson": {versions}"#));
        assert_ne!(twice, document);
        assert_eq!(
            answer(&twice, &log),
            json!({
                "kind": "malformed",
                "why": r#"the document did not decode: a member is named twice: "pace-geojson", line 3"#,
                "broken": [],
            }),
            "{versions}"
        );
    }
}

/// Where serde alone said nothing: a member no field reads, and a rule's
/// parameters, which are kept as a `Value` until a dialect reads them.
#[test]
fn it_is_malformed_in_a_member_nothing_reads_and_in_a_rules_parameters() {
    use pace_geojson::document::CourseDocument;

    let document = read("examples/10k/document.json");
    let log = read("examples/10k/log.json");
    let why = |document: &str| answer(document, &log)["why"].as_str().unwrap_or_default().to_string();

    let foreign = document.replacen('{', r#"{"x:note": 1, "x:note": 2,"#, 1);
    assert_eq!(
        why(&foreign),
        r#"the document did not decode: a member is named twice: "x:note", line 1"#
    );
    let param = document.replace(r#""penalty_ms": 120000"#, r#""penalty_ms": 120000, "penalty_ms": 1"#);
    assert_ne!(param, document);
    assert!(
        why(&param).contains(r#"a member is named twice: "penalty_ms""#),
        "{}",
        why(&param)
    );
    // And serde alone, on the same two texts, reads both: the law is the text's.
    assert!(serde_json::from_str::<CourseDocument>(&foreign).is_ok());
    assert!(serde_json::from_str::<CourseDocument>(&param).is_ok());
}

#[test]
fn a_log_that_names_a_member_twice_is_malformed_and_says_it_is_the_log() {
    let document = read("examples/10k/document.json");
    let log = read("examples/10k/log.json");
    let twice = log.replacen(
        r#""entrant": "ent_ana""#,
        r#""entrant": "ent_ana", "entrant": "ent_ben""#,
        1,
    );
    assert_ne!(twice, log);
    assert_eq!(
        answer(&document, &twice),
        json!({
            "kind": "malformed",
            "why": r#"the log did not decode: a member is named twice: "entrant", line 4"#,
            "broken": [],
        })
    );
    let half = log.replacen(r#""ent_ana""#, r#""ent_\ud83d""#, 1);
    let why = answer(&document, &half)["why"].as_str().unwrap_or_default().to_string();
    assert!(why.contains("a string holds half a surrogate pair"), "{why}");
}

/// A number is the double nearest to what is written (SPEC.md §1), each way a
/// number comes in: a rule's parameter, kept as a `Value` until its dialect
/// reads it, and a member serde reads straight into an `f64`.
///
/// `serde_json` reads the nearest double only when built with
/// `float_roundtrip`, which the workspace asks for. Without it the penalty
/// below is 730.6517261421847, the wetsuit is clean in water over the limit,
/// and the largest double is a file that is not one.
#[test]
fn a_decimal_longer_than_a_double_is_the_nearest_double() {
    let document = read("examples/10k/document.json");
    let log = read("examples/10k/log.json");
    let edit = |text: &str, was: &str, now: &str| {
        let edited = text.replacen(was, now, 1);
        assert_ne!(edited, text, "{was}");
        edited
    };
    let of = |answer: &Value, entrant: &str, member: &str| {
        answer["states"]
            .as_array()
            .unwrap_or_else(|| panic!("no states: {answer}"))
            .iter()
            .find(|s| s["entrant"] == entrant)
            .unwrap_or_else(|| panic!("no {entrant}"))[member]
            .clone()
    };

    // A parameter, written back in the answer.
    let long = edit(
        &document,
        r#""penalty_ms": 120000"#,
        r#""penalty_ms": 730.65172614218456"#,
    );
    assert_eq!(
        of(&answer(&long, &log), "ent_cy", "adjustment_ms").to_string(),
        "730.6517261421845"
    );

    // A measurement held against its limit. The next double above 22.5 is
    // 22.500000000000004; water written between the two is the nearer one, a
    // tie is the even one — 22.5 — and only over the limit disqualifies.
    // The temperature is written into the text afterwards, in place of a
    // number no other member holds: a `Value` would keep only its double.
    let (mut wetsuit, mut worn) = the_10k();
    wetsuit["pace:rules"][2] = json!({
        "id": "rul_wetsuit",
        "dialect": "triathlon@1",
        "kind": "wetsuit_limit",
        "ordinal": 2,
        "at": null,
        "params": { "max_c": 22.5 },
    });
    worn[0]["quantity_name"] = json!("water_c");
    worn[0]["quantity_value"] = json!(987_654_321);
    worn[0]["flags"] = json!(["wetsuit"]);
    let (wetsuit, worn) = (wetsuit.to_string(), worn.to_string());
    let water = |value: &str| {
        of(
            &answer(&wetsuit, &edit(&worn, "987654321", value)),
            "ent_ana",
            "standing",
        )
    };
    for (value, standing) in [
        ("22.5", "clean"),
        ("22.500000000000001549", "clean"),
        ("22.5000000000000017763568394002504646778106689453125", "clean"),
        ("22.5000000000000017763568394002504646778106689453126", "disqualified"),
        ("22.500000000000002", "disqualified"),
        ("22.500000000000004", "disqualified"),
    ] {
        assert_eq!(water(value), standing, "water at {value}");
    }

    // The largest double, written with more digits than it has, is the
    // largest double; half a step past it there is none to be nearest to.
    for largest in ["1.7976931348623158e308", "1.79769313486231580793e308"] {
        let as_member = edit(
            &document,
            r#""distance_m": 10000"#,
            &format!(r#""distance_m": {largest}"#),
        );
        assert_eq!(answer(&as_member, &log)["kind"], "ran", "distance_m {largest}");
        let as_kept = edit(
            &document,
            r#""params": {"#,
            &format!(r#""params": {{"x:f": {largest}, "#),
        );
        assert_eq!(
            answer(&as_kept, &log),
            answer(&document, &log),
            "a foreign parameter {largest}"
        );
    }
    let past = edit(
        &document,
        r#""distance_m": 10000"#,
        r#""distance_m": 1.79769313486231580794e308"#,
    );
    assert_eq!(answer(&past, &log)["kind"], "malformed");
}
