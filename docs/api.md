# API

Every call the TypeScript package, the Rust crate and the WebAssembly build export, with what goes
in and what comes out. [SPEC §4](../SPEC.md#4-the-boundary) is the normative boundary; this page is
the map of it.

Nothing is published to crates.io or npm yet. Clone `https://github.com/turbotobias/pace-geojson` and
run every command from its root. Each quick start below is a file in this repository, shown whole;
the comment at its end is what it prints, and a test checks both. All three fold the 10 km of
[one event, end to end](one-event.md).

## TypeScript

### TypeScript quick start

[ts/examples/quickstart.ts](../ts/examples/quickstart.ts). Run `npm ci` in `ts/` first; Node 22.18
or later runs the sources directly.

```ts
// The README's 10 km, folded. From the repository root: `node ts/examples/quickstart.ts`.
import { readFileSync } from 'node:fs'
import { PACKS, run } from 'pace-geojson'

const read = (path: string): string => readFileSync(path, 'utf8')
const say = (line: string) => process.stdout.write(`${line}\n`)

// Parse both files, plan the rules, check the log, fold. Three answers and no fourth.
// Each file goes in as its text: a value `JSON.parse` made can no longer show a member named twice.
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

A document missing `pace:measure.ascent_threshold_m` prints
`malformed: the document did not decode: Missing key`, then
`at ["pace:measure"]["ascent_threshold_m"]`.

### TypeScript calls

From `pace-geojson` (each module also at `pace-geojson/<module>`, such as `pace-geojson/fold` or
`pace-geojson/packs/athletics`). A document or a log goes in as **its text** (`parse_document`,
`parse_log`, and `run` handed strings), which is the only form every law can be checked on, or
as a value a JSON parser already made (`decode_document`, `decode_log`, and `run` handed
anything else), which cannot show that its text named a member twice. A `Result` is Effect's;
every instant is a `DateTime.Utc`, made with `DateTime.makeUnsafe('2027-05-02T07:30:00Z')`.

```text
the whole call
  run(packs, document, log)            -> Answer: ran | refused | malformed, as below
                                          each of the two as its text, or as a parsed value
  describe_issue(issue)                -> string: a decode failure, in words
  PACKS                                   the four dialects this build ships

the four calls of SPEC §4, and the log's
  parse_document(text)                 -> Result<CourseDocument, Issue>   the text's laws, then the per-field laws
  broken_laws(document)                -> {law, what}[]                   the document-only laws
  plan(document, packs)                -> Result<KernelRule[], NotRunnable>
  fold(rules, log)                     -> EntrantState[]                  the working state
  parse_log(text)                      -> Result<Observation[], Issue>
  broken_log_laws(log)                 -> {law, what}[]                   an id used twice

from a value a JSON parser already made: everything but the text's laws
  decode_document(json)                -> Result<CourseDocument, Issue>
  decode_log(json)                     -> Result<Observation[], Issue>
  broken_text_law(text)                -> {law, what, line} | null        the text's laws alone
  encode_state(state)                  -> the 13 members of SPEC §4.1, as run gives them
  total_ms(state)                      -> number | null

live and replay
  fold_until(rules, log, t)            -> EntrantState[]    over what is stamped at or before t
  positions_at(log, t)                 -> {entrant, along_m, between, last, done}[]
  order_at(positions)                  -> the same, leader first
  window_of(log)                       -> {from, to} | null  the first and last instant

before race day
  simulate(document, config)           -> Observation[]
  selectivity(rules, states)           -> {id_rule, sentence, fires_for, dormant_for, clauses}[]
  plan_at_pace(document, rules, {start_at, pace_s_per_km})
                                       -> {stops, standing, total_ms, awards, …} | null
  slowest_clear_pace(document, rules, start_at)
                                       -> s/km | null   even pace, no climb; 1500 is any pace

drawing a course
  summary_of(document, steps = 48)     -> {length_m, stated_m, ascent_m, descent_m, heights,
                                           ground: [from_m, to_m, material][], places}
  geodesic_m(from, to)                 -> metres on the WGS84 ellipsoid, [lon, lat] positions
  alongs_m(line)                       -> each position's metres along the line

making documents and logs
  document_of(course_file, options)    -> Result<CourseDocument, Issue>   see mats_along, laps_along
  bridge(reads, document, {bindings, drifts, debounce_ms})
                                       -> {observations, stranded, collapsed}
  self_timed(track, document, entrant, started_at, {tolerance: 0.15})
                                       -> {observations, refused}   track: [lat, lon, seconds][]
```

- **`run`** parses both files, plans the rules, checks the log and folds: three answers and no
  fourth. `malformed` is not a document or not a log, with what was expected and where (the quick
  start above shows one); `refused` is readable but not runnable; `ran` carries the states.
  Hand it the files' text. A string is always read as text; anything else is read as a value, and
  a value named `"pace-geojson"` twice in its file runs as whichever its parser kept.
- **`fold_until`** is the standings at an instant: the fold over the observations stamped at or
  before it. `positions_at` interpolates each entrant between their two reads either side of the
  instant (`between: true`) and places them by `along_m`, never by coordinates.
- **`simulate`**'s `config` has 13 members: `seed, entrants, start_at, pace_s_per_km, pace_spread,
  wave_gap_s, wave_size, mat_miss, read_jitter_s, dnf, flags, quantities, corral_s`. `ROAD` and
  `TRAIL` are complete configs less `start_at`: `simulate(document, { ...ROAD, start_at })`. The
  simulator is seeded (mulberry32, written out so another language can reproduce it) and sits
  outside the conformance surface. [rehearsal.md](rehearsal.md) shows it on the 10 km of [one-event.md](one-event.md).
- **`plan_at_pace`** runs one even-paced runner through the fold and returns the split table: every
  number in it comes from the fold. **`slowest_clear_pace`** bisects that one-runner fold rather
  than doing arithmetic on a rule, so it works for rules nobody has written yet. Neither reads
  climb.
- **`bridge`** is the reference bridge ([ts/src/bridge.ts](../ts/src/bridge.ts)): tag bindings
  bounded in time, one measured clock offset per device, a burst of reads collapsed to one
  observation stamped at the first sighting, and an unusable read returned _stranded_, with a
  reason, never dropped. It is not part of the conformance surface.
- **`summary_of`** is a course at a glance, from its document alone: what a list row, a map's
  preview or a share card draws. Each vertex's distance is measured from the geometry and laid on
  the document's own metres (a line the path runs whole is stretched to its end; one run in part is
  read in its measured metres); heights only where every position carries one; ground only where
  the `surface:` segments cover the course; the climb only as `pace:measure` states it. It is not
  part of the conformance surface.
- **`self_timed`** turns a recorded track (`[lat, lon, seconds]` per sample, latitude first) into
  one crossing of every place in the document, stamped where the runner had covered that share of
  their own track. It refuses a track whose length is more than 15 % off the course's; it does
  **not** check the route, so a training run of the right length passes. Its crossings include a
  `punched` at every `control`, so a watch upload cannot prove anyone was at a station.

### Depending on the package

It is `pace-geojson` on npm once published: ESM only, `dist/` JavaScript with `.d.ts`, and one peer
dependency, `effect` `^4.0.0-rc.111`. Effect 4 is a release candidate; the tests pass on rc.111 to
rc.117, and later 4.x releases fall inside the range untested. Until it is on npm, pack it and
install the tarball:

```sh
cd ts && npm ci && npm pack                          # pace-geojson-0.1.0.tgz; prepack builds dist/
npm install /path/to/pace-geojson-0.1.0.tgz effect   # in your project
```

A path dependency (`file:`, or `npm install` of the `ts/` directory) does not work: it links the
source directory, whose own `node_modules` holds a second copy of `effect`, or none. Nor does a
git dependency: npm cannot install a subdirectory of a repository, and the package needs a build.
A consumer that compiles with `skipLibCheck: false` needs `lib` to include `esnext`, plus `dom`
or `@types/node`, for Effect's own declarations.

## Rust

### Rust quick start

[rust/examples/quickstart.rs](../rust/examples/quickstart.rs).

```rust
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
```

### Rust calls

The crate `pace-geojson` ([rust/](../rust)); its only dependencies are `serde` and `serde_json`. From
another crate, depend on it by path or git until it is published
(`pace-geojson = { git = "https://github.com/turbotobias/pace-geojson" }`).

| call | does |
| --- | --- |
| `document::parse_document(text)` | a document from its text: the text's laws, then the per-field laws |
| `document::CourseDocument` | the decoded document. `serde_json::from_str` alone is the per-field laws and not the text's: it refuses a repeated member only where it has a field of that name |
| `CourseDocument::plan(&packs::all())` | the kernel rules, or every reason the document cannot be run |
| `CourseDocument::broken_laws()` | the cross-document laws |
| `observe::parse_log(text)` | a log from its text, the same way |
| `observe::Observation` | one log row; its `t` is an `observe::Instant`, its `source` the `SourceKind` enum |
| `observe::broken_log_laws(&log)` | an id used twice |
| `fold::fold(&rules, &log)` | every entrant's state |
| `fold::fold_until(&rules, &log, t_ms)` | the standings at a moment |
| `fold::EntrantState::encoded()` | the 13 members of [SPEC §4.1](../SPEC.md#41-the-entrant-state) |
| `text::broken_text_law(text)` | the text's laws alone: a member named twice, half a surrogate pair |
| `run::run(&packs::all(), document_json, log_json)` | the whole call in one, answering as the WebAssembly build does |
| `CourseDocument::summary(steps)` | a course at a glance, as `summary_of` reads it; `summary::SUMMARY_HEIGHTS` is 48 |
| `geodesic::geodesic_m(from, to)`, `geodesic::alongs_m(line)` | metres on the WGS84 ellipsoid, `[lon, lat]` positions |

A dialect's `Pack` lists in `placed` the kinds that need a place.

## WebAssembly

The crate `pace-geojson-wasm` ([wasm/](../wasm)) is the Rust engine for a browser or Node, about
480 KB, not yet run through `wasm-opt` (the optimiser the toolchain bundles refuses the module). It
has two functions, both JSON strings in and out: the same bytes the corpus is written in.
`dialects()` answers the dialect ids it ships. `run(document_json, log_json)` answers one of three,
the same three the TypeScript `run` gives, member for member:

```text
{"kind":"ran","states":[ <entrant state, SPEC §4.1>, … ]}
{"kind":"refused","why":{"unknown_version":null,"missing_dialects":[],
                         "refused":[{"id","dialect","kind","why"}],"broken":[{"law","what"}]}}
{"kind":"malformed","why":"<in the engine's own words>","broken":[{"law","what"}]}
```

A refused rule's `why` is one of `unknown dialect`, `unknown kind`, `needs a place` or
`parameters do not fit`. Whole milliseconds are written as integers.

The quick start, [wasm/quickstart.mjs](../wasm/quickstart.mjs), shown whole; a test checks that it
prints what its last lines say. For a browser, build with `--target web --out-dir pkg`, and
`await init()` before the first call.

```js
// The README's 10 km, folded by the Rust engine compiled to WebAssembly.
// Build it once: `wasm-pack build wasm --target nodejs --out-dir pkg-node --release`.
// Then, from the repository root: `node wasm/quickstart.mjs`.
import { readFileSync } from 'node:fs'
import { dialects, run } from './pkg-node/pace_geojson_wasm.js'

const say = (line) => process.stdout.write(`${line}\n`)
const read = (path) => readFileSync(path, 'utf8')

say(dialects()) // the dialects this build can run
const answer = JSON.parse(run(read('examples/10k/document.json'), read('examples/10k/log.json')))
// { kind: 'ran', states } | { kind: 'refused', why: { refused, broken, … } } | { kind: 'malformed', why, broken }
if (answer.kind !== 'ran') say(`${answer.kind}: ${JSON.stringify(answer.why)}`)
for (const s of answer.states ?? []) {
  say(`${s.entrant} ${s.standing} ${s.total_ms} ${JSON.stringify(s.awards)}`)
}

// $ node wasm/quickstart.mjs
// ["athletics@1","backyard@1","orienteering@1","triathlon@1"]
// ent_ana clean 2790000 ["sub-50"]
// ent_ben gated 5100000 []
// ent_cy penalised 3240000 []
// ent_dee clean 2880000 ["sub-50"]
// ent_eve disqualified 3300000 []
```

## Registry names

Once they are published, the registry names will be the crate `pace-geojson`, the crate
`pace-geojson-wasm` and the npm package `pace-geojson`. None of them exists on a registry today.
