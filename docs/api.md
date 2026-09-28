# API

Every call the TypeScript package, the Rust crate and the WebAssembly build export, with what goes
in and what comes out. [SPEC §4](../SPEC.md#4-the-boundary) is the normative boundary; this page is
the map of it.

## TypeScript

From `sport-lang` (each module also at `sport-lang/<module>`, such as `sport-lang/fold` or
`sport-lang/packs/athletics`). Documents and logs go in as parsed JSON (`unknown`); a `Result` is
Effect's; every instant is a `DateTime.Utc`, made with
`DateTime.makeUnsafe('2027-05-02T07:30:00Z')`.

```text
the whole call
  run(packs, document, log)            -> Answer: ran | refused | malformed, as below
  describe_issue(issue)                -> string: a decode failure, in words
  PACKS                                   the four dialects this build ships

the four calls of SPEC §4, and the log's
  decode_document(json)                -> Result<CourseDocument, Issue>   the per-field laws
  broken_laws(document)                -> {law, what}[]                   the document-only laws
  plan(document, packs)                -> Result<KernelRule[], NotRunnable>
  fold(rules, log)                     -> EntrantState[]                  the working state
  decode_log(json)                     -> Result<Observation[], Issue>
  broken_log_laws(log)                 -> {law, what}[]                   an id used twice
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

making documents and logs
  document_of(course_file, options)    -> Result<CourseDocument, Issue>   see mats_along, laps_along
  bridge(reads, document, {bindings, drifts, debounce_ms})
                                       -> {observations, stranded, collapsed}
  self_timed(track, document, entrant, started_at, {tolerance: 0.15})
                                       -> {observations, refused}   track: [lat, lon, seconds][]
```

- **`run`** decodes both files, plans the rules, checks the log and folds: three answers and no
  fourth. `malformed` is not a document or not a log, with what was expected and where; `refused`
  is readable but not runnable; `ran` carries the states. A document missing
  `sport:measure.ascent_threshold_m`, for instance, is `malformed` with
  `the document did not decode: Missing key` at `["sport:measure"]["ascent_threshold_m"]`.
- **`fold_until`** is the standings at an instant: the fold over the observations stamped at or
  before it. `positions_at` interpolates each entrant between their two reads either side of the
  instant (`between: true`) and places them by `along_m`, never by coordinates.
- **`simulate`**'s `config` has 13 members: `seed, entrants, start_at, pace_s_per_km, pace_spread,
  wave_gap_s, wave_size, mat_miss, read_jitter_s, dnf, flags, quantities, corral_s`. `ROAD` and
  `TRAIL` are complete configs less `start_at`: `simulate(document, { ...ROAD, start_at })`. The
  simulator is seeded (mulberry32, written out so another language can reproduce it) and sits
  outside the conformance surface. [rehearsal.md](rehearsal.md) shows it on the README's 10 km.
- **`plan_at_pace`** runs one even-paced runner through the fold and returns the split table: every
  number in it comes from the fold. **`slowest_clear_pace`** bisects that one-runner fold rather
  than doing arithmetic on a rule, so it works for rules nobody has written yet. Neither reads
  climb.
- **`bridge`** is the reference bridge ([ts/src/bridge.ts](../ts/src/bridge.ts)): tag bindings
  bounded in time, one measured clock offset per device, a burst of reads collapsed to one
  observation stamped at the first sighting, and an unusable read returned _stranded_, with a
  reason, never dropped. It is not part of the conformance surface.
- **`self_timed`** turns a recorded track (`[lat, lon, seconds]` per sample, latitude first) into
  one crossing of every place in the document, stamped where the runner had covered that share of
  their own track. It refuses a track whose length is more than 15 % off the course's; it does
  **not** check the route, so a training run of the right length passes. Its crossings include a
  `punched` at every `control`, so a watch upload cannot prove anyone was at a station.

### Depending on the package

It is `sport-lang` on npm once published: ESM only, `dist/` JavaScript with `.d.ts`, and one peer
dependency, `effect` `^4.0.0-rc.111`. Effect 4 is a release candidate; the tests pass on rc.111 to
rc.117, and later 4.x releases fall inside the range untested. Until it is on npm, pack it and
install the tarball:

```sh
cd ts && npm ci && npm pack                           # sport-lang-0.1.0.tgz; prepack builds dist/
npm install /path/to/sport-lang-0.1.0.tgz effect      # in your project
```

A path dependency (`file:`, or `npm install` of the `ts/` directory) does not work: it links the
source directory, whose own `node_modules` holds a second copy of `effect`, or none. Nor does a
git dependency: npm cannot install a subdirectory of a repository, and the package needs a build.
A consumer that compiles with `skipLibCheck: false` needs `lib` to include `esnext`, plus `dom`
or `@types/node`, for Effect's own declarations.

## Rust

The crate `sport-lang` ([rust/](../rust)); its only dependencies are `serde` and `serde_json`. From
another crate, depend on it by path or git until it is published
(`sport-lang = { git = "https://github.com/turbotobias/sport-lang" }`).

| call | does |
| --- | --- |
| `document::CourseDocument` | the decoded document; `serde_json::from_str` is the per-field laws |
| `CourseDocument::plan(&packs::all())` | the kernel rules, or every reason the document cannot be run |
| `CourseDocument::broken_laws()` | the cross-document laws |
| `observe::Observation` | one log row; its `t` is an `observe::Instant`, its `source` the `SourceKind` enum |
| `observe::broken_log_laws(&log)` | an id used twice |
| `fold::fold(&rules, &log)` | every entrant's state |
| `fold::fold_until(&rules, &log, t_ms)` | the standings at a moment |
| `fold::EntrantState::encoded()` | the 13 members of [SPEC §4.1](../SPEC.md#41-the-entrant-state) |
| `run::run(&packs::all(), document_json, log_json)` | the whole call in one, answering as the WebAssembly build does |

A dialect's `Pack` lists in `placed` the kinds that need a place.

## WebAssembly

The crate `sport-lang-wasm` ([wasm/](../wasm)) is the Rust engine for a browser or Node, about
430 KB, not yet run through `wasm-opt` (the optimiser the toolchain bundles refuses the module). It
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
import { dialects, run } from './pkg-node/sport_lang_wasm.js'

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

Once they are published, the registry names will be the crate `sport-lang`, the crate
`sport-lang-wasm` and the npm package `sport-lang`. None of them exists on a registry today.
