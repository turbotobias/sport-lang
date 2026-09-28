//! The properties the specification states, checked here rather than inherited.
//!
//! The corpus pins *answers*. These pin the *rules about answers* — the things
//! §3 says must be true of any implementation, which a corpus can only imply.
//! They are written against the same JSON files so a failure names a real
//! disagreement rather than a difference of fixtures.

use sport_lang::{
    document::CourseDocument,
    fold::{by_entrant, fold, fold_until},
    kernel::{Aggregate, Atom, Clause, Cmp, Combine, Consequence, KernelRule, Predicate, Standing},
    observe::{broken_log_laws, settle, Instant, Observation},
    packs,
};

fn case(name: &str) -> (CourseDocument, Vec<Observation>) {
    let path = format!("{}/../corpus/conformance/{name}.json", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let value: serde_json::Value = serde_json::from_str(&text).expect("valid json");
    (
        serde_json::from_value(value["document"].clone()).expect("a document"),
        serde_json::from_value(value["log"].clone()).expect("a log"),
    )
}

#[test]
fn scrubbing_to_the_end_is_the_race() {
    // §3.1: the state at t IS the fold over the prefix. Not an approximation —
    // so the end of the scrub and the end of the race are the same object.
    let (document, log) = case("marathon-cutoff-cuts-the-tail");
    let rules = document.plan(&packs::all()).expect("runnable");
    let last = settle(&log).last().map(|o| o.epoch_ms()).expect("a log");
    assert_eq!(fold_until(&rules, &log, last), fold(&rules, &log));
}

#[test]
fn a_standing_only_ever_worsens_as_time_runs() {
    // The property that found the dormancy gap in the reference. A rule bound
    // to a place cannot judge somebody who has not reached it, or every
    // negative predicate fires on the whole field in the first minute.
    let (document, log) = case("station-required-with-dropped-reads");
    let rules = document.plan(&packs::all()).expect("runnable");
    let ordered = settle(&log);
    let from = ordered.first().map(|o| o.epoch_ms()).expect("a log");
    let to = ordered.last().map(|o| o.epoch_ms()).expect("a log");

    let mut previous = fold_until(&rules, &log, from);
    for step in 1..=10 {
        let at = from + (to - from) * step / 10;
        let now = fold_until(&rules, &log, at);
        for state in &now {
            if let Some(was) = previous.iter().find(|s| s.entrant == state.entrant) {
                assert!(
                    state.standing >= was.standing,
                    "{} got better: {:?} → {:?}",
                    state.entrant,
                    was.standing,
                    state.standing
                );
            }
        }
        previous = now;
    }
}

#[test]
fn the_logs_arrival_order_cannot_change_the_result() {
    // §3.1: settle sorts by instant then by id, so two mats stamping the same
    // millisecond cannot make the answer depend on what a database returned
    // first.
    let (document, log) = case("backyard-five-laps-corralled-hourly");
    let rules = document.plan(&packs::all()).expect("runnable");
    let forwards = fold(&rules, &log);
    let mut shuffled = log.clone();
    shuffled.reverse();
    assert_eq!(fold(&rules, &shuffled), forwards);
}

#[test]
fn a_correction_supersedes_rather_than_edits() {
    let (document, log) = case("orienteering-order-and-correction");
    let rules = document.plan(&packs::all()).expect("runnable");
    let states = fold(&rules, &log);
    // The mispunch was withdrawn by a superseding observation, so the runner is
    // clean — which is only true if `supersedes` was honoured.
    let z = states.iter().find(|s| s.entrant == "ent_z").expect("ent_z");
    assert_eq!(z.standing, Standing::Clean);
}

#[test]
fn an_unknown_dialect_is_refused_by_name() {
    // §3.3: two outcomes and no third. Running what you understood is how a
    // timing system disqualifies the wrong person.
    let (mut document, _) = case("marathon-cutoff-cuts-the-tail");
    document.dialects.push("curling@1".to_string());
    let refused = document.plan(&packs::all()).expect_err("must refuse");
    assert_eq!(refused.missing_dialects, vec!["curling@1".to_string()]);
}

fn ms(text: &str) -> i64 {
    Instant::parse(text).unwrap_or_else(|e| panic!("{e}")).epoch_ms()
}

#[test]
fn instants_parse_to_the_millisecond() {
    // The whole language's arithmetic rests on this, and it is hand-written
    // rather than pulled in — so it is checked against figures that do not
    // depend on it.
    assert_eq!(ms("1970-01-01T00:00:00.000Z"), 0);
    assert_eq!(ms("1970-01-02T00:00:00.000Z"), 86_400_000);
    // The same figure V8 gives for `Date.parse`, which is an implementation
    // that shares nothing with this one.
    assert_eq!(ms("2027-06-19T08:00:00.000Z"), 1_813_392_000_000);
    assert_eq!(ms("2027-06-19T08:00:00Z"), 1_813_392_000_000);
    // A leap year, and the day after it.
    assert_eq!(
        ms("2028-03-01T00:00:00.000Z") - ms("2028-02-29T00:00:00.000Z"),
        86_400_000
    );
    assert_eq!(ms("2027-06-19T08:00:00.310Z") - ms("2027-06-19T08:00:00.000Z"), 310);
    assert_eq!(ms("0000-01-01T00:00:00.000Z"), -62_167_219_200_000);
}

#[test]
fn an_instant_is_one_shape_and_nothing_else_is_one() {
    // §2.3. This parser used to answer 0 — 1970 — for text it could not read,
    // and read an offset as UTC, so a malformed log ran with every total wrong.
    for text in [
        "not a time",
        "",
        "2027-06-01T07:50:00+02:00",
        "2027-06-01T07:50:00.000+00:00",
        "2027-06-01T07:50:00",
        "2027-06-01 07:50:00Z",
        "2027-06-01T07:50:00.5Z",
        "2027-06-01T07:50:00.0000Z",
        "2027-02-29T00:00:00Z",
        "2027-02-30T00:00:00Z",
        "2027-13-01T00:00:00Z",
        "2027-00-01T00:00:00Z",
        "2027-06-00T00:00:00Z",
        "2027-06-01T24:00:00Z",
        "2027-06-01T23:60:00Z",
        "2027-06-01T23:59:60Z",
        "+2027-06-01T00:00:00Z",
        "２０２７-06-01T00:00:00Z",
    ] {
        assert!(Instant::parse(text).is_err(), "{text:?} read as an instant");
        let quoted = serde_json::to_string(text).expect("a string");
        assert!(serde_json::from_str::<Instant>(&quoted).is_err(), "{text:?} decoded");
    }
}

#[test]
fn an_instant_writes_back_in_the_one_shape_it_reads() {
    for (read, written) in [
        ("2027-06-19T08:00:00Z", "2027-06-19T08:00:00.000Z"),
        ("2027-06-19T08:00:00.310Z", "2027-06-19T08:00:00.310Z"),
        ("2028-02-29T23:59:59.999Z", "2028-02-29T23:59:59.999Z"),
        ("1969-12-31T23:59:59.999Z", "1969-12-31T23:59:59.999Z"),
        ("0000-01-01T00:00:00.000Z", "0000-01-01T00:00:00.000Z"),
    ] {
        let instant = Instant::parse(read).expect("an instant");
        assert_eq!(instant.to_string(), written);
        assert_eq!(Instant::from_epoch_ms(instant.epoch_ms()), instant);
        assert_eq!(serde_json::to_string(&instant).expect("json"), format!("\"{written}\""));
    }
}

#[test]
fn a_log_with_an_offset_or_a_garbage_instant_does_not_decode() {
    let (_, log) = case("station-required-with-dropped-reads");
    let mut value = serde_json::to_value(&log).expect("a log");
    for bad in ["not a time", "2027-06-21T18:30:00+02:00"] {
        value[0]["t"] = serde_json::Value::String(bad.to_string());
        assert!(
            serde_json::from_value::<Vec<Observation>>(value.clone()).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn an_id_used_twice_is_a_broken_log_law() {
    // Two rows with one id: a stable sort keeps them as they arrived, so the
    // result depends on arrival order, and a correction naming the id removes
    // both. The fold stays total; the law says the log is not one.
    let (document, log) = case("orienteering-order-and-correction");
    assert!(broken_log_laws(&log).is_empty(), "the corpus log is lawful");
    let rules = document.plan(&packs::all()).expect("runnable");
    let mut twice = log.clone();
    let mut copy = twice[1].clone();
    copy.id = twice[0].id.clone();
    twice.push(copy.clone());
    twice.push(copy);
    let broken = broken_log_laws(&twice);
    assert_eq!(broken.len(), 1, "one id, named once however often it repeats");
    assert_eq!(broken[0].law, "an observation id is used twice");
    assert_eq!(broken[0].what, log[0].id);
    // And the fold is still an answer, not a panic.
    assert_eq!(fold(&rules, &twice).len(), fold(&rules, &log).len());
}

#[test]
fn the_partition_is_the_filter_it_replaced() {
    // §3.1: entrants in order of first appearance, each with their own
    // observations in settled order. Partitioning once must be exactly what
    // filtering the whole log per entrant was, or the speed changed an answer.
    let (document, log) = case("ultra-wide-field-eight-hour-cutoff");
    let rules = document.plan(&packs::all()).expect("runnable");
    let ordered = settle(&log);
    let mut first_seen: Vec<String> = Vec::new();
    for o in &ordered {
        if !first_seen.contains(&o.entrant) {
            first_seen.push(o.entrant.clone());
        }
    }
    let groups = by_entrant(ordered.clone());
    assert_eq!(groups.iter().map(|(e, _)| e.clone()).collect::<Vec<_>>(), first_seen);
    for (entrant, seen) in &groups {
        let filtered: Vec<Observation> = ordered.iter().filter(|o| o.entrant == *entrant).cloned().collect();
        assert_eq!(*seen, filtered, "{entrant}");
    }
    let states = fold(&rules, &log);
    assert_eq!(
        states.iter().map(|s| s.seen.clone()).collect::<Vec<_>>(),
        groups.into_iter().map(|(_, seen)| seen).collect::<Vec<_>>()
    );
}

#[test]
fn rank_is_the_finishers_by_total() {
    // No dialect reaches `rank` yet, so no conformance case does: pinned here.
    let (document, log) = case("marathon-cutoff-cuts-the-tail");
    let mut rules = document.plan(&packs::all()).expect("runnable");
    rules.push(KernelRule {
        id: "rul_podium".to_string(),
        dialect: "test@1".to_string(),
        kind: "podium".to_string(),
        ordinal: 99.0,
        at: None,
        when: Predicate {
            combine: Combine::All,
            clauses: vec![Clause {
                negated: false,
                atom: Atom::Field {
                    aggregate: Aggregate::Rank,
                    cmp: Cmp::Lte,
                    value: 3.0,
                    ratio: None,
                },
            }],
        },
        then: Consequence::Award {
            name: "podium".to_string(),
        },
        sentence: "The three fastest totals take the podium.".to_string(),
        stratum: 1,
    });
    let states = fold(&rules, &log);
    let mut totals: Vec<(String, f64)> = states
        .iter()
        .filter(|s| s.finished_at.is_some() && s.standing != Standing::Disqualified)
        .filter_map(|s| s.total_ms().map(|t| (s.entrant.clone(), t)))
        .collect();
    totals.sort_by(|a, b| a.1.total_cmp(&b.1));
    let mut expected: Vec<String> = totals.into_iter().take(3).map(|(e, _)| e).collect();
    expected.sort();
    let mut awarded: Vec<String> = states
        .iter()
        .filter(|s| s.awards.iter().any(|a| a == "podium"))
        .map(|s| s.entrant.clone())
        .collect();
    awarded.sort();
    assert_eq!(expected.len(), 3);
    assert_eq!(awarded, expected);
}
