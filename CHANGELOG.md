# Changelog

Every change to the format, the engines or the corpus, newest first. The format follows Keep a
Changelog 1.1.0; versions follow Semantic Versioning 2.0.0. A wire change is a spec change, and a
spec change lands in both engines and the corpus in the same release, or not at all. Until the
first release is tagged, format version 1 may still change what it means; from that tag it is
frozen (`SPEC.md §7`).

## 0.1.0 — unreleased

The first public release: a race's rules as data, and two engines that agree on what they mean.
The format is pace-geojson; a document in an earlier pre-release namespace is rejected, never
aliased (`"racejson": 1` with `race:*`, or `sport:version` with `sport:*`).

### Added

- **The format, `pace-geojson` 1.** A course document is a stricter profile of GeoJSON: any map
  tool draws it, and a document a given engine cannot run still draws. It carries the line, the
  places along it in integer metres (`along_m`), the path as a playlist of line slices with
  `repeat` (a lapped course is a playlist, not a copy), how the course was measured
  (`pace:measure`), where the geometry came from (`pace:provenance`, whose `source` is
  `unstated` when nobody said), and the rules (`pace:rules`). The wire namespace is `pace:`;
  see `SPEC.md`. `pace-geojson` is an integer ≥ 1, and a document of a version an engine does
  not run draws and is refused by name (`unknown_version`), never run as version 1.
- **The observation log, with one law.** Every member of an observation is present. An instant
  is exactly `YYYY-MM-DDTHH:MM:SSZ` or `…SS.sssZ`, on a day the calendar has, with no leap
  second; an offset is refused rather than converted. An observation id is unique within a log
  (`an observation id is used twice`), because it breaks ties and is what a correction names.
- **Four dialects, eleven rule kinds.** A dialect is a named, versioned set of rule kinds, each
  with a parameter schema, an expansion into kernel terms and the sentence an entrant reads.
  - `athletics@1` — `cutoff_at`, `cutoff_within`, `qualifies_within`, `station_required`,
    `no_outside_help`
  - `triathlon@1` — `drafting`, `transition_neutral`, `wetsuit_limit`
  - `orienteering@1` — `controls`
  - `backyard@1` — `lap_within`, `last_standing`

  An unknown dialect or kind makes a document readable but not runnable. It is never skipped:
  silently dropping a rule is how a timing system disqualifies the wrong person. A rule is
  refused for one of four reasons, in these words: `unknown dialect`, `unknown kind`,
  `needs a place` (a `station_required` or `qualifies_within` bound to no place) and
  `parameters do not fit` (including parameters that are not a JSON object). Every kind's
  sentence says what its expansion does: `qualifies_within` is bound to the finish and needs a
  `finished` read there inside the time, so a runner still out, one who withdrew, or one who
  stopped after two laps of four is not awarded; `drafting` penalises once per fold; and
  `station_required` with `each_time: true` adds nothing, because `each_time` counts
  observations matching an `observed` clause, not offences (`SPEC.md §3.4`).
- **The kernel: 9 atoms, 5 consequences.** Atoms `observed`, `order`, `clock`, `count`,
  `quantity`, `flag`, `standing`, `withdrawn`, `field`; consequences `adjust_time`,
  `set_standing`, `classify`, `award`, `neutralise`. Standing only worsens
  (`clean < penalised < gated < disqualified`). A rule reading the field sits in stratum 1 and
  sees only lower strata, so no rule can depend on itself. Integer milliseconds and metres (a
  convention neither engine yet enforces at decode), no floating-point accumulation in any
  decision, no recursion, no user-defined functions, no clock or IO.
- **The entrant state, defined.** Thirteen members per entrant — `entrant`, `standing`,
  `started_at`, `finished_at`, `withdrew`, `total_ms`, `adjustment_ms`, `neutralised_ms`,
  `laps`, `punches`, `awards`, `classes`, `applied` — with each firing's sentence in `applied`,
  and how to read a finisher, a non-finisher and a non-starter from them (`SPEC.md §4.1`).
  Placing is left to whoever publishes the results.
- **One call, three answers.** `run(dialects, document, log)` in both engines answers `ran` with
  every entrant state, `refused` with the structured reasons, or `malformed` with what was
  wrong, in the same shape member for member (`SPEC.md §4.2`).
- **Two engines.** A TypeScript package (`ts/`, npm name `pace-geojson`, on Effect and Effect
  Schema) and a Rust crate (`rust/`, `pace-geojson`), written from the specification and the
  corpus rather than translated from the TypeScript, so a disagreement is a spec ambiguity found
  rather than one copied.
  - TypeScript: `run`, `describe_issue` (a decode failure in words), `decode_document`, `plan`,
    `broken_laws`, `Log`, `decode_log`, `encode_log`, `broken_log_laws`, `fold`,
    `EntrantState`, `encode_state`, `AppliedRule`, `total_ms`, `Instant`, `rule_kind`,
    `rule_kind_at` (a kind that needs a place), `is_place`, `PACKS`; `fold_until`,
    `positions_at`, `order_at`, `window_of`; `simulate`, `ROAD`, `TRAIL`, `selectivity`;
    `plan_at_pace`, `slowest_clear_pace`; `CourseFile`, `document_of`, `mats_along`,
    `laps_along`; `bridge`, `self_timed`. `docs/api.md` summarises each call's inputs and output.
  - Rust: `run::run`, `document::CourseDocument` (`plan`, `broken_laws`), `observe::Observation`
    (whose `t` is an `observe::Instant`, and whose `source` is the `SourceKind` enum),
    `observe::broken_log_laws`, `fold::fold`, `fold::fold_until` and
    `fold::EntrantState::encoded`. A dialect's `Pack` lists in `placed` the kinds that need a
    place.
  - Packaging: ESM only, `dist/` JavaScript with `.d.ts`, one peer dependency
    (`effect` `^4.0.0-rc.111`; the tests pass on rc.111 to rc.117). `prepack` builds and refuses
    an exports map that points at a missing file. The npm tarball and both crates carry
    `LICENSE` and `NOTICE`.
