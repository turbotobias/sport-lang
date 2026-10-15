# Known gaps

What version 1 cannot say or does not check, stated here so nobody has to find it. Each is either a
deliberate boundary or open work; a contribution that closes one lands as a corpus case.

- **Gun time.** There is one clock per entrant, net time from their own first `started`. For
  gun time, the bridge writes a `started` at the gun for every entrant; publishing gun and net
  side by side takes two folds. A missed start read leaves `total_ms` null, and with it every
  elapsed limit and qualifying time, so a bridge should write the start from the gun or the
  corral and say so in `source`. A document-level gun instant would be a new format version.
- **Wave starts under a wall-clock gate.** `cutoff_at` is one instant for everybody, so a later
  wave meets it earlier in its own race. Use `cutoff_within`, which runs from each entrant's own
  start, or give each wave its own document. A gate per wave is not expressible yet.
- **Entrants have no attributes.** Age groups, gender categories and results by category, relays
  and teams, and stage races or multi-day totals are all outside version 1. `classify` exists in
  the kernel, but no kind uses it and nothing feeds it registration data.
- **A log is per document.** Observations name no way or document; a bridge serving several
  distances on shared mats sends each entrant's reads to the document of the distance they entered.
- **An official's unforeseen decision.** An official can flag what a dialect reads
  (`outside_help`, `wetsuit`, `overtaking`), and any row can be corrected with `supersedes`. A
  disqualification or time penalty for a reason no kind names, such as a bib swap or littering,
  cannot be recorded, and a correction carries no author, authority, reason or time of its own.
  Until a dialect for officials' decisions exists, those records belong to the bridge.
- **`self_timed` checks length, not route.** A route check means map-matching the track to the
  line; it is not written.
- **Clock drift over a long day.** The reference bridge applies one measured offset per device.
  A drift rate, a resync mid-race, and reading `received_t` or signal strength are the
  integrator's.
- **No certificate reference.** `certified_m` is a number; the certifying body, certificate id
  and date are not carried. `pace:provenance` could hold them.
- **Pacing ignores climb.** `plan_at_pace` and `slowest_clear_pace` run one even-paced runner.
- **`each_time` counts observations, not offences.** It multiplies a penalty by the matches of the
  rule's `observed` clauses ([SPEC §3.2](../SPEC.md#32-the-kernel), *occurrences*), and 1 when
  there are none. So `station_required` with `each_time: true` fires for a missed station and adds
  nothing, because its one such clause is the punch that was not found. `drafting`, which has no
  such clause, penalises **once** per fold, judged on the first entry to the zone and the first
  exit; a second pass is not a second offence. Both sentences say exactly that, and
  `each-time-counts-what-the-predicate-observes` pins both. Counting offences would be a new
  meaning, so it waits for a new dialect major ([SPEC §3.4](../SPEC.md#34-the-dialects-of-version-1)).
- **A withdrawal before a required station counts as a miss.** Withdrawing ends the day, and
  dormancy with it ([SPEC §3.2](../SPEC.md#32-the-kernel)), so `station_required` penalises a
  runner who stopped before its place. This is as specified; [the rehearsal](rehearsal.md) shows
  it in 13 of 28 penalties.
- **Whole numbers are a convention.** Times and distances are integer milliseconds and metres by
  convention; neither engine enforces it at decode. Only `pace-geojson` and a backyard `lap` are
  checked as integers. A fraction is folded as the double it is — the one nearest to what is
  written, in both engines, however many digits that is
  ([SPEC §1](../SPEC.md#1-what-is-portable-and-what-is-not)). They write the same number back
  up to 2⁵³ − 1; past it, see the next entry but one.
- **A value has lost what its text did.** The two laws of the text
  ([SPEC §2](../SPEC.md#2-the-data)) — no member named twice, no half of a surrogate pair — are
  checked by `parse_document`, `parse_log` and a `run` handed text, in both engines. A host that
  parses a file itself and hands over the value (`decode_document`, `decode_log` or a `run`
  handed values in TypeScript; `serde_json::from_str::<CourseDocument>` in Rust) is past the
  point where a repeated member can be seen: its parser kept one of the two. Everything else is
  still checked. Hand over the text.
- **Where the two engines still differ.** Four places, none of them in a file a producer writes:
  the order of two ids when one holds a character from U+E000 to U+FFFF and the other a
  character past U+FFFF; a number no double holds (`1e999`), and nesting 128 deep, inside a
  rule's `at` or `params` or a feature's `geometry` or `properties`; and a whole number past
  2⁵³ − 1, written out differently. [SPEC §5a](../SPEC.md#5a-two-engines-one-author) says what
  each engine does with each, and `ts/test/differential.test.ts` holds the list: it fails the
  day one of them stops being true.
- **One corpus case holds the nearest double, and only its far end.** A decimal of sixteen
  digits or more is read as the same number by both engines, and the differential test sweeps
  for it; that test needs both engines. The corpus holds a third implementation to one such
  number, the largest double written long (`accepts-the-largest-double-written-long`), and to
  none that a quicker reader gets a step out: a conformance case carries its files as values,
  and a value has lost how its number was written. The corpus has 66 other decimals that long,
  every one a position, and no position reaches an answer.
- **The kernel reaches further than the dialects.** Every kind has its case, but no shipped kind
  uses the `moving` clock, `classify`, a `count` of anything but laps, or the `rank`, `finishers`
  and `winner_elapsed` aggregates, so no case pins them ([SPEC §5](../SPEC.md#5-conforming)).
- **Every read folds the whole log again.** That is by design: replay is the fold of a prefix,
  and an engine may not keep an incremental state that could disagree with it
  ([SPEC §3.2](../SPEC.md#32-the-kernel), _Replay_). Both engines settle the log with one sort,
  partition it by entrant in one pass, and then work entrant by entrant, so a fold grows with the
  log, not with the log times the field. A simulated marathon (`corpus/courses/marathon.json`,
  seed 7, a mat every 5 km and the five `athletics@1` kinds), from the two texts a host receives
  to the encoded answer — the laws of the text checked on the way in — median of three on an
  Apple M1 Max under Node 26.10:

  | entrants | observations | TypeScript `run` | WebAssembly `run` | TypeScript `fold_until` |
  | ---: | ---: | ---: | ---: | ---: |
  | 1 000 | 8 850 | 0.06 s | 0.03 s | 0.01 s |
  | 10 000 | 88 024 | 0.62 s | 0.27 s | 0.14 s |
  | 30 000 | 263 872 | 2.1 s | 1.0 s | 0.50 s |

  Ten times the field takes about ten times as long in `run`, and three times about three and a
  half. The machine was busy while these were taken (a load average above 30), so read them as
  scale, not as a record. `node --expose-gc ts/scripts/bench.ts` reproduces the table with a
  digest of each answer, and the TypeScript and WebAssembly digests match. What stays open is the
  cost per read: a live view of a mass field should fold once per batch of arrivals, not once
  per observation.
- **Geometry.** Building a document from a line (`at_along`, `mats_along`, `laps_along`, and how
  `pace:measure` is computed) has tests but no normative corpus.
- **Sports.** There is no dialect yet for ski, paddle or rowing.
- **`wasm-opt`** is off, because the optimiser the toolchain bundles refuses the module.
