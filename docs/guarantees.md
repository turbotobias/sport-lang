# Guarantees and conformance

What every conforming engine promises, and how the two that exist prove they keep the promise.
Each guarantee is stated in [SPEC.md](../SPEC.md); where a test can pin one,
[rust/tests/properties.rs](../rust/tests/properties.rs) or the corpus does.

## Guarantees

Same two files, same result, to the millisecond, on anyone's machine: `fold(rules, log)` has no
clock, no IO and no randomness, so anyone can re-derive the official result.

1. **Pure.** No clock, IO, network, database or randomness.
2. **Arrival order cannot change a result.** The log is settled first: superseded rows dropped, the
   rest sorted by `(t, id)`. A log that repeats an id is `malformed`.
3. **Whole numbers in every decision.** Integer ms and metres, UTC instants; a fraction enters only
   in `quantity` and `field winner_elapsed × ratio` ([arithmetic](implementing.md#arithmetic)).
4. **A closed vocabulary.** No user-defined functions and no scripts: every document is decidable.
5. **Refuse; never guess.** `plan` returns kernel rules or _not runnable_ with every reason, never
   "run what you understood". A rule an engine does not know, or one nobody could satisfy, stops
   the scoring, not the map: the same bytes still draw in any GeoJSON viewer.
6. **Replay equals result.** The state at _t_ is the fold of what is stamped at or before _t_.
7. **Standing only worsens, and a correction supersedes.** The replaced row stays in the log.

## Rejected, refused or malformed

A document breaking a per-field law is **rejected at parse**; one that is readable but not runnable
(a version, dialect or kind the engine lacks, `params` that do not fit, or one of 8 cross-document
laws) is **refused** by `plan`; a log with an undecodable row or a repeated id is **malformed**.
Every law: [implementing.md](implementing.md#what-is-rejected-refused-or-malformed).

## Conformance: the corpus is the specification

Two implementations can read prose differently and both believe they are right; a corpus turns that
into a failing test the day it is introduced. [SPEC.md](../SPEC.md) explains the corpus, and the
corpus is normative.

| corpus | holds |
| --- | --- |
| [corpus/conformance/](../corpus/conformance) | 19 cases, 104 entrant states (11 by hand, 8 generated), reaching every kind of every dialect. Each is `{name, why, document, log, expect[]}`; every entrant's `standing, total_ms, adjustment_ms, awards, laps` must match, none extra and none missing |
| [corpus/decode/](../corpus/decode) | 54 cases: 14 accept, 23 reject, 17 refuse, each with its verdict and reasons; eight accepted documents carry a log with its own verdict (1 accepted, 6 rejected, 1 refused), and eleven cases carry a file as its text: ten for the two laws only a text can break, one for a number written with more digits than a double holds |
| [corpus/summary/](../corpus/summary) | 8 cases: a document built from a synthetic course and the summary the reference reads off it (`summary_of`): laps of one line, a line with no heights, ground in thirds, ground with a gap, a material outside the family, a 500 km ride, twelve steps. Both engines read every one; their 380 heights agree to the bit |
| [corpus/courses/](../corpus/courses) | 7 synthetic courses in open sea near 0° N 0° E, the inputs to the generators in [ts/scripts/](../ts/scripts) |

Two engines pass all of it: one in TypeScript, and one in Rust written from SPEC.md and the corpus,
which also builds to WebAssembly.

<details>
<summary><b>The sweeps</b> — how the two engines are compared beyond the corpus</summary>

**The differential sweep** folds simulated fields, with officials' flags and a measured water
temperature, through both engines and compares every member of every state and every sentence:
**44 fields, 1 100 entrant states, 0 disagreements** ([ts/test/differential.test.ts](../ts/test/differential.test.ts)).
A second sweep damages one lawful document and log 176 ways (every member left out in turn, an
offset, an impossible day, a repeated id); both engines give the same verdict and reason on each.
A third writes the same two files out as text with every member named twice and every string cut
to half a surrogate pair, 419 texts in all: each is malformed in both engines, for the same law.
A fourth writes numbers with more digits than a double holds — 1 800 decimals through a rule's
parameter, 400 water temperatures between a legal limit and the next double above it — and both
engines give the same answer on each, to the byte.
Where the engines are known to read a file differently, the same test file holds each one
([SPEC §5a](../SPEC.md#5a-two-engines-one-author)).

</details>

## What this proves, and what it does not

The Rust was written from SPEC.md and the corpus, not translated from the TypeScript, so the
specification is enough to build against: nothing had to be guessed from the reference's source. It
does not prove the engines independent: one author wrote both, and a misreading they share is
invisible to both. **A third implementation, by somebody else, is the most valuable contribution
this project can receive** ([implementing.md](implementing.md)); where it disagrees, the result is a
new case, not an argument.
