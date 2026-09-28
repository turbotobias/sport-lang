//! The README's examples, run against this implementation.
//!
//! `examples/*/` is a document, a log and the standings the README prints. The
//! TypeScript test folds the same files and checks the README against them;
//! this makes every standing the README shows an answer both engines give.

use serde::Deserialize;
use sport_lang::{document::CourseDocument, fold::fold, observe::Observation, packs};

#[derive(Debug, Deserialize, PartialEq)]
struct Standing {
    entrant: String,
    standing: String,
    total_ms: Option<f64>,
    adjustment_ms: f64,
    awards: Vec<String>,
    laps: u32,
    sentences: Vec<String>,
}

fn read(dir: &std::path::Path, name: &str) -> String {
    let path = dir.join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"))
}

#[test]
fn every_example_folds_to_the_standings_it_shows() {
    let root = concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/*/document.json");
    let packs = packs::all();
    let mut checked = 0usize;

    for path in glob::glob(root)
        .expect("the examples path is a valid glob")
        .filter_map(Result::ok)
    {
        let dir = path.parent().expect("a document sits in a directory");
        let document: CourseDocument =
            serde_json::from_str(&read(dir, "document.json")).unwrap_or_else(|e| panic!("{dir:?}: document: {e}"));
        let log: Vec<Observation> =
            serde_json::from_str(&read(dir, "log.json")).unwrap_or_else(|e| panic!("{dir:?}: log: {e}"));
        let want: Vec<Standing> =
            serde_json::from_str(&read(dir, "standings.json")).unwrap_or_else(|e| panic!("{dir:?}: standings: {e}"));

        let rules = document
            .plan(&packs)
            .unwrap_or_else(|e| panic!("{dir:?}: did not plan — {e}"));
        let got: Vec<Standing> = fold(&rules, &log)
            .into_iter()
            .map(|state| Standing {
                standing: serde_json::to_value(state.standing)
                    .ok()
                    .and_then(|v| v.as_str().map(str::to_string))
                    .unwrap_or_default(),
                total_ms: state.total_ms(),
                adjustment_ms: state.adjustment_ms,
                awards: state.awards.clone(),
                laps: state.laps,
                sentences: state.applied.iter().map(|a| a.sentence.clone()).collect(),
                entrant: state.entrant,
            })
            .collect();

        assert_eq!(got, want, "{dir:?}: the fold is not what the README shows");
        checked += 1;
    }
    assert!(checked > 0, "no example was found under examples/");
}

/// `examples/quickstart.rs` ends with the lines it prints, and the README shows
/// that file whole — so those lines have to be what the fold says.
#[test]
fn the_quickstart_prints_what_it_says() {
    let said: Vec<&str> = include_str!("../examples/quickstart.rs")
        .lines()
        .skip_while(|line| !line.starts_with("// $ "))
        .skip(1)
        .map(|line| line.trim_start_matches("// "))
        .collect();
    assert!(!said.is_empty(), "the quick start ends with the output it prints");

    let dir = std::path::Path::new(concat!(env!("CARGO_MANIFEST_DIR"), "/../examples/10k"));
    let document: CourseDocument = serde_json::from_str(&read(dir, "document.json")).expect("the 10 km decodes");
    let log: Vec<Observation> = serde_json::from_str(&read(dir, "log.json")).expect("its log decodes");
    let rules = document.plan(&packs::all()).expect("the 10 km plans");

    let printed: Vec<String> = fold(&rules, &log)
        .iter()
        .map(|state| {
            let why: Vec<&str> = state.applied.iter().map(|a| a.sentence.as_str()).collect();
            format!("{} {:?} {:?} {why:?}", state.entrant, state.standing, state.total_ms())
        })
        .collect();
    assert_eq!(printed, said);
}
