# Why a format

Today an event's rules live in three places that disagree: the organiser's PDF, each timing vendor's
configuration, and whatever the results page printed. Every media partner gets its own export, a
re-score after a protest or a late upload is keyed in again by hand, and a cut-off implemented
twice can be implemented two ways. This page is the failures that follow, and what each reader of
a pace-geojson file does with it instead.

## The failures it is built around

- **A reader that does not know a rule drops it.** So an unknown dialect or kind, parameters that do
  not fit, or a broken cross-reference make a document **readable but not runnable**: it still
  draws, and no engine scores it. _Silently dropping a rule is how a timing system disqualifies the
  wrong person._
- **A rule nobody can satisfy passes every per-field check.** A _punch_ required where the place
  only records a _pass_ can never be met, yet the point exists, its id is unique and its distance in
  range. It happened three times while the language was built: once a rehearsal penalised 194 of
  200 simulated entrants, and last time twelve of twelve runners were penalised for a station nobody
  could have punched. It is now a law checked before anything runs
  ([SPEC §2.1](../SPEC.md#21-the-course-document)).
- **"How long is the course?" has several honest answers.** A sphere is out by a few tenths of a
  percent against WGS84, in either direction with latitude and bearing: over 100 m on a marathon,
  more than a kilometre on a 500 km ride. One file's climb varies almost fourfold with smoothing and
  threshold alone. So every distance carries its method, and what was sold (`stated_m`), what a
  record uses (`certified_m`) and what a pacing plan uses (`distance_m`) are kept apart.
- **A coordinate is ambiguous exactly where the mats are.** A course that doubles back has two
  places at one latitude and longitude, but only one at 31 400 m. So everything is addressed by
  `along_m`, the address timing systems already use.

None of these can be fixed by a better product. They need a shared format with one meaning, and a
function anyone can run over it.

## What each reader gets

| you are | what the format gives you |
| --- | --- |
| **a timing company** | Keep your hardware and your bridge; emit each observation as one 12-field JSON row. Read each event's rules from its file instead of hand-keying them, re-score a protest or a late read by appending a row, and prove your engine against [the corpus](implementing.md). Publish data, not an API. |
| **an organiser** | Write the rules once, in a file every vendor runs the same way, [rehearse them](rehearsal.md) against a simulated field before race day, and switch vendors without rewriting a rule. |
| **media, results sites, apps** | Live standings, a replay to any millisecond, and the reason for every penalty, from the same two files the official result comes from: one feed, not an export per partner ([reading a result](results.md)). |
| **watch and app makers** | A split table at any pace, the slowest even pace that clears every cut-off, and a runner's own watch track turned into crossings of the course ([API](api.md)). |
| **federations, record-keepers** | The course length with the method that measured it, kept apart from the stated and the certified length, and a result anyone can re-derive from two files years later. |

## What each reader does with it

<details>
<summary><b>Per reader</b> — the calls and members each one uses</summary>

**Timing systems** keep their hardware and bridge and emit one 12-field observation shape. They
read the organiser's rules from the document, not a PDF, and run them as every other vendor does;
re-fold after every late upload, reader failure or protest, which is cheap and exact because a
correction supersedes instead of editing; and show the `applied` sentences at the results desk, so
a protest argues with a sentence, not a config screen
([the bridge's part](implementing.md#the-bridge-is-yours), [a reference bridge](../ts/src/bridge.ts)).

**Organisers** publish the rules as data next to the course, each with the sentence an entrant
reads; [rehearse](rehearsal.md) them against a simulated field; put the slowest even pace that
clears every cut-off on the entry page, saying on a hilly course that it ignores climb; and write a
wave start's limits as `cutoff_within`, which runs from each entrant's own start.

**Media, broadcast and apps** take the document and the log, not a bespoke results API. The fold up
to _t_ is the standings at _t_ and scrubbing to the end gives exactly the result, so a live board
and the official result cannot disagree; `positions_at` places everyone by `along_m`; every penalty
carries its sentence, so a graphic can say _why_. Finishers, DNF, DNS, placings, gun and net time:
[results.md](results.md).

**Watch and app makers** load one document per distance. `plan_at_pace` gives a split table in which
every number comes from the fold; `self_timed` turns a recorded track into a crossing of every
place, checking its length (within 15 %) but not its route.

**Federations and record-keepers** read how the length and climb were measured (`pace:measure`,
`certified_m` apart from `stated_m`) and each original's source, URL, sha256 and verifier
(`pace:provenance`), and can re-derive a result years later from the document and the log.

</details>

The whole of it on one race: [one event, end to end](one-event.md).
