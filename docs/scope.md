# Scope and versioning

What pace-geojson deliberately leaves to others, and how its vocabulary may grow without a rule
written today changing meaning later. [SPEC §6](../SPEC.md#6-what-is-deliberately-absent) and
[§7](../SPEC.md#7-versioning) are normative.

## What it deliberately is not

- **Not a timing system.** Identity (which tag belongs to which entrant, over time), clock
  discipline, dedupe and lateness belong to the bridge. The language sees only the corrected,
  ordered log.
- **Not a results store.** Results are the fold's output, never stored in the document. A
  `pace:results` snapshot with an `as_of` may travel for an offline hand-off, but it is never the
  source of truth.
- **Not a results presenter.** Placing, dead heats, rounding a published time (up to the whole
  second, say), whether a gated finisher is placed, and conversion to IOF XML 3.0 or a vendor's
  export belong to whoever publishes the results, under the federation's rules
  ([results.md](results.md)). A converter is a welcome contribution.
- **Not a scripting language.** A closed vocabulary over typed parameters is something a rehearsal
  can simulate and an official, or a court, can read.
- **Not geometry maths.** Turning a GPS fix into `along_m` is map-matching, and it belongs upstream.
  The fold never reads a coordinate.
- **Not timezone-aware.** `16:30 local` becomes a UTC instant when the document is written.

## Versioning, and how the vocabulary grows

- **The format** is `"pace-geojson": 1`. The kernel is closed and changes rarely. A new atom or
  consequence is a spec change in every implementation.
- **Dialects** are named `name@major`, and they are **append-only within a major**. `triathlon@1`
  may gain kinds, but an existing kind never changes meaning, because a rule written in 2027 has to
  mean the same thing in 2031. A change of meaning is `triathlon@2`, shipped beside `@1`. An
  implementation says which dialects it ships (`dialects()`), and a document naming any other is
  refused by name.
- **A new kind lands with a conformance case.** That is how the specification grows, and the only
  way it grows. A new sport is a new dialect, not a kernel change.
- **Unknown members** are ignored by both engines when they read a document: `x-…`, a
  `pace:results` snapshot, extra `properties`. So a document can carry more than pace-geojson
  reads.
- **Packages** follow semantic versioning of their own. See [CHANGELOG.md](../CHANGELOG.md).
- **Stability.** Until the first release is tagged, format version 1 may still change. From that
  tag it is frozen: a change that alters any verdict or any fold is format version 2, even while
  the packages are 0.x.
