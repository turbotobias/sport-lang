//! `athletics@1` — the road and the trail.
//!
//! The five rules road and trail racing use, said in the kernel.

use serde_json::Value;

use super::{all_of, b, costs, f, is, judged_at, not, place_name, s, span, Expansion, Pack};
use crate::kernel::{Atom, ClockMeasure, Cmp, Consequence, ObservationKind, Standing, Where};

fn elapsed(cmp: Cmp, value_ms: f64) -> Atom {
    Atom::Clock {
        measure: ClockMeasure::Elapsed,
        cmp,
        value_ms: Some(value_ms),
        value_at: None,
        from: None,
        to: None,
    }
}

pub fn pack() -> Pack {
    Pack {
        name: "athletics",
        version: 1,
        modes: &["run", "hike"],
        kinds: &[
            "cutoff_at",
            "cutoff_within",
            "qualifies_within",
            "station_required",
            "no_outside_help",
        ],
        placed: &["qualifies_within", "station_required"],
        compile,
    }
}

fn compile(kind: &str, params: &Value, at: &Option<Where>) -> Option<Expansion> {
    match kind {
        // The wall-clock gate: be here by this time or the day ends.
        "cutoff_at" => {
            // An instant, or the parameters do not fit — never 1970.
            let when_at = s(params, "at")?.parse::<crate::observe::Instant>().ok()?;
            let says = s(params, "says")?;
            Some(Expansion {
                when: all_of(vec![is(Atom::Clock {
                    measure: ClockMeasure::Wall,
                    cmp: Cmp::Gt,
                    value_ms: None,
                    value_at: Some(when_at),
                    from: None,
                    to: None,
                })]),
                then: Consequence::SetStanding {
                    standing: Standing::Gated,
                    reason: "cutoff".into(),
                },
                sentence: format!("The day ends for anyone reaching {} after {says}.", judged_at(at)),
            })
        }

        // The elapsed gate: finish inside this or the day ends.
        "cutoff_within" => {
            let within = f(params, "within_ms")?;
            Some(Expansion {
                when: all_of(vec![is(elapsed(Cmp::Gt, within))]),
                then: Consequence::SetStanding {
                    standing: Standing::Gated,
                    reason: "over time".into(),
                },
                sentence: format!("The day ends for anyone still out after {}.", span(within)),
            })
        }

        // Finish inside this and a ballot opens. *Finish* is a clause of its
        // own, and it is the finish the rule is bound to: a `finished` at that
        // place. On elapsed alone a runner still out, or one who withdrew,
        // held the award; on any `finished`, a runner who stopped after two
        // laps of four held it, because every lap line produces one.
        "qualifies_within" => {
            let Some(Where::At(place)) = at else { return None };
            let within = f(params, "within_ms")?;
            let award = s(params, "award")?;
            Some(Expansion {
                when: all_of(vec![
                    is(Atom::Observed {
                        at: place.clone(),
                        kind: ObservationKind::Finished,
                    }),
                    is(elapsed(Cmp::Lte, within)),
                ]),
                then: Consequence::Award { name: award.clone() },
                sentence: format!("Finishing inside {} qualifies for {award}.", span(within)),
            })
        }

        // A station that was not punched — stated as *not observed here*, which
        // is the honest shape: a checkpoint nobody recorded you at is one you
        // did not visit, and the runner whose chip failed is a protest rather
        // than a special case in the language.
        //
        // `each_time` multiplies by the matches of the rule's one `observed`
        // clause (SPEC.md §3.2, *occurrences*), and that clause fires precisely
        // when it matched nothing — so with `each_time: true` the rule is
        // recorded and adds nothing. The sentence says so.
        "station_required" => {
            let Some(Where::At(place)) = at else { return None };
            let penalty = f(params, "penalty_ms")?;
            let each_time = b(params, "each_time")?;
            Some(Expansion {
                when: all_of(vec![not(Atom::Observed {
                    at: place.clone(),
                    kind: ObservationKind::Punched,
                })]),
                then: Consequence::AdjustTime {
                    by_ms: penalty,
                    each_time,
                },
                sentence: if each_time {
                    format!(
                        "Missing {} is recorded and adds nothing: each_time counts the punches there, and a miss has none.",
                        place_name(place)
                    )
                } else {
                    format!("Missing {} {}.", place_name(place), costs(penalty))
                },
            })
        }

        // Outside assistance, as an official declares it.
        "no_outside_help" => Some(Expansion {
            when: all_of(vec![is(Atom::Flag {
                name: "outside_help".into(),
            })]),
            then: Consequence::SetStanding {
                standing: Standing::Disqualified,
                reason: "outside help".into(),
            },
            sentence: "Taking outside assistance ends the day.".into(),
        }),

        _ => None,
    }
}