- **A WebAssembly build** (`wasm/`, `pace-geojson-wasm`): the Rust engine behind
  `run(document_json, log_json)` and `dialects()`, both returning JSON, so a browser folds with the
  same engine a native program links. A refusal is structured, and a whole number of
  milliseconds is written as an integer.
- **A fold that grows with the log, not the log times the field.** Both engines settle the log with
  one sort and partition it by entrant in one pass, never scanning the log per entrant, and the
  replay (`fold_until`, `positions_at`) shares that partition. `ts/scripts/bench.ts` times `run`
  in both engines on a simulated marathon, from the JSON a host receives to the encoded answer
  (Apple M1 Max, Node 26.10, median of three, on a busy machine): 10 000 entrants in 0.64 s in
  TypeScript and 0.26 s in WebAssembly, and 30 000 in 2.4 s and 0.96 s, where a per-entrant scan
  of the log took 87 s and 64 s for 10 000. The two engines' answers are identical, digest for
  digest. `ts/test/fold.test.ts` holds the line without a clock: at 500 entrants, `fold`,
  `fold_until` and `positions_at` each read at most four entrant ids per observation, where the
  scan read over two million in all.
- **The corpus, which is the specification.** 19 conformance cases covering 104 entrant states
  (document + observation log + expected result per entrant) and reaching every kind of every
  dialect, including a pair locking the cut-off edge — an entrant at exactly the clearing pace
  finishes, one a second per kilometre slower is gated — a qualifying time on a lapped course,
  and the README's own race. 43 decode cases (10 accept, 16 reject, 17 refuse; six of them also
  judge a log) pin what a reader must accept, reject or refuse, and why. 7 synthetic courses,
  from a flat half marathon to a 500 km ride and a 6 720 m backyard loop, feed the generators in
  `ts/scripts/`.
- **Two differential sweeps** through both engines. One folds generated fields — with officials'
  flags and a measured water temperature — and compares the whole answer: 44 fields,
  1 100 entrant states, 0 disagreements. The other damages a lawful document and log 176 ways
  and compares the verdicts: 0 disagreements.
- **JSON Schemas** of the document, the observation and the entrant state in `schema/`,
  generated from the TypeScript schema, for tools that validate without running either engine.
- **A reference bridge** (`ts/src/bridge.ts`): raw reads from mats and devices, time-bounded tag
  bindings and one measured clock offset per device in; the observation log out. Everything
  with IO lives on this side of the line — the language itself never touches a transponder.
  `self_timed` turns a watch track into a crossing of every place, and refuses a track whose
  length is more than 15 % off the course's; it does not check the route.
- **A simulator** (`ts/src/simulate.ts`): a seeded, deterministic ghost field to rehearse a
  document's rules before race day, and to ask how much of a field a cut-off would end.
- **Pacing queries** (`ts/src/pacing.ts`): `plan_at_pace` gives the split table for a target
  pace; `slowest_clear_pace` answers "what even pace clears every cut-off?" by folding a
  one-entrant log. Neither reads climb.
- **Replay** (`ts/src/replay.ts`): the standings at any instant are the fold of the log up to that
  instant — no second, incremental engine to drift from the first.
- **What is underfoot, as segments.** SPEC §2.2 defines the one segment-kind family,
  `surface:<material>` (`paved`, `cobbles`, `gravel`, `trail`, `sand`, `track`, `water`, `unknown`,
  with `:inferred` when the material was read off something other than a statement of it), so two
  writers say the same ground the same way; a document that carries any covers its whole path. The
  builder's `document_of` takes `segments` and draws each as the slice of the line between its path
  distances, across laps. Segment kinds stay descriptive: nothing folds or plans them.
- **A worked example** (`examples/10k/`): a 10 km with four rules and five runners that end in all
  four standings, folded by both engines in CI, and quick starts in Rust
  (`rust/examples/quickstart.rs`), TypeScript (`ts/examples/quickstart.ts`) and WebAssembly
  (`wasm/quickstart.mjs`) whose printed output is tested, including what the TypeScript one
  prints for a broken document.
- **Documentation.** The README is the front door, short on purpose: what the format does, a
  picture of how it works (light and dark, `docs/assets/`), what / why / so what folded under
  `<details>`, one rule, one read and one verdict from the worked 10 km, and where to go next. The
  rest lives in `docs/`: `why.md` (the failures the format is built around, and what each reader
  does with it), `one-event.md` (the 10 km end to end: result, document, log, late read, live
  standings, positions, the what-if, the pace, refusals), `data-model.md`, `api.md` (every call,
  and the Rust, TypeScript and WebAssembly quick starts), `results.md` (reading a result),
  `rules.md` (every kind and the kernel), `rehearsal.md`, `implementing.md` (the functions, the
  corpora, the definitions most often read differently), `scope.md`, `guarantees.md` (the
  guarantees and conformance) and `known-gaps.md`. A test holds every page's JSON to the file it
  quotes, every quick start to what it prints, the README's picture to the engine's answers, every
  count of the corpus to the corpus, and every relative link and picture to a file and heading
  that exist. The npm tarball's README points every link and picture at GitHub, since npmjs.com
  cannot resolve them against `ts/`.
