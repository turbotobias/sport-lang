//! `backyard@1` — a lap every hour, until one is left.
//!
//! Here as the hardest case for the design rather than the most common. Two
//! things make it expressible without touching the kernel: a lap is a *place*
//! rather than a repetition, so lap 3's finish sits three loops along; and
//! last-one-standing is a `field` predicate, so it lands in stratum 1.

use serde_json::Value;

use super::{all_of, f, is, not, place, s, span, Expansion, Pack};
use crate::kernel::{Aggregate, Atom, ClockMeasure, Cmp, Consequence, Standing, Where};

/// The largest whole number every JSON reader holds exactly (2^53 − 1).
const MAX_SAFE: f64 = 9_007_199_254_740_991.0;

pub fn pack() -> Pack {
    Pack {
        name: "backyard",
        version: 1,
        modes: &["run"],
        kinds: &["lap_within", "last_standing"],
        placed: &[],
        compile,
    }
}

fn compile(kind: &str, params: &Value, _at: &Option<Where>) -> Option<Expansion> {
    match kind {
        "lap_within" => {
            let within = f(params, "within_ms")?;
            let from_m = f(params, "from_m")?;
            let to_m = f(params, "to_m")?;
            // A whole number from 1, or the parameters do not fit: the lap
            // names its two places, and `lap-1.5-start` is no lap's.
            let lap = f(params, "lap").filter(|n| n.fract() == 0.0 && *n >= 1.0 && *n <= MAX_SAFE)? as i64;
            Some(Expansion {
                when: all_of(vec![is(Atom::Clock {
                    measure: ClockMeasure::Split,
                    cmp: Cmp::Gt,
                    value_ms: Some(within),
                    value_at: None,
                    from: Some(place(&format!("lap-{lap}-start"), from_m)),
                    to: Some(place(&format!("lap-{lap}-finish"), to_m)),
                })]),
                then: Consequence::SetStanding {
                    standing: Standing::Gated,
                    reason: format!("lap {lap} not closed in the hour"),
                },
                // A split needs both ends, so a lap never closed is not over time:
                // the runner who stops mid-lap has withdrawn, and this is silent.
                sentence: format!(
                    "Closing lap {lap} more than {} after it starts ends the day.",
                    span(within)
                ),
            })
        }

        // Still in it — both halves. `remaining` says how many are left and
        // never who, so without these two the rule crowned the runner who had
        // just been put out, and then the one who had walked off.
        "last_standing" => {
            let award = s(params, "award")?;
            Some(Expansion {
                when: all_of(vec![
                    is(Atom::Standing { is: Standing::Clean }),
                    not(Atom::Withdrawn),
                    is(Atom::Field {
                        aggregate: Aggregate::Remaining,
                        cmp: Cmp::Lte,
                        value: 1.0,
                        ratio: None,
                    }),
                ]),
                then: Consequence::Award { name: award.clone() },
                sentence: format!(
                    "A clean runner still in when every other runner has withdrawn, been gated or been disqualified is {award}."
                ),
            })
        }

        _ => None,
    }
}
