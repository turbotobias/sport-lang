# Rules: the dialects and the kernel

Every kind of rule version 1 can say, a rule from each dialect with the sentence the engines print
for it, the kernel they all expand into, and which observation each kind of place produces.
[SPEC §3.2](../SPEC.md#32-the-kernel) and [§3.4](../SPEC.md#34-the-dialects-of-version-1) are
normative.

## The dialects

A document never contains logic. It names a **kind** from a versioned **dialect** and fills in
typed parameters. The dialect is code that ships with each implementation, never data that
arrives with the file, so a document contains no scripts and no user-defined functions.

| dialect | kinds |
| --- | --- |
| `athletics@1`: any race along one line, on foot or on a bike (the corpus runs a 500 km ride under it) | `cutoff_at` (a wall-clock gate at a place) · `cutoff_within` (an elapsed limit) · `qualifies_within` (an award for reaching its finish inside a time) · `station_required` (a penalty for a missed punch) · `no_outside_help` (disqualification on an official's flag) |
| `backyard@1` | `lap_within` (lap _n_, once closed, closed inside the hour) · `last_standing` (the award for the last runner still going) |
| `orienteering@1` | `controls` (every control punched, in order or any order) |
| `triathlon@1` | `drafting` (a penalty, once, for taking longer than the limit through the draft zone, unless flagged overtaking) · `wetsuit_limit` (disqualification for a wetsuit above a measured water temperature) · `transition_neutral` (the clock stops in transition) |

`plan` expands each rule into the kernel and generates its sentence from the rule itself, so the
words cannot drift from what the rule does. A few kinds carry a binding that matters:

- **`qualifies_within`** is bound to the finish and needs a `finished` read there inside the time,
  so a runner still out, one who withdrew, or one who stopped after two laps of four is never
  awarded. Bound to no place it is refused (`needs a place`), as a `station_required` is. Being
  bound also keeps it dormant until the finish, so a live view does not judge it early.
- **`cutoff_at`** is one wall-clock instant, already in UTC; `says` is how the organiser wrote it.
  For a wave start use `cutoff_within`, which runs from each entrant's own start.
- **`no_outside_help`** is bound to no place, so an official's flag applies the moment it is
  stamped.

## A rule from each of the other three dialects

Taken from the conformance corpus, with the sentence the engines print for it (the `athletics@1`
kinds are in [one event, end to end](one-event.md)):

```jsonc
// corpus/conformance/backyard-last-standing.json#/document/pace:rules/1
// "Closing lap 2 more than 1:00:00 after it starts ends the day."
// A lap is a place: lap 2 runs from 6 720 m to 13 440 m.
{ "id": "rul_lap_2", "dialect": "backyard@1", "kind": "lap_within", "ordinal": 2, "at": null,
  "params": { "within_ms": 3600000, "from_m": 6720, "to_m": 13440, "lap": 2 } }
// corpus/conformance/backyard-last-standing.json#/document/pace:rules/3
// "A clean runner still in when every other runner has withdrawn, been gated or been disqualified is last one standing."
// A fact about the field.
{ "id": "rul_last", "dialect": "backyard@1", "kind": "last_standing", "ordinal": 99, "at": null,
  "params": { "award": "last one standing" } }
// corpus/conformance/orienteering-order-and-correction.json#/document/pace:rules/0
// "Missing any of the 3 controls, or reaching them out of order, disqualifies."
// Extra punches in between are allowed.
{ "id": "rul_controls", "dialect": "orienteering@1", "kind": "controls", "ordinal": 0, "at": null,
  "params": { "in_order": true, "controls": [{ "point": "c1", "along_m": 800 },
    { "point": "c2", "along_m": 1900 }, { "point": "c3", "along_m": 3100 }] } }
// corpus/conformance/triathlon-drafting-and-transition.json#/document/pace:rules/0
// "Taking more than 0:25 through the draft zone without an overtaking flag costs 5:00, once."
// Once per fold: the kind has no observed clause for each_time to count (known-gaps.md).
{ "id": "rul_draft", "dialect": "triathlon@1", "kind": "drafting", "ordinal": 0, "at": null,
  "params": { "seconds_ms": 25000, "penalty_ms": 300000, "from_m": 5000, "to_m": 5100 } }
```

A lap is a place (`lap-3-finish` at 20 160 m), so a backyard ultra needs no counting in the kernel.

## The kernel

Every kind expands into a small, fixed kernel that never learns about a sport:

- **9 atoms:** `observed{at, kind}` · `order{sequence}` (a subsequence of the log) ·
  `clock{elapsed | moving | wall | split}` · `count{laps | punches | penalties | observations}` ·
  `quantity{name}` (a measurement nobody took is false) · `flag{name}` · `standing{is}` ·
  `withdrawn` · `field{winner_elapsed | rank | remaining | finishers}`
- **5 consequences:** `adjust_time` · `set_standing` · `classify` · `award` · `neutralise`
- **A predicate** is one `all` or `any` over a flat list of possibly negated atoms. It has no
  recursion. A rule that reads the `field` runs in stratum 1, over what stratum 0 left, so "last
  one standing" or "within 120 % of the winner" cannot form a cycle.

Adding a sport means adding a dialect: a new sport, or a training session with targets, is a new
dialect, and the kernel stays put. Four ship today — any race along a line (run or ride), backyard
ultra, orienteering, triathlon — on a kernel of 9 atoms and 5 consequences that never learns about
any sport.

## What a place produces

**A place's `kind` fixes the observation it produces**, and a rule that asks for any other kind
there is refused ([SPEC §2.2](../SPEC.md#22-features)):

| place kind | produces |
| --- | --- |
| `start` | `started` |
| `finish`, `lap` | `finished` |
| `control` | `punched` |
| `check` | `checked` |
| `transition_in`, `zone_in` | `entered` |
| `transition_out`, `zone_out` | `left` |
| `mat`, `aid`, `gate`, `corral`, anything else | `passed` |

**If a rule has to prove somebody was at a timing point, declare that point a `control`.** A rule
that requires a _punch_ at a place that only ever records a plain _pass_ can never be met, and
passes every per-field check; it is a law checked before anything runs
([SPEC §2.1](../SPEC.md#21-the-course-document)).
