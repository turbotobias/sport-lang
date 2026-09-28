# sport-lang

**An open file format for the rules of an endurance event, and a deterministic function that turns
the event's timing observations into every entrant's result.**

A **course document** is GeoJSON that also carries the event's rules: cut-offs, required stations,
qualifying times, lap limits, drafting penalties, controls in order. An **observation log** is what
the timing hardware saw: who, how far along the course, what, when. **`fold`** takes the two and
returns every entrant's standing, total, penalties and awards, each with the sentence of the rule
that caused it. It has no clock, no IO and no randomness, so **anyone holding the same two files
computes the same result, to the millisecond**. Today a result is whatever one vendor's software
printed. With sport-lang it is a function anyone can check.

```
  mats · trackers · a marshal's tablet · a watch file · a partner feed
                        │  raw reads: tag, device clock, received-at
                        ▼
                     bridge             yours: identity · clock · dedupe · lateness
                        ▼
                observation log         append-only; a correction supersedes, never edits
                        │
  course document ──► plan ──► fold ──► every entrant: standing · total_ms · finished_at
  (GeoJSON + rules)     │                              awards · laps · the sentence why
                        └──► not runnable: unknown version, dialect or kind, or a broken law.
                             The course still draws; nobody gets a result.
```

| you are | what the format gives you |
| --- | --- |
| **a timing company** | Keep your hardware and your bridge; emit each observation as one 12-field JSON row. Read each event's rules from its file instead of hand-keying them, re-score a protest or a late read by appending a row, and prove your engine against [the corpus](docs/implementing.md). Publish data, not an API. |
| **an organiser** | Write the rules once, in a file every vendor runs the same way, [rehearse them](docs/rehearsal.md) against a simulated field before race day, and switch vendors without rewriting a rule. |
| **media, results sites, apps** | Live standings, a replay to any millisecond, and the reason for every penalty, from the same two files the official result comes from: one feed, not an export per partner ([reading a result](docs/results.md)). |
| **watch and app makers** | A split table at any pace, the slowest even pace that clears every cut-off, and a runner's own watch track turned into crossings of the course ([API](docs/api.md)). |
| **federations, record-keepers** | The course length with the method that measured it, kept apart from the stated and the certified length, and a result anyone can re-derive from two files years later. |

