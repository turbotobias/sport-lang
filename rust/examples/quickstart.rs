//! The README's 10 km, folded. From the repository root: `cargo run --example quickstart`.
use pace_geojson::{document::CourseDocument, fold::fold, observe::Observation, packs};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let document: CourseDocument = serde_json::from_str(&std::fs::read_to_string("examples/10k/document.json")?)?;
    let log: Vec<Observation> = serde_json::from_str(&std::fs::read_to_string("examples/10k/log.json")?)?;

    // Two outcomes and no third: the rules to run, or every reason the document cannot be run.
    let rules = document.plan(&packs::all())?;

    for state in fold(&rules, &log) {
        let why: Vec<&str> = state.applied.iter().map(|a| a.sentence.as_str()).collect();
        println!("{} {:?} {:?} {why:?}", state.entrant, state.standing, state.total_ms());
    }
    Ok(())
}

// $ cargo run --example quickstart
// ent_ana Clean Some(2790000.0) ["Finishing inside 50:00 qualifies for sub-50."]
// ent_ben Gated Some(5100000.0) ["The day ends for anyone reaching km-5 after 07:40."]
// ent_cy Penalised Some(3240000.0) ["Missing km-5 costs 2:00."]
// ent_dee Clean Some(2880000.0) ["Finishing inside 50:00 qualifies for sub-50."]
// ent_eve Disqualified Some(3300000.0) ["Taking outside assistance ends the day."]
