//! `triathlon@1` — zones, and things measured rather than timed.
//!
//! Here because it needs two parts of the kernel nothing else does: a **span**
//! of the course with its own rules while you are inside it, and a **quantity**
//! that decides whether a rule applies at all.

use serde_json::Value;

use super::{all_of, costs, f, is, not, place, span, Expansion, Pack};
use crate::kernel::{Atom, ClockMeasure, Cmp, Consequence, ObservationKind, Standing, Where};

pub fn pack() -> Pack {
    Pack {
        name: "triathlon",
        version: 1,
        modes: &["swim", "ride", "run", "transition"],
        kinds: &["drafting", "wetsuit_limit", "transition_neutral"],
        placed: &[],
        compile,
    }
}

fn compile(kind: &str, params: &Value, _at: &Option<Where>) -> Option<Expansion> {
    match kind {
        // Not overtaking is a flag rather than a measurement, because it is a
        // judgement a referee makes on a motorbike and the bridge's job is to
        // carry it as one. The language never has to model a bicycle.
        //
        // Once per fold, whatever `each_time` says: the predicate has no
        // `observed` clause, so there are no occurrences to multiply by and
        // §3.2 counts one. The time through the zone is one split — the first
        // read entering to the first read leaving — so a second pass is not a
        // second offence. The sentence says what this kind does.
        "drafting" => {
            let seconds = f(params, "seconds_ms")?;
            let penalty = f(params, "penalty_ms")?;
            let from_m = f(params, "from_m")?;
            let to_m = f(params, "to_m")?;
            Some(Expansion {
                when: all_of(vec![
                    is(Atom::Clock {
                        measure: ClockMeasure::Split,
                        cmp: Cmp::Gt,
                        value_ms: Some(seconds),
                        value_at: None,
                        from: Some(place("draft-zone-enter", from_m)),
                        to: Some(place("draft-zone-leave", to_m)),
                    }),
                    not(Atom::Flag {
                        name: "overtaking".into(),
                    }),
                ]),
                then: Consequence::AdjustTime {
                    by_ms: penalty,
                    each_time: true,
                },
                sentence: format!(
                    "Taking more than {} through the draft zone without an overtaking flag {}, once.",
                    span(seconds),
                    costs(penalty)
                ),
            })
        }

        // Measured, not declared — and a measurement nobody took is false
        // (SPEC.md §3.2), so with no water temperature in the log it never fires.
        "wetsuit_limit" => {
            let max_c = f(params, "max_c")?;
            Some(Expansion {
                when: all_of(vec![
                    is(Atom::Quantity {
                        name: "water_c".into(),
                        cmp: Cmp::Gt,
                        value: max_c,
                    }),
                    is(Atom::Flag { name: "wetsuit".into() }),
                ]),
                then: Consequence::SetStanding {
                    standing: Standing::Disqualified,
                    reason: "wetsuit above the legal temperature".into(),
                },
                sentence: format!("A wetsuit disqualifies when the last water temperature taken is above {max_c} °C."),
            })
        }

        "transition_neutral" => {
            let from_m = f(params, "from_m")?;
            let to_m = f(params, "to_m")?;
            Some(Expansion {
                when: all_of(vec![is(Atom::Observed {
                    at: place("transition-in", from_m),
                    kind: ObservationKind::Entered,
                })]),
                then: Consequence::Neutralise {
                    from: place("transition-in", from_m),
                    to: place("transition-out", to_m),
                },
                sentence: "The clock stops from transition-in to transition-out.".into(),
            })
        }

        _ => None,
    }
}