**Status:** 0.1.0, unreleased; wire format `sport:version: 1`; Apache-2.0. Two engines, one in
TypeScript and one in Rust written from [SPEC.md](SPEC.md) and the corpus (it also builds to
WebAssembly), pass all 19 conformance cases (104 entrant states), which reach every kind of every
dialect, and all 40 decode cases; on 1 100 more entrant states swept from simulated fields, and on
176 damaged files, they disagree nowhere. Nothing is on crates.io or npm yet. Read
[one event, end to end](#one-event-end-to-end) next, then [build from source](#quick-start).

## Why a format

Today an event's rules live in three places that disagree: the organiser's PDF, each timing vendor's
configuration, and whatever the results page printed. Every media partner gets its own export, a
re-score after a protest or a late upload is keyed in again by hand, and a cut-off implemented
twice can be implemented two ways. The format is built around the failures that follow:

- **A reader that does not know a rule drops it.** So an unknown dialect or kind, parameters that do
  not fit, or a broken cross-reference make a document **readable but not runnable**: it still
  draws, and no engine scores it. _Silently dropping a rule is how a timing system disqualifies the
  wrong person._
- **A rule nobody can satisfy passes every per-field check.** A _punch_ required where the place
  only records a _pass_ can never be met, yet the point exists, its id is unique and its distance in
  range. It happened three times while the language was built: once a rehearsal penalised 194 of
  200 simulated entrants, and last time twelve of twelve runners were penalised for a station nobody
  could have punched. It is now a law checked before anything runs
  ([SPEC §2.1](SPEC.md#21-the-course-document)).
- **"How long is the course?" has several honest answers.** A sphere is out by a few tenths of a
  percent against WGS84, in either direction with latitude and bearing: over 100 m on a marathon,
  more than a kilometre on a 500 km ride. One file's climb varies almost fourfold with smoothing and
  threshold alone. So every distance carries its method, and what was sold (`stated_m`), what a
  record uses (`certified_m`) and what a pacing plan uses (`distance_m`) are kept apart.
- **A coordinate is ambiguous exactly where the mats are.** A course that doubles back has two
  places at one latitude and longitude, but only one at 31 400 m. So everything is addressed by
  `along_m`, the address timing systems already use.

None of these can be fixed by a better product. They need a shared format with one meaning.

## One event, end to end

A 10 km with one timing point at 5 km, four rules and five runners. The files are in
[examples/10k/](examples/10k); a test folds them through both engines and fails if anything this
section shows disagrees with what the engines return. It is also the conformance case
[example-10k-the-readme-race](corpus/conformance/example-10k-the-readme-race.json).

**The result.** This is `fold(rules, log)`:

| entrant | standing | total_ms | adjustment_ms | awards | why (`applied[].sentence`) |
| --- | --- | --- | --- | --- | --- |
| `ent_ana` | clean | 2 790 000 (46:30) | 0 | sub-50 | Finishing inside 50:00 qualifies for sub-50. |
| `ent_ben` | gated | 5 100 000 (1:25:00) | 0 | — | The day ends for anyone reaching km-5 after 07:40. |
| `ent_cy` | penalised | 3 240 000 (54:00) | 120 000 | — | Missing km-5 costs 2:00. |
| `ent_dee` | clean | 2 880 000 (48:00) | 0 | sub-50 | Finishing inside 50:00 qualifies for sub-50. |
| `ent_eve` | disqualified | 3 300 000 (55:00) | 0 | — | Taking outside assistance ends the day. |

**The document**, trimmed; every member shown is exactly what the file holds:

```jsonc
// excerpt of examples/10k/document.json
{
  "type": "FeatureCollection",
  "sport:version": 1,
  "sport:id": "crs_example_10k", "sport:event": "evt_example", "sport:way": null,
  "sport:name": "Example 10K",
  "sport:dialects": ["athletics@1"],
  "sport:measure": { "distance_m": 10000, "distance_method": "wgs84-geodesic-2d", "stated_m": 10000 },
  // … six more measure members, and "sport:provenance": [], where each original file came from
  "sport:path": [{ "line": "ln_1", "from_m": 0, "to_m": 10000, "repeat": 1 }],
  "sport:rules": [
    { "id": "rul_gate", "dialect": "athletics@1", "kind": "cutoff_at", "ordinal": 0,
      "at": { "point": "km-5", "along_m": 5000 },
      "params": { "at": "2027-05-02T07:40:00.000Z", "says": "07:40" } },
    { "id": "rul_station", "dialect": "athletics@1", "kind": "station_required", "ordinal": 1,
      "at": { "point": "km-5", "along_m": 5000 }, "params": { "penalty_ms": 120000, "each_time": false } },
    { "id": "rul_help", "dialect": "athletics@1", "kind": "no_outside_help", "ordinal": 2,
      "at": null, "params": {} },
    { "id": "rul_sub50", "dialect": "athletics@1", "kind": "qualifies_within", "ordinal": 3,
      "at": { "point": "finish", "along_m": 10000 }, "params": { "within_ms": 3000000, "award": "sub-50" } }
  ],
  "features": [
    { "type": "Feature", "properties": { "role": "point", "id": "km-5", "kind": "control", "name": "5 km", "along_m": 5000 } }
    // … its geometry, the line ln_1, and the points "start" (0 m) and "finish" (10 000 m)
  ]
}
```

`plan` expands each rule into the kernel and writes its sentence from the rule itself, so the words
cannot drift from what the rule does. The gate is already in UTC; `says` is how the organiser wrote
it. `qualifies_within` needs a `finished` read at its place inside the time, so nobody still out,
withdrawn or short of the distance is awarded ([docs/rules.md](docs/rules.md)).

**The log.** 15 observations, every time 2027-05-02, UTC:

| entrant | `started` at start | `punched` at km-5 | `finished` at finish |
| --- | --- | --- | --- |
| `ent_ana` | 07:00:00 | 07:22:00 | 07:46:30 |
| `ent_ben` | 07:00:00 | **07:41:00** | 08:25:00 |
| `ent_cy` | 07:00:00 | _no read_ | 07:52:00 |
| `ent_dee` | 07:00:00 | 07:24:00 | 07:58:00 keyed in wrong (`obs_11`), then 07:48:00 (`obs_15`, which `supersedes` it) |
| `ent_eve` | 07:00:00 | 07:26:00, from a marshal's tablet with `flags: ["outside_help"]` | 07:55:00 |

`obs_11` stays in the log, where a protest can see it, but it no longer counts. Every row has the
same 12 fields. This one arrives an hour late, from a backup reader at 5 km:

```jsonc
// examples/10k/late-read.json
{
  "id": "obs_16", "entrant": "ent_cy", "at": { "point": "km-5", "along_m": 5000 }, "kind": "punched",
  "t": "2027-05-02T07:25:40.000Z", "quantity_name": null, "quantity_value": null, "flags": [],
  "source": "transponder", "device": "dev_km5_backup", "confidence": 1, "supersedes": null
}
```

Append it and fold again, and `ent_cy` is **clean at 3 120 000 (52:00)**. Nothing was edited and no
state was patched. The log grew by one row, and the result is a function of the log.

**The same two files answer the rest** (a time here is an Effect `DateTime.Utc`;
[docs/api.md](docs/api.md) has every signature):

| question | call | the engines' answer |
| --- | --- | --- |
| Standings at 07:30, live | `fold_until(rules, log, 07:30)` | `ent_eve` is already disqualified: the rule is bound to no place, so the marshal's flag at 07:26 applies at once. Everyone else is clean. `ent_cy`'s missing punch is **dormant** until they reach 5 km or their day ends; `sub-50` waits for the finish. |
| … and at 07:50 | the same | `ent_ben` is gated; `ent_ana` and `ent_dee` hold sub-50; `ent_cy` is still clean, not yet seen at 5 km or the finish. |
| Where is everyone at 07:30? | `order_at(positions_at(log, 07:30))` | ana 6 633 m, dee 6 250 m, cy 5 769 m, eve 5 690 m, ben 3 659 m, each interpolated between two reads (`between: true`; cy's spans the read the mat missed), by `along_m`, never by coordinates. |
| Can `ent_ben` still make the gate? (asked at 07:30) | append a `punched` with `source: "virtual"` at km-5, fold | At 07:40:00.000, clean. At 07:40:00.001, gated. The rule is _after_ 07:40, and time is whole milliseconds. |
| What even pace clears every cut-off? | `slowest_clear_pace(document, rules, 07:00)` | 479.99 s/km, an 8:00/km day: at 480 s/km `plan_at_pace` reaches km-5 at 07:40:00.000, clean; at 481, gated there. Found by bisecting a one-runner fold, so it works for rules nobody has written yet; it ignores climb. |
| What if 5 km were a plain `mat`? | change the point's `kind` | `plan` refuses: `a rule requires an observation the place never produces`, `rul_station wants punched at km-5, a mat which produces passed`. |
| What if it needed `ski@1`? | add it to `sport:dialects` | `plan` refuses with `missing_dialects: ["ski@1"]`. The course still draws; nobody gets a result. |
| Does it draw? | any GeoJSON viewer | Yes: the `sport:*` members are foreign members, which a viewer ignores. |

**Rehearsed before race day** on 1 000 simulated runners, the station rule fired 15 times, and every
one was a read the mat dropped; a field 30 s/km slower than planned turns 8 % gated into 19 %. The
table and the field are in [docs/rehearsal.md](docs/rehearsal.md).

## What each reader does with it

**Timing systems** keep their hardware and bridge and emit one 12-field observation shape. They
read the organiser's rules from the document, not a PDF, and run them as every other vendor does;
re-fold after every late upload, reader failure or protest, which is cheap and exact because a
correction supersedes instead of editing; and show the `applied` sentences at the results desk, so
a protest argues with a sentence, not a config screen
([the bridge's part](docs/implementing.md#the-bridge-is-yours), [a reference bridge](ts/src/bridge.ts)).

**Organisers** publish the rules as data next to the course, each with the sentence an entrant
reads; [rehearse](docs/rehearsal.md) them against a simulated field; put the slowest even pace that
clears every cut-off on the entry page, saying on a hilly course that it ignores climb; and write a
wave start's limits as `cutoff_within`, which runs from each entrant's own start.

**Media, broadcast and apps** take the document and the log, not a bespoke results API. The fold up
to _t_ is the standings at _t_ and scrubbing to the end gives exactly the result, so a live board
and the official result cannot disagree; `positions_at` places everyone by `along_m`; every penalty
carries its sentence, so a graphic can say _why_. Finishers, DNF, DNS, placings, gun and net time:
[docs/results.md](docs/results.md).

**Watch and app makers** load one document per distance. `plan_at_pace` gives a split table in which
every number comes from the fold; `self_timed` turns a recorded track into a crossing of every
place, checking its length (within 15 %) but not its route.

**Federations and record-keepers** read how the length and climb were measured (`sport:measure`,
`certified_m` apart from `stated_m`) and each original's source, URL, sha256 and verifier
(`sport:provenance`), and can re-derive a result years later from the document and the log.

## The data model, on one screen

Three JSON shapes cross a boundary, and nothing else does. Each has a JSON Schema generated from the
TypeScript: [document](schema/document.schema.json), [observation](schema/observation.schema.json),
[entrant state](schema/entrant-state.schema.json).

**Course document.** A GeoJSON `FeatureCollection`. Every document is valid GeoJSON, but not every
GeoJSON is a document: where RFC 7946 permits something and a result depends on it, sport-lang
requires it.

| member | type | meaning |
| --- | --- | --- |
| `sport:version` | `1` | format version, an integer ≥ 1; a version the engine does not run is refused, not guessed |
| `sport:id`, `sport:event` | string | this document, and the event it belongs to |
| `sport:way` | string \| null | the entry option (a distance, a category): one document per way, `null` when the event has one |
| `sport:name`, `sport:dialects` | string, `["name@major"]` | display name; every dialect the rules use |
| `sport:measure` | object | nine members, all nullable: `distance_m` and its method, `stated_m`, `certified_m`, ascent, descent, how elevation was taken |
| `sport:provenance` | array | `source`, `origin_url`, `sha256`, `format`, `verified_by`, `verified_at`, per original |
| `sport:path` | `[{line, from_m, to_m, repeat}]` | the course as a playlist over stored lines: four laps are one line with `repeat: 4` |
| `sport:rules` | `[{id, dialect, kind, ordinal, at, params}]` | `at` is a place `{point, along_m}`, a span `{from_m, to_m}`, or `null`; `params` is an object |
| `features` | GeoJSON | `properties.role` is `line` (LineString), `point` (Point), `segment` (LineString) or `zone` (Polygon) |

**Observation**, the only input: `{id, entrant, at: {point | null, along_m}, kind, t, quantity_name,
quantity_value, flags, source, device, confidence, supersedes}`, every member present. `kind` is one
of 8: `started passed entered left punched checked finished withdrew`; `source` one of 6:
`transponder gps watch_upload manual partner virtual`. `t` is UTC and already corrected, so no
device clock reaches the language: exactly `YYYY-MM-DDTHH:MM:SS[.sss]Z`, on a real calendar day; an
offset is refused, not converted. **`id` is unique in the log**: it breaks ties and is what
`supersedes` names (`an observation id is used twice` makes a log malformed).

**Entrant state**, the output, one per entrant in the log: `entrant, standing, started_at,
finished_at, withdrew, total_ms, adjustment_ms, neutralised_ms, laps, punches, awards, classes,
applied`. `standing` is `clean < penalised < gated < disqualified` and **only ever worsens**.
`total_ms` is net time from the entrant's own first `started`. **Never rank on a non-finisher's
`total_ms`**: it runs to their last read. [docs/results.md](docs/results.md) turns a state into a
results line.

**A place's `kind` fixes the observation it produces** (`control` → `punched`, `finish` →
`finished`, `mat` → `passed`, …), and a rule asking for any other kind there is refused. **If a rule
has to prove somebody was at a timing point, declare that point a `control`.**

## Rules: a closed kernel, and a dialect per sport

A document never contains logic. It names a **kind** from a versioned **dialect** and fills in typed
parameters; the dialect is code shipped with each engine, so a document handed to a stranger carries
no scripts.

| dialect | kinds |
| --- | --- |
| `athletics@1`: any race along one line, on foot or on a bike | `cutoff_at` · `cutoff_within` · `qualifies_within` · `station_required` · `no_outside_help` |
| `backyard@1` | `lap_within` · `last_standing` |
| `orienteering@1` | `controls` (in order or any order) |
| `triathlon@1` | `drafting` · `wetsuit_limit` · `transition_neutral` |

```jsonc
// corpus/conformance/orienteering-order-and-correction.json#/document/sport:rules/0
// "Missing any of the 3 controls, or reaching them out of order, disqualifies."
{ "id": "rul_controls", "dialect": "orienteering@1", "kind": "controls", "ordinal": 0, "at": null,
  "params": { "in_order": true, "controls": [{ "point": "c1", "along_m": 800 },
    { "point": "c2", "along_m": 1900 }, { "point": "c3", "along_m": 3100 }] } }
```

Every kind expands into a fixed **kernel** of 9 atoms (`observed`, `order`, `clock`, `count`,
`quantity`, `flag`, `standing`, `withdrawn`, `field`) and 5 consequences (`adjust_time`,
`set_standing`, `classify`, `award`, `neutralise`), joined by one flat `all` or `any` with no
recursion. **Adding a sport means adding a dialect; the kernel does not change.** Every kind, a rule
from each dialect and the place-kind table: [docs/rules.md](docs/rules.md); the expansions:
[SPEC §3.4](SPEC.md#34-the-dialects-of-version-1).

## Guarantees

Each is stated in [SPEC.md](SPEC.md); where a test can pin one,
[rust/tests/properties.rs](rust/tests/properties.rs) or the corpus does.

1. **Pure.** No clock, IO, network, database or randomness.
2. **Arrival order cannot change a result.** The log is settled first: superseded rows dropped, the
   rest sorted by `(t, id)`. A log that repeats an id is `malformed`.
3. **Whole numbers in every decision.** Integer ms and metres, UTC instants; a fraction enters only
   in `quantity` and `field winner_elapsed × ratio` ([arithmetic](docs/implementing.md#arithmetic)).
4. **A closed vocabulary.** No user-defined functions and no scripts: every document is decidable.
5. **Refuse; never guess.** `plan` returns kernel rules or _not runnable_ with every reason, never
   "run what you understood".
6. **Replay equals result.** The state at _t_ is the fold of what is stamped at or before _t_.
7. **Standing only worsens, and a correction supersedes.** The replaced row stays in the log.

A document breaking a per-field law is **rejected at parse**; one that is readable but not runnable
(a version, dialect or kind the engine lacks, `params` that do not fit, or one of 8 cross-document
laws) is **refused** by `plan`; a log with an undecodable row or a repeated id is **malformed**.
Every law: [docs/implementing.md](docs/implementing.md#what-is-rejected-refused-or-malformed).

## Conformance: the corpus is the specification

Two implementations can read prose differently and both believe they are right; a corpus turns that
into a failing test the day it is introduced. [SPEC.md](SPEC.md) explains the corpus, and the corpus
is normative.

| corpus | holds |
| --- | --- |
| [corpus/conformance/](corpus/conformance) | 19 cases, 104 entrant states (11 by hand, 8 generated), reaching every kind of every dialect. Each is `{name, why, document, log, expect[]}`; every entrant's `standing, total_ms, adjustment_ms, awards, laps` must match, none extra and none missing |
| [corpus/decode/](corpus/decode) | 40 cases: 10 accept, 13 reject, 17 refuse, each with its verdict and reasons; six accepted documents carry a log with its own verdict (1 accepted, 4 rejected, 1 refused) |
| [corpus/courses/](corpus/courses) | 7 synthetic courses in open sea near 0° N 0° E, the inputs to the generators in [ts/scripts/](ts/scripts) |

**The differential sweep** folds simulated fields, with officials' flags and a measured water
temperature, through both engines and compares every member of every state and every sentence:
**44 fields, 1 100 entrant states, 0 disagreements** ([ts/test/differential.test.ts](ts/test/differential.test.ts)).
A second sweep damages one lawful document and log 176 ways (every member left out in turn, an
offset, an impossible day, a repeated id); both engines give the same verdict and reason on each.

**What this proves, and what it does not.** The Rust was written from SPEC.md and the corpus, not
translated from the TypeScript, so the specification is enough to build against: nothing had to be
guessed from the reference's source. It does not prove the engines independent: one author wrote
both, and a misreading they share is invisible to both. **A third implementation, by somebody
else, is the most valuable contribution this project can receive**
([docs/implementing.md](docs/implementing.md)); where it disagrees, the result is a new case, not
an argument.

## Quick start

Nothing is published to crates.io or npm yet. Clone `https://github.com/turbotobias/sport-lang` and
run every command from its root. Each snippet is a file in this repository, shown whole; the comment
at its end is what it prints, and a test checks both.

**Rust**: [rust/examples/quickstart.rs](rust/examples/quickstart.rs).

```rust
//! The README's 10 km, folded. From the repository root: `cargo run --example quickstart`.
use sport_lang::{document::CourseDocument, fold::fold, observe::Observation, packs};

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
```

**TypeScript**: [ts/examples/quickstart.ts](ts/examples/quickstart.ts). Run `npm ci` in `ts/` first;
Node 22.18 or later runs the sources directly.

```ts
// The README's 10 km, folded. From the repository root: `node ts/examples/quickstart.ts`.
import { readFileSync } from 'node:fs'
import { PACKS, run } from 'sport-lang'

const read = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'))
const say = (line: string) => process.stdout.write(`${line}\n`)

// Decode both files, plan the rules, check the log, fold. Three answers and no fourth.
const answer = run(PACKS, read('examples/10k/document.json'), read('examples/10k/log.json'))

if (answer.kind === 'malformed') {
  // Not a document, or not a log: what was expected, and where.
  say(`malformed: ${answer.why} ${JSON.stringify(answer.broken)}`)
} else if (answer.kind === 'refused') {
  // Readable, not runnable: draw the course, refuse to score it.
  say(`refused: ${JSON.stringify(answer.why)}`)
} else {
  for (const s of answer.states) {
    const why = s.applied.map((a) => a.sentence)
    say(`${s.entrant} ${s.standing} ${s.total_ms} ${JSON.stringify(why)}`)
  }
}

// $ node ts/examples/quickstart.ts
// ent_ana clean 2790000 ["Finishing inside 50:00 qualifies for sub-50."]
// ent_ben gated 5100000 ["The day ends for anyone reaching km-5 after 07:40."]
// ent_cy penalised 3240000 ["Missing km-5 costs 2:00."]
// ent_dee clean 2880000 ["Finishing inside 50:00 qualifies for sub-50."]
// ent_eve disqualified 3300000 ["Taking outside assistance ends the day."]
```

A document missing `sport:measure.ascent_threshold_m` prints
`malformed: the document did not decode: Missing key`, then
`at ["sport:measure"]["ascent_threshold_m"]`.

**WebAssembly** is the Rust engine for a browser or Node, JSON strings in and out: build it with
`wasm-pack build wasm --target nodejs --out-dir pkg-node --release`, then `node
wasm/quickstart.mjs`. [docs/api.md](docs/api.md) has every call of all three, that quick start, the
answer shapes, and how to depend on the npm package before it is published (a path or git dependency
does not work).

## Scope and versioning

**It is not** a timing system (identity, clock discipline, dedupe and lateness belong to the
bridge), a results store (results are the fold's output, never stored in the document), a results
presenter (placings, dead heats, rounding, IOF XML 3.0 export are the publisher's), a scripting
language, geometry maths (turning a GPS fix into `along_m` is upstream; the fold never reads a
coordinate), or timezone-aware (`16:30 local` becomes UTC when the document is written). The
reasons, and how the vocabulary grows: [docs/scope.md](docs/scope.md).

**Versioning.** The format is `sport:version: 1`; the kernel is closed and a change to it is a spec
change in every implementation ([SPEC §7](SPEC.md#7-versioning)). Dialects are `name@major` and
**append-only within a major**: a rule written in 2027 means the same in 2031, and a change of
meaning is `triathlon@2`, shipped beside `@1`. A new kind lands with a conformance case; that is the
only way the specification grows. Unknown members (`x-…`, a `sport:results` snapshot, extra
`properties`) are ignored. Packages version on their own ([CHANGELOG.md](CHANGELOG.md)).

## Known gaps

One line each here; in full in [docs/known-gaps.md](docs/known-gaps.md).

- **Gun time** takes two folds; **waves** under a wall-clock gate need `cutoff_within`.
- **Entrants have no attributes**: no age groups, categories, relays, teams or stage races.
- **A log is per document**; the reference bridge corrects one clock offset per device, not a drift.
- **An official's unforeseen decision**, a penalty no kind names, cannot be recorded.
- **`self_timed` checks length, not route**, and pacing ignores climb.
- **`each_time` counts observations, not offences**; a withdrawal before a required station is a miss.
- **Whole numbers are a convention**, not checked at decode; some kernel atoms no case pins.
- **Every read folds the whole log**: 30 000 entrants, 263 872 reads: 0.96 s in WebAssembly, 2.4 s in TypeScript.
- **Not yet**: a certificate reference, a geometry corpus, dialects for ski, paddle or rowing, `wasm-opt`.

## Repository

| path | what it holds |
| --- | --- |
| [SPEC.md](SPEC.md) | the prose specification, which explains the corpus |
| [docs/](docs) | [API](docs/api.md), [reading a result](docs/results.md), [rules](docs/rules.md), [rehearsal](docs/rehearsal.md), [implementing it](docs/implementing.md), [scope and versioning](docs/scope.md), [known gaps](docs/known-gaps.md) |
| [corpus/](corpus) | `conformance/`, `decode/` and `courses/`: the normative part |
| [examples/](examples) | what this README shows, folded by both engines in CI |
| [schema/](schema) | JSON Schema for the document, the observation and the entrant state |
| [ts/](ts) | the TypeScript reference, npm package `sport-lang`; `ts/scripts/` generates the corpus and times the fold (`bench.ts`) |
| [rust/](rust) | the Rust engine, crate `sport-lang` |
| [wasm/](wasm) | the Rust engine for JavaScript, crate `sport-lang-wasm`: `run`, `dialects` |
| [.github/workflows/ci.yml](.github/workflows/ci.yml) | `cargo fmt`, clippy and the Rust tests; the WebAssembly build; the TypeScript tests on Node 22 and 24 against that build, so both engines fold every change; and the packed package installed and imported the way a consumer would ([.github/smoke.mjs](.github/smoke.mjs)) |

Build and test: `cargo test --workspace` (corpus, examples, properties); `wasm-pack build wasm
--target nodejs --out-dir pkg-node --release`; `cd ts && npm ci && npm test` (corpus, examples,
the differential sweep against that build). [CONTRIBUTING.md](CONTRIBUTING.md) has the rest.

## Governance

- **Who decides.** The maintainer, Tobias Goulden Schultz, who wrote both engines. A new meaning
  lands as a corpus case both engines pass; a changed meaning is a new dialect major or format
  version, never an edit. It lives in the maintainer's account for now and moves to a `sport-lang`
  organisation, so timing companies, organisers and federations can join as maintainers; GitHub
  redirects every link when it does.
- **Stability.** Until the first release is tagged, format version 1 may still change (every change
  is in [CHANGELOG.md](CHANGELOG.md)). From that tag it is frozen: a change that alters any verdict
  or any fold is format version 2, even while the packages are 0.x.
- **Where the code comes from.** Snapshot commits from a private upstream, where the engines are
  maintained beside software that uses them. Pull requests are reviewed here and credited in the
  snapshot that carries them ([CONTRIBUTING.md](CONTRIBUTING.md)).
- **Where to ask.** Questions, proposals, a result you believe is wrong: a GitHub issue, with a
  document and a log that show it. Security: GitHub's private vulnerability reporting, not an issue.

## Contributing

A change to what a document means starts as a corpus case: a document, a log, the states you expect,
and a `why` sentence saying what it pins; then both engines change until it passes
([CONTRIBUTING.md](CONTRIBUTING.md)). Most wanted, in order: a case the engines get wrong; a third
implementation, in any language; a rule your event runs that no kind can say (the sentence, the
place, a log that should trip it); a dialect for a sport not yet covered (per kind: a parameter
schema, an expansion into the existing kernel, the sentence it prints, and a case).

## Licence

Apache-2.0 for everything: code, specification and corpus ([LICENSE](LICENSE), [NOTICE](NOTICE)).
The explicit patent grant is deliberate: a format only becomes a standard if implementing it is
something a company's lawyers can approve. Contributions come in under the same licence and grant.
