//! `orienteering@1` — the controls, in order.
//!
//! One kind, and the only user of the kernel's `order` predicate. A score event
//! is the same controls with the order dropped.

use serde_json::Value;

use super::{all_of, any_of, b, not, Expansion, Pack};
use crate::kernel::{Atom, Consequence, ObservationKind, Place, Standing, Where};

pub fn pack() -> Pack {
    Pack {
        name: "orienteering",
        version: 1,
        modes: &["run"],
        kinds: &["controls"],
        placed: &[],
        compile,
    }
}

fn compile(kind: &str, params: &Value, _at: &Option<Where>) -> Option<Expansion> {
    if kind != "controls" {
        return None;
    }
    let in_order = b(params, "in_order")?;
    let controls: Vec<Place> = params
        .get("controls")?
        .as_array()?
        .iter()
        .map(|c| {
            Some(Place {
                // A control is a named point: a null one does not fit, as in the reference.
                point: Some(c.get("point")?.as_str()?.to_string()),
                along_m: c.get("along_m")?.as_f64()?,
            })
        })
        .collect::<Option<Vec<Place>>>()?;

    let when = if in_order {
        all_of(vec![not(Atom::Order {
            sequence: controls.clone(),
        })])
    } else {
        any_of(
            controls
                .iter()
                .map(|c| {
                    not(Atom::Observed {
                        at: c.clone(),
                        kind: ObservationKind::Punched,
                    })
                })
                .collect(),
        )
    };
    Some(Expansion {
        when,
        then: Consequence::SetStanding {
            standing: Standing::Disqualified,
            reason: "mispunch".into(),
        },
        // In order, `order` is about being *at* each control, by any kind of
        // read; in any order, each control needs a punch. SPEC.md §3.4.
        sentence: if in_order {
            format!(
                "Missing any of the {} controls, or reaching them out of order, disqualifies.",
                controls.len()
            )
        } else {
            format!(
                "Missing a punch at any of the {} controls disqualifies; the order is free.",
                controls.len()
            )
        },
    })
}
