# Implementing it in another language

What a third engine has to provide, the order in which to prove it, and the definitions two
implementations most often read differently. [SPEC.md](../SPEC.md) and the corpus are normative;
this page is the route through them.

## The functions

A host provides these total functions, and none of them performs IO
([SPEC §4](../SPEC.md#4-the-boundary)):

```
parse_document(bytes)             -> Document | ParseError       laws of the text, per-field laws
laws(document)                    -> [BrokenLaw]                 cross-document laws
plan(document, dialects)          -> [KernelRule] | NotRunnable  expand kinds; refuse, never skip
parse_log(bytes)                  -> [Observation] | ParseError  laws of the text, per-field laws
log_laws([Observation])           -> [BrokenLaw]                 an id used twice
fold([KernelRule], [Observation]) -> [EntrantState]              settle, absorb, strata
```

Four of them are the document's path (parse, laws, plan, fold); the two log calls mirror the
document's. `plan` has two outcomes and no third: kernel rules, or _not runnable_ with an
`unknown_version`, `missing_dialects`, `refused` rules and `broken` laws. There is no "run what
you understood", and no running a version-2 document as version 1.

## What is rejected, refused or malformed

A document is **rejected at parse** if its text breaks a law of the text (below), if a member is
missing or has the wrong type, or if it breaks a per-field law of
[SPEC §2.1](../SPEC.md#21-the-course-document): a longitude outside ±180 or a
latitude outside ±90; a `LineString` of fewer than 2 positions; a negative `along_m`, `from_m` or
`to_m` on a point, segment or path slice; `repeat` < 1; a `pace-geojson` that is not an integer
≥ 1; or a role with the wrong geometry ([§2.2](../SPEC.md#22-features)). It is **readable but not
runnable** if its version is not one the engine runs (this is version 1); if a rule does not
compile, because its dialect or kind is unknown, its `params` do not fit, or a kind that needs a
place is bound to none; or if it breaks one of the 8 cross-document laws:

- a duplicate feature id;
- a segment that does not end after it starts;
- a path slice that does not end after it starts;
- a path naming an absent line;
- a place beyond the path's length;
- a rule naming an absent point;
- no line at all;
- a rule requiring an observation its place never produces.

A log is **malformed** if its text breaks a law of the text, an observation does not decode, or an
id is used twice.

### The text, before the members

Two laws are about the file's characters ([SPEC §2](../SPEC.md#2-the-data)), and they are the two
your JSON library most likely decides for you without saying:

- **No object names a member twice**, at any depth, whether you read the member or not. Most
  parsers keep the last of two; some keep the first. Either way your engine would be running a
  file another engine reads differently, so it must be refused. Names are compared after their
  escapes are resolved (`"pace:way"` and `"pace:\u0077ay"` are one name) and not normalised
  further.
- **No string holds half a surrogate pair** (`"\ud83d"` with no low half after it), in a name or
  a value. A language whose strings are UTF-16 will hold it; one whose strings are Unicode will
  not.

Check both on the text, before or beside your parser. Many JSON libraries can be made to refuse
or report a repeated name (Jackson's `STRICT_DUPLICATE_DETECTION`, a pairs hook in Python's
`json`); failing that, the short scan both engines here use does it — one pass over the
characters, tracking which string is a name (`ts/src/text.ts`, `rust/src/text.rs`). **A value
your parser has already made cannot show the first**, so `parse_document` and `parse_log` take
bytes, and ten decode cases carry their file as a string (`document_text`, `log_text`) for you to
parse exactly as written. An eleventh does for a number: `accepts-the-largest-double-written-long`
(below, under Arithmetic).

## The order to pass the corpora

1. [corpus/decode/](../corpus/decode): parse and laws. 54 cases, each a verdict (accept, reject,
   refuse) and, for a refusal, the laws broken, the missing dialects, each refused rule with its
   reason, and a version the engine does not run.
2. [corpus/conformance/](../corpus/conformance): plan and fold. 19 cases, 104 entrant states; every
   kind of every dialect is reached.
3. [corpus/summary/](../corpus/summary): a course at a glance. 8 cases; not part of running a race,
   and what every reader that draws a course in miniature should agree on.
4. Fold simulated fields beside the WebAssembly `run` ([api.md](api.md#webassembly)) and compare
   the whole answer. Every disagreement is either a bug or an ambiguity in the spec, and both
   become a case.

The Rust engine is about 2 700 lines, comments included, and that is the size to expect.

## The corpora

| corpus | holds | asserts |
| --- | --- | --- |
| [corpus/conformance/](../corpus/conformance) | 19 cases, 104 entrant states: 11 written by hand ([one event, end to end](one-event.md) among them), 8 generated on synthetic courses. Every kind of every dialect is reached, `controls` in both orders, and both runners fail if one is not | `{name, why, document, log, expect[]}`. Every entrant's `standing, total_ms, adjustment_ms, awards, laps` must match, with no extra entrants and none missing |
| [corpus/decode/](../corpus/decode) | 54 cases: 14 accept, 23 reject, 17 refuse. Eight of the accepted documents carry a log with its own verdict: 1 accepted, 6 rejected, 1 refused. Eleven carry a file as its text (`document_text` or `log_text`) where the rest carry a value | the verdict, and for a refusal the laws broken, the missing dialects, each refused rule with its reason, and a version the engine does not run |
| [corpus/summary/](../corpus/summary) | 8 cases on the synthetic courses, each varying one thing a reader of a course gets wrong: laps, no heights, ground that covers the course and ground that does not, a material outside the family, a long ride, another number of steps | `{name, why, steps, document, expect}`. The length, the measure, the ground and the places must match exactly, and every height to the tenth of a metre it is written to (in rows of eight) |
| [corpus/courses/](../corpus/courses) | 7 synthetic courses: half marathon flat and hilly, marathon, 50 km trail, 500 km ride, a 6 720 m loop, 44 km road | the inputs to the generators in [ts/scripts/](../ts/scripts). They sit in open sea within two degrees of 0° N 0° E, so they are obviously synthetic and freely licensable |

Each case's `why` says what it pins. For example: _"one withdraws at 25 km and stays clean —
withdrawing is not a standing, and a cut-off it never reached does not gate it."_ The `expect` of a
generated case is what the reference produced. That makes it the contract, not a claim of
independent truth, and the hand-written cases keep that from going unnoticed.

The differential sweep ([ts/test/differential.test.ts](../ts/test/differential.test.ts)) was
checked by breaking the Rust on purpose so that a standing could never worsen. On the smaller sweep
of that day it reported 440 disagreements in 900 states, each named by entrant and field.

## The definitions most often read differently

[SPEC §3.2](../SPEC.md#32-the-kernel) states each one exactly.

- **At a place:** the same `point` id when both sides have one, and otherwise `|Δ along_m| ≤ 10`.
- **Elapsed:** finish − start, or last observation − start when there is no finish, where start
  is the entrant's own first `started`. It is null without one. **Moving** = elapsed −
  neutralised. **Total** = moving + adjustment.
- **Dormancy:** a rule bound to a place does not apply until the entrant is seen within 10 m of it
  or beyond, finishes, or withdraws. A rule bound to a span, or to nothing, is never dormant.
- **`each_time`** multiplies by the most matches of any `observed` clause, and otherwise by 1. It
  counts observations, not offences, so a rule that fired because a punch was missing adds 0.
  **Laps** counts `finished`. **Punches** counts `punched`.
- **`neutralise`** uses the **first** observation at each end, and adds 0 when either is missing.
- **Remaining** counts entrants who have not withdrawn and are neither gated nor disqualified.
  **Rank** orders finishers by `total`, ascending, from 1.
- **Rule order:** rules run by `(stratum, ordinal)`, and the field is surveyed once before each
  stratum. A rule that reads the `field` runs in stratum 1, over what stratum 0 left.
- **Settling:** before anything is read, every superseded observation is dropped and the rest are
  sorted by `(t, id)`. The second key exists because two mats can stamp the same millisecond; it
  decides every tie because ids are unique in a log.
- **A place kind** is looked up by exact string, never inherited: `constructor` produces `passed`.
- **Instants:** exactly `YYYY-MM-DDTHH:MM:SS[.sss]Z`, on a real calendar day, with no leap second
  and no offset. Parse them to the millisecond yourself. The Rust parser is hand-written, because
  a date library would be a second opinion about what a timestamp means.

## Arithmetic

Times are integer milliseconds and distances integer metres, a convention neither engine yet
enforces at decode ([known-gaps.md](known-gaps.md)): only `pace-geojson` and a backyard `lap` are
checked as whole numbers. Nothing in a decision divides or accumulates a fraction. The engines
carry them as numbers (TypeScript) and `f64` (Rust), both exact for every integer below 2⁵³.
Instants are UTC; local time is resolved before the document is written.

- **A fraction is the nearest double.** A measured `quantity` and a dialect's parameter may be
  written with more digits than a double holds, and the number they mean is the double nearest
  to what is written, a tie going to the even one
  ([SPEC §1](../SPEC.md#1-what-is-portable-and-what-is-not)). Not every JSON parser reads one
  that way unless asked: Rust's `serde_json` needs its `float_roundtrip` feature, and without it
  reads `22.500000000000002` as 22.5, which is clean under a `wetsuit_limit` of 22.5 where the
  nearest double, 22.500000000000004, is disqualified. One decode case holds the far end of it,
  `accepts-the-largest-double-written-long`: `1.7976931348623158e308` is the largest double, not
  an error. No case holds a number a step out ([known-gaps.md](known-gaps.md)), so check that
  yourself: `730.65172614218456` is 730.6517261421845.
- `long-day-millisecond-arithmetic` pins a 497 km ride under a 24-hour cut-off, whose slowest
  finisher is out for more than 23 hours.
- The cut-off-edge pair pins the boundary. At exactly 7:30/km, a 44 km runner arrives at
  19 800 000 ms, the limit to the millisecond, and is clean, because the gate is elapsed
  _greater than_ the limit. At 7:31/km the runner is 44 s over and gated.

A fraction enters in two named places only: `quantity`, which compares a measured value such as
water temperature, and `field winner_elapsed × ratio`, for a cut-off at 120 % of the winner.

## The bridge is yours

The bridge is **not** part of the conformance surface. Yours will bind tags and correct clocks its
own way. What must match is the log it produces, and the fold over that log. Give every
observation an id that is unique in the log; if your readers number their own reads, prefix the
device. A log is per document: on mats shared by several distances, send each entrant's reads to
the document of the distance they entered. The reference bridge's shape is in
[api.md](api.md#typescript).
