# pace-geojson — the specification

A declarative language for the rules of an endurance event, and a deterministic
way to turn an event's observations into its results. This document is what
every implementation has to satisfy. Two exist: the reference, in TypeScript
(`ts/src/`), and a second, in Rust (`rust/`), with a WebAssembly build of it
(`wasm/`).

**The specification is the corpus.** `corpus/conformance/*.json` is the
normative part of this repository: a document, an observation log, and the
state every entrant must end in. `corpus/decode/*.json` is its companion: a
document, and whether a reader must accept it, reject it or refuse to run it.
Prose describing a fold is prose two implementations can read differently and
both believe they are right. A corpus is a disagreement that shows up as a
failing test the day it is introduced. Everything below exists to explain the
corpus, not to replace it — and where this prose and the corpus disagree, the
corpus is right and the prose has a bug.

This is **version 1** of the format (`"pace-geojson": 1`), with four dialects:
`athletics@1`, `backyard@1`, `orienteering@1` and `triathlon@1`. *Must* marks a
requirement the corpus tests or an implementation is otherwise held to;
everything else is explanation.

---

## Terminology

- **Way in.** The entry option an entrant signs up for — a distance, a
  category: the 10 km, the half and the full of one event are three ways in.
  One document describes one way in, because that is the unit an entrant runs,
  a rule applies to and a watch loads.
- **Document.** One way in as a GeoJSON `FeatureCollection` with `pace:`
  members (§2.1): its line, its places, its path and its rules.
- **Place.** A position on the course, addressed by distance along it:
  `{ point, along_m }`, where `point` is the id of a `point` feature or null.
  **Span**: a stretch, `{ from_m, to_m }`.
- **Observation.** One thing that happened to one entrant at one place at one
  instant (§2.3). **The log** is the list of them — the only input to a fold.
- **Bridge.** Everything with IO: mats, trackers, watches, tag bindings, clock
  correction. Its only output is the log (§4). The language has no IO.
- **Dialect.** A named, versioned vocabulary of rule kinds for a sport,
  written `name@major` — `triathlon@1`. A dialect is code that ships with an
  implementation, never data that arrives with a document.
- **Kind.** Three things share the word. A *rule kind* is an entry in a
  dialect (`drafting`). A *place kind* is a point's `kind` (`control`), which
  fixes the observation it produces (§2.2). An *observation kind* is one of
  eight things that can happen (`punched`).
- **Kernel.** What every rule kind expands into: a predicate over nine atoms
  and one of five consequences (§3.2). Closed, sport-agnostic, and the same in
  every dialect.
- **Stratum.** 0 or 1. A rule whose predicate reads the field sits in stratum
  1 and sees only what stratum 0 left, so no rule depends on itself (§3.1).
- **Dormancy.** A rule bound to a place does not judge an entrant who has not
  reached it yet (§3.2).
- **Standing.** Where an entrant's day ended up: `clean < penalised < gated <
  disqualified`. It only ever worsens. Withdrawing is not a standing.
- **Law.** Something a document must satisfy. A law *of the text* is checked
  on the file's characters, before any member is read (§2); a *per-field* law
  is checked while parsing; a *cross-document* law needs the whole document
  (§2.1).
- **Rejected** / **refused.** A document that breaks a law of the text or a
  per-field law is *rejected*: it is not a document. One that breaks a
  cross-document law, or names a dialect or kind the reader does not ship, is
  *refused*: readable — it still draws — but not runnable (§3.3). A log that
  does not decode, or that uses an observation id twice, is *malformed* (§2.3).
- **Fold.** The deterministic evaluation of a document's rules over a log
  (§3). **Entrant state**: what the fold says about one entrant.

## 1. What is portable, and what is not

pace-geojson is **pure**: no clock of its own, no IO, no network, no database, no
randomness. Given a document and a log it computes states, and the same inputs
always give the same outputs. There is nothing in the language that a Rust, Go
or Python implementation cannot express, and deliberately so:

- **No floating-point accumulation in a decision.** Every time is an integer
  of milliseconds and every distance an integer of metres, and JSON numbers
  that size are exact in every language. `f64` accumulation order is the
  classic way two implementations disagree on a result, and none of the
  arithmetic here needs it. Two places admit a fraction — a `field` atom's
  `ratio` and a measured `quantity` — and each is one IEEE 754 operation, not
  a sum, so it rounds the same everywhere. That starts at the file: a number
  is the double nearest to what is written, a tie going to the even one,
  however many digits it is written with. A reader that estimates instead can
  be a step out from sixteen significant digits on, and a measurement at its
  limit is then a different standing. Neither engine rejects a fractional
  `along_m` or `_ms` value; the corpus contains none, and a producer must not
  write one.
- **No recursion.** A predicate is one combinator over a flat list of clauses.
  A single pass evaluates it and the depth is one.
- **No user-defined functions.** A rule names a *kind* from a *dialect*; the
  dialect is code that ships with the implementation, not data that arrives
  with the file. So a document can be handed to a stranger.
- **No locale, no timezone maths at evaluation time.** Wall-clock instants
  arrive already resolved to UTC. Turning *16:30 on the organiser's clock* into
  an instant happens upstream, in whatever produced the document.

## 2. The data

Three JSON shapes, and nothing else crosses a boundary: the document, the
observation, and the entrant state (§4.1). A JSON Schema of each is in
`schema/` (`document`, `observation` and `entrant-state.schema.json`),
generated from the reference. They carry the per-field laws they can express
and none of the cross-document ones; an instant's pattern is in them, and
whether its day is on the calendar (§2.3) is checked by the engines only.

**The text.** A document and a log are each one JSON text (RFC 8259). JSON
leaves two things to whoever parses it, and two lawful parsers given the same
bytes then hold two different files. Neither is read here: an implementation
must **reject** a text that does either, at parse time, before it reads a
member. Both are among what I-JSON (RFC 7493) forbids.

| law of the text | broken when |
| --- | --- |
| `a member is named twice` | an object names a member twice: at any depth, and whether this specification names the member or not. One parser keeps the last value, another the first, a strict one refuses, so `"pace-geojson": 1, "pace-geojson": 2` would be version 1 or version 2, and a cut-off one hour or two, by whichever the reader's parser kept |
| `a string holds half a surrogate pair` | a string — a member's name or a value, read or not — has an escape `\uD800`–`\uDBFF` that is not followed at once by an escape `\uDC00`–`\uDFFF`, or the second without the first. Half a pair is not a character: a language whose strings are UTF-16 holds it and one whose strings are Unicode cannot, so an id carrying one is an entrant to the first and a malformed log to the second |

Names are compared after their escapes are resolved, character for character:
`"pace:way"` and `"pace:\u0077ay"` are one name, as they are to every parser.
Nothing else is normalised — an accent written as one code point and as two
are two names, and so are `"a"` and `"A"`. A surrogate pair written as two
escapes (`"\ud83d\ude00"`) is one character and lawful, and so is an escaped
backslash followed by the same letters (`"\\ud83d"`).

**Only the text can show the first.** Once a parser has answered there is one
value for each name and no trace that there were two, so no check on a value
can find it — which is also why the JSON Schemas, which describe a value,
carry neither law. An implementation therefore checks both on the characters
it is given: `parse_document` and `parse_log` take the file's text (§4.2),
and both engines read it once for exactly these two laws without consulting
their JSON parsers, so the verdict on a text is not either parser's to give.
A host that parses the file itself and hands an engine the value has already
let its parser choose. It hands over the text instead, or parses with a
parser that refuses a repeated name.

### 2.1 The course document

Valid GeoJSON, and **stricter** than GeoJSON. It is a profile: every document
is GeoJSON any tool can draw, and not every valid GeoJSON is a document. The
GeoJSON specification leaves `properties` free-form and geometry loosely coupled
to meaning, which is right for an interchange format and wrong for a file that
decides who finished. Where GeoJSON permits and we require, we require.

```jsonc
{
  "type": "FeatureCollection",
  "pace-geojson": 1,
  "pace:id": "crs_…", "pace:event": "evt_…", "pace:way": "way_…" | null,
  "pace:name": "…",
  "pace:dialects": ["backyard@1"],
  "pace:measure":    { … },   // §2.4
  "pace:provenance": [ … ],   // where every original came from
  "pace:path":       [ { "line": "ln_1", "from_m": 0, "to_m": 6720, "repeat": 3 } ],
  "pace:rules":      [ { "id": "rul_…", "dialect": "…", "kind": "…",
                         "ordinal": 0, "at": Place|Span|null, "params": { … } } ],
  "features":        [ … ]    // §2.2
}
```

| member | type | meaning |
| --- | --- | --- |
| `type` | `"FeatureCollection"` | GeoJSON's |
| `pace-geojson` | integer ≥ 1 | the format version. This is `1`; any other is readable and not runnable (§3.3, §7) |
| `pace:id` | string | this document's id |
| `pace:event` | string | the event this way in belongs to; every way in of one event shares it. Opaque to the fold |
| `pace:way` | string \| null | **the way in**: the entry option an entrant signs up for — a distance, a category. Opaque to the fold; null when the event has one |
| `pace:name` | string | a name a person reads |
| `pace:dialects` | string[] | every dialect the rules are written in, `name@major`. A reader that does not ship one of them must refuse to run the document (§3.3) |
| `pace:measure` | object | how long and how steep the course is, and by what method (§2.4) |
| `pace:provenance` | object[] | every original the geometry was made from, in order: `source` (string), and `origin_url`, `sha256`, `format`, `verified_by`, `verified_at` (each string or null). Descriptive; the fold never reads it |
| `pace:path` | object[] | the way in as a playlist of line slices (below) |
| `pace:rules` | object[] | the rules, as a dialect, a kind and parameters (below) |
| `features` | Feature[] | the line, and every place, stretch and zone on it (§2.2) |

Ids are opaque strings. The prefixes in the examples (`crs_`, `evt_`, `rul_`,
`obs_`, `ent_`) are a convention nobody checks. A nullable member is written as
`null`, not omitted. Members this specification does not name — GeoJSON's
`bbox`, a feature's top-level `id`, a vendor's own — are ignored by every
reader, as GeoJSON's foreign members are; ignored, and still not to be named
twice (§2, the text).

**`pace:path`** is an ordered list of slices, each `{ line, from_m, to_m,
repeat }`: run the line named `line` from `from_m` to `to_m`, `repeat` times.
Four laps of a 10.5 km loop is one line and one entry with `repeat: 4`, not four
copies; the 10 km, the half and the full of one event are three documents over
one line. The course is **`path_length` = Σ (`to_m` − `from_m`) × `repeat`**
metres long — the document owns how long the course is, and the geometry only
where inside that length each vertex falls.

**`pace:rules`** entries are `{ id, dialect, kind, ordinal, at, params }`.
`dialect` and `kind` name a rule kind (§3.4); `params` is that kind's own
object; `ordinal` orders rules within a stratum (§3.1); `at` is where the rule
applies — a Place, a Span, or `null` for the whole day. A rule is data, not
its kernel form: the file says *drafting, 25 seconds* and the meaning of
drafting is corrected in one place, the dialect.

**Laws beyond GeoJSON.** An implementation must **reject** a document that
breaks one of the first group at *parse* time, as it rejects one whose text
breaks a law of the text (§2), and must **refuse to run** — while still being
able to **draw** — a document that breaks one of the second.

| checked per field | |
| --- | --- |
| every member of this section is present, with its type | |
| each feature's `properties.role` has its geometry type (§2.2) | a `line` with a `Point` geometry is not a line |
| a position is two or three numbers: longitude ∈ [−180, 180], latitude ∈ [−90, 90], then an optional height | |
| a `LineString` has ≥ 2 positions | one position is a point wearing a line's role, and every distance along it is zero |
| a point's `along_m`, a segment's and a path slice's `from_m` and `to_m` are finite and ≥ 0 | nothing on a course is a negative distance from the start |
| `repeat` ≥ 1 | a slice run zero times is not part of the way in |
| `pace-geojson` is an integer ≥ 1, at most 2⁵³ − 1 | `1.5` and `0` are versions of nothing. `1.0` is the number 1. A well-formed version this implementation does not run is not a law broken: it is refused by name (§3.3) |

The cross-document laws are named by fixed sentences, and the decode corpus
asserts those sentences, so an implementation must report them word for word:

| law | broken when |
| --- | --- |
| `a feature id is used twice` | two features share an id — once per such id. A rule naming it would reach whichever the reader happened to index |
| `the document carries no line` | there is no `line` feature |
| `a path slice ends before it starts` | a `pace:path` entry has `to_m` ≤ `from_m` |
| `the path names a line the document does not carry` | a `pace:path[].line` is not the id of a `line` feature |
| `a segment ends before it starts` | a `segment` has `to_m` ≤ `from_m` |
| `a place is beyond the end of the course` | a `point`'s `along_m` > `path_length` — once per point. A rule bound past the end can never fire |
| `a rule names a point the document does not carry` | a rule's `at` is a Place whose `point` is not the id of a `point` feature. Otherwise the race is scored as though the gate were not there |
| `a rule requires an observation the place never produces` | a compiled rule has an `observed{at, kind}` clause, negated or not, whose `at.point` names a point that does not produce `kind` (the producer table, §2.2) |

The first seven need only the document. The last needs the rules expanded into
the kernel, so it is checked when the document is planned against the
dialects (§3.3). A law that fires more than once is reported once per firing:
the decode corpus compares the sentences as a multiset.

### 2.2 Features

Four roles, discriminated on `properties.role`, each pinned to the geometry it
may have. **The features are the only copy** — there is no parallel array of
points elsewhere in the document.

| role | geometry | properties |
| --- | --- | --- |
| `line` | `LineString` | `id`, `polyline` (string or null: a drawable encoding for a client that wants one) |
| `point` | `Point` | `id`, `kind`, `name` (string or null), `along_m` |
| `segment` | `LineString` | `id`, `kind`, `name` (string or null), `from_m`, `to_m` |
| `zone` | `Polygon` | `id`, `kind`, `name` (string or null) |

Every feature's `type` is `"Feature"`. A point is a *place*; a segment is a
stretch with something true of it; a zone is an area. Only points are places:
rules and observations name points, never segments or zones.

**The producer table.** A place's `kind` determines the observation kind
anything reaching it emits, and a rule requiring a kind the place never
produces can never fire. This is checked when a document is planned and is
normative:

| place kind | produces |
| --- | --- |
| `start` | `started` |
| `finish`, `lap` | `finished` |
| `control` | `punched` |
| `check` | `checked` |
| `transition_in`, `zone_in` | `entered` |
| `transition_out`, `zone_out` | `left` |
| `corral`, `mat`, `aid`, `gate`, anything else | `passed` |

*Anything else* means any other string, compared exactly: `constructor`,
`toString` and `__proto__` produce `passed` like any unknown kind. An
implementation whose lookup can inherit a member it never defined — an
object literal indexed by the file's text — answers something that is not an
observation kind.

A point's `kind` is **descriptive to the fold and operational to producers and
planners**. Nothing in the fold reads it — a rule names a place, not a kind —
but a map labels by it, a simulator or a bridge turns it into an observation
kind by the table above, and planning checks the last law of §2.1 against it.
A component that only folds already-planned rules may ignore `kind` entirely;
one that plans may not.

**A segment's `kind` is descriptive, to everything.** A segment is not a
place: no rule names one, reaching one produces no observation, and neither
the fold nor planning reads it. It is there for a reader — a map colours the
line by it, a profile shades under it — and an implementation that ignores
segments runs every document exactly as one that reads them. Its `from_m` and
`to_m` are path distances, like a point's `along_m`, and its geometry is the
stretch of the line between them, carried on from the line's start where the
path repeats. Kinds are open strings, compared exactly. One family is defined,
so that two writers say the same ground the same way:

- **`surface:<material>`** — what is underfoot from `from_m` to `to_m`: the
  material, not the kind of way. `paved` (asphalt, concrete), `cobbles` (setts,
  paving stones, brick), `gravel`, `trail` (earth, grass, rock and roots),
  `sand`, `track` (an athletics track), `water` (a swim), or `unknown` (the
  writer looked and could not tell). A writer that read the material off
  something other than a statement of it — the class of road, say — appends
  `:inferred`, as in `surface:gravel:inferred`; `unknown` never takes it.
  A writer that carries any `surface:` segment covers the whole `path_length`
  with them, in order, with no gap and no overlap, so a reader can add them up
  per material. `unknown` is part of that cover and never a synonym for
  `paved`. This is the writer's promise, not a law: no engine checks it, and a
  reader that finds a gap or an overlap reads the document as saying nothing
  about the ground — as it reads a document with no `surface:` segments at
  all. A material not in this list reads as `unknown`.

```jsonc
{ "type": "Feature",
  "properties": { "role": "segment", "id": "surface-4", "kind": "surface:cobbles",
                  "name": null, "from_m": 18400, "to_m": 19650 },
  "geometry": { "type": "LineString",
                "coordinates": [[0.5214, 0.4861], [0.5221, 0.4870], …] } }
```

**`along_m` is horizontal distance on the WGS84 ellipsoid.** Not
three-dimensional, not spherical. This has to be stated because it is a
*convention*, not a fact anybody can derive from a document: a line carries
positions, and how far apart two of them are depends entirely on what you mean
by far. Summing three-dimensional chords instead moves a place tens of metres
from where the organiser put it on a mountain course, and a mean-radius sphere
is out by a few tenths of a percent, in either direction depending on latitude
and bearing — over 100 m on a marathon. Two implementations that disagree here
disagree about where the mats are while agreeing about every rule. (These
effects, and those in §2.4, were measured on organisers' own course files,
which are not in this repository: their licences do not allow it. The
synthetic courses in `corpus/courses/` show the effects, not those files'
numbers — and they say which method measured them, `mean-sphere-2d`, in their
own files.)

A document's line has **no spacing guarantee**. GPX vertices cluster on corners,
so a reader must derive each vertex's `along_m` from the geometry and normalise
it to the document's own `path_length` — the document owns how long the
course is, the geometry owns where inside that length each vertex falls. Reading
the vertices as evenly spaced is out by about a hundred metres in the median on
a half marathon, and by kilometres on a long ride.

**Everything is addressed by `along_m`, never by coordinate.** A course that
doubles back has two places at one latitude and longitude and exactly one at
31 400 m, so a coordinate is ambiguous precisely where a race is most likely to
have a timing mat. It is also the address every timing system already uses, and
it is what makes a lap a *place* rather than a repetition — which is why a
backyard ultra is expressible in a kernel that never learned to count. The fold
never reads a coordinate.

### 2.3 Observations

The only input. Produced by the bridge (§4), never by the language.

```jsonc
{ "id": "obs_…", "entrant": "ent_…",
  "at": { "point": "lap-3-finish" | null, "along_m": 20160 },
  "kind": "started"|"passed"|"entered"|"left"|"punched"|"checked"|"finished"|"withdrew",
  "t": "2026-08-14T16:48:00.000Z",         // UTC, already corrected
  "quantity_name": "water_c" | null, "quantity_value": 25.8 | null,
  "flags": ["overtaking"],
  "source": "transponder"|"gps"|"watch_upload"|"manual"|"partner"|"virtual",
  "device": "dev_…" | null,
  "confidence": 1,
  "supersedes": "obs_…" | null }
```

| field | read by the fold as |
| --- | --- |
| `id` | the tie-break when two observations share an instant, and what a `supersedes` names. **Unique within a log** (below) |
| `entrant` | whose day this is. The fold's entrants are exactly the entrants of the settled log, so an entrant who never appears — who did not start — has no state (§4.1) |
| `at` | a Place: where. Matched to a rule's places by §3.2's *at a place* |
| `kind` | what happened. Movement only; a measurement or a declaration rides *on* an observation |
| `t` | when, in UTC, as **`YYYY-MM-DDTHH:MM:SSZ` or `YYYY-MM-DDTHH:MM:SS.sssZ`** — exactly that shape, offset always `Z`, fraction exactly three digits when present, on a day the calendar has (below). The fold compares instants to the millisecond |
| `quantity_name`, `quantity_value` | a measurement taken here — a pack's weight, the water's temperature. Both or neither |
| `flags` | what an official declared here: `overtaking`, `wetsuit`, `outside_help` |
| `supersedes` | the id of an observation this one corrects (§3.1). A correction never edits; the replaced row stays in the log |
| `source`, `device`, `confidence` | provenance. The fold never reads them |

Every member is present; a nullable one is written as `null`. A log is a JSON
array of observations, in any order, and its text keeps the laws of the text
(§2) as a document's does.

**An instant** is exactly one of the two shapes above, and it must be on the
calendar: a month from 01 to 12, a day that month has (29 February only in a
leap year), an hour below 24, and a minute and a second below 60 — no leap
second, because a 60th second is not on a timeline every reader shares. An
offset (`+02:00`) is **not** an instant here, and is neither converted nor
read as UTC: both would be guesses about what the producer meant. The bridge
corrects clocks and writes UTC. An observation whose `t` is not an instant
does not decode, and nor does the log; the same instant rules hold for every
instant a dialect's `params` carries (`cutoff_at`'s `at`), where one that is
not an instant makes the parameters not fit (§3.3).

**The log law.** An `id` is unique within a log. It is the second sort key
(§3.1) and what a `supersedes` names, so two rows sharing one make the result
depend on the order they arrived in, and a correction naming the id removes
both. A reader numbering reads per device, or merging two feeds, produces
exactly this, so **a producer namespaces its ids** — by device, say. A log
that breaks the law is named by one fixed sentence, once per repeated id:

| law | broken when |
| --- | --- |
| `an observation id is used twice` | two observations in the log share an `id` |

A reader must not fold a log that breaks it: it answers that the log is
malformed and names the law (§4.2). `settle` and `fold` themselves stay total,
so a host that builds its own log — a simulator — need not ask.

### 2.4 The measurement carries its own method

```jsonc
"pace:measure": {
  "distance_m": 502000, "distance_method": "wgs84-geodesic-2d",
  "stated_m": 500000, "certified_m": null,
  "ascent_m": 5400, "descent_m": 5200,
  "elevation_source": "copernicus-glo30",
  "elevation_smoothing": "moving-average-5", "ascent_threshold_m": 3
}
```

An illustration in round figures. Every member is present and may be null.
Not bookkeeping: on a ride of about 500 km, a sphere of the mean radius and the
WGS84 ellipsoid disagree by more than a kilometre, and the same file's climb
varies by a factor of almost four on honest choices of smoothing and threshold
alone. Three distances are kept because they answer different questions:
`stated_m` is what the entrant bought, `certified_m` is what a record book
uses, `distance_m` is what a pacing plan is computed from. Only `distance_m`
carries a method; who certified `certified_m`, with which certificate and
when, is not carried in version 1 (`pace:provenance` is where it would go).
The fold reads none of them; `path_length` (§2.1) is the course's length as
far as any rule is concerned.

## 3. Evaluation

### 3.1 Order

```
settle(log)          drop every observation whose id is named by any `supersedes`,
                     then sort by (t ascending, id ascending)
absorb               fold the settled log into one accumulator per entrant,
                     entrants in order of first appearance
sort rules           by (stratum ascending, ordinal ascending); ties keep document order
for each stratum s   that has a rule, ascending
    field  := survey(states)        aggregates over the states so far, fixed for all of s
    states := for each entrant, for each rule in stratum s in order,
              if not dormant(rule) and holds(rule.when) then apply(rule.then)
```

The second sort key is not decoration. Two mats can stamp the same
millisecond, and a fold whose result depends on which the database returned
first is not reproducible. Ids are unique in a log (§2.3), so the two keys
order every observation. Ids compare as strings, character by character;
every id in the corpus is ASCII, where every language agrees on that order.

`settle` removes a superseded observation whether or not its correction is
itself later superseded; the correction stays unless something names it. An
observation whose `supersedes` names nothing in the log is kept and replaces
nothing.

Every rule is evaluated **once** per entrant per fold. Within a stratum, a
rule sees the effects of every earlier rule on the same entrant — its standing,
adjustment, neutralised time and firings — and the field as it was when the
stratum began.

*Not normative:* nothing above asks for the log to be scanned once per
entrant, and doing so makes a fold cost the log times the field. Both
reference engines partition the settled log by entrant in one pass, keeping
entrants in order of first appearance, so a fold costs one sort of the log and
work in proportion to it.

A rule is in **stratum 1** if its predicate contains a `field` atom, and in
stratum 0 otherwise. A stratum may read aggregates over strata below it and
never its own, so there is no cycle.

### 3.2 The kernel

Nine atoms. A predicate is `{ combine: "all" | "any", clauses: [{ negated, atom }] }`:
`all` holds when every clause does, `any` when at least one does, and a clause
holds when its atom's truth differs from `negated`. Comparisons `cmp` are `lt`,
`lte`, `gt`, `gte`, `eq`, `ne`, on numbers, and there is no other arithmetic.

| atom | true when |
| --- | --- |
| `observed{at, kind}` | some observation of `kind` is *at* `at` |
| `order{sequence}` | the places appear in that order as a **subsequence** of the entrant's settled observations: extra observations between them are allowed |
| `clock{measure, cmp, value_ms, value_at, from, to}` | `elapsed` or `moving` compares to `value_ms`; `wall`: the arrival instant compares to `value_at`, where the arrival is the first observation at the rule's own `at` when that is a Place, and the finish (*finished at*) otherwise; `split`: the time from the first observation at `from` to the first at `to` compares to `value_ms`. False when any operand is null or absent |
| `count{what, cmp, value}` | the number of `laps`, `punches`, `penalties` or `observations` compares to `value` |
| `quantity{name, cmp, value}` | the latest measurement of `name` compares so. **A measurement nobody took is false** |
| `flag{name}` | the flag appears on any of the entrant's observations |
| `standing{is}` | the entrant's standing *right now*, mid-fold, is `is` |
| `withdrawn` | the entrant has a `withdrew` observation |
| `field{aggregate, cmp, value, ratio}` | `rank`, `remaining` or `finishers` compares to `value`; `winner_elapsed`: the entrant's *total* compares to the lowest finisher's *total* × `ratio` (1 when null), false when either total is null |

Five consequences:

| consequence | effect |
| --- | --- |
| `adjust_time{by_ms, each_time}` | adds `by_ms` × (*occurrences* if `each_time`, else 1) to the adjustment. A positive amount also worsens the standing to at least `penalised`; a negative one is a bonus and leaves it |
| `set_standing{standing, reason}` | the standing becomes the worse of itself and `standing`. `reason` labels the kernel form for a person reading it; no output carries it, because the rule's sentence says the same thing in full |
| `classify{dimension, value}` | sets the entrant's value for `dimension`, replacing any earlier one |
| `award{name}` | adds `name` to the awards, once; awards keep the order they were first given |
| `neutralise{from, to}` | adds `max(0, t(to) − t(from))` to the neutralised time, using the **first** observation at each place; 0 when either is absent |

Every firing is recorded in `applied` as `{ id_rule, kind: "dialect.kind",
sentence, times, added_ms }`, where `added_ms` is what `adjust_time` added, the
negated neutralised amount for `neutralise`, and 0 otherwise.

**Dormancy.** A rule whose `at` is a *place* does not apply to an entrant who
has not reached it, unless their day has ended. Without this, every negative
predicate is true before the thing it denies has had its chance: *"you must
punch the mat at 30 km"* penalises a runner at 10 km. The final result is the
same either way — by the end everyone is past the place or has stopped — so
this exists entirely for the live and replayed views, which is where the
difference is visible. Exactly: a rule is dormant for an entrant when its `at`
is a Place, the entrant has no `finished` and no `withdrew` observation, and
the furthest `along_m` among their observations (0 when they have none) plus
10 is less than the place's `along_m`. A rule with no place, or one bound to a
span, is never dormant. Any `finished` observation ends the day for this
purpose — on a lapped course, the first lap's.

**Replay.** The state at instant *t* is the fold over the observations whose
own `t` is at or before *t*, settled as in §3.1 — so a correction counts from
its own instant. Not an approximation: an implementation must not maintain an
incremental replay that could disagree with the fold. Scrubbing to the end of a
race returns exactly the race's result.

**Definitions an implementation must match exactly:**

- *at a place*: same `point` id when both the observation's `at` and the place
  have one; otherwise `|observation.along_m − place.along_m| ≤ 10`.
- *started at*: the entrant's own first `started` observation. *finished
  at*: the **last** `finished` observation — a lapped course crosses the line
  every lap.
- *elapsed*: *finished at* − *started at*, or the entrant's last settled
  observation − *started at* when there is no finish. Null when there is no
  start. So every clock runs from the entrant's own start: *elapsed* is net
  (chip) time. There is no event-level gun instant; a bridge that wants gun
  time writes each entrant's `started` at the gun (§4).
- *moving*: *elapsed* − neutralised time. *total*: *moving* + adjustment. Null
  when *elapsed* is.
- *standing* starts `clean` and only ever worsens: `clean < penalised < gated
  < disqualified`.
- *occurrences*, for `each_time`: over every `observed` clause in the
  predicate, negated or not, the number of the entrant's observations
  matching it; the maximum of those, or 1 when there is no `observed` clause.
  Note what follows: a rule that fires *because* a negated `observed` clause
  found nothing has 0 occurrences, and `each_time` then adds 0; and a rule
  with no `observed` clause adds its amount once, whatever happened how many
  times. `each_time` counts observations. It does not count offences, and
  nothing in version 1 does (§3.4).
- *laps* counts `finished` observations; *punches* counts `punched`;
  *penalties* counts firings whose `added_ms` > 0; *observations* counts the
  entrant's settled observations.
- *quantity*: the value of the latest observation, in settled order, carrying
  both `quantity_name` = `name` and a `quantity_value`.
- *finishers* counts entrants with a finish who are not disqualified.
  *remaining* counts entrants who have not withdrawn and are neither gated nor
  disqualified. *rank* orders the finishers that have a total by *total*
  ascending, from 1, ties in order of first appearance; an entrant with no rank
  compares as +∞. This is the atom's working order and nothing more: no
  engine outputs a placing, and the first-appearance tie-break is not a rule
  about dead heats (§6).

### 3.3 Two outcomes and no third

A format version this implementation does not run, an unknown dialect, an
unknown kind, a kind that needs a place bound to none, parameters that do not
fit, or a broken cross-document law makes a document **readable but not
runnable**. The geometry
still draws; the implementation must refuse to produce results rather than
running what it happened to understand. Silently dropping a rule is how a timing
system disqualifies the wrong person.

Planning a document against the dialects an implementation ships gives the
kernel rules, or a refusal carrying four members, any of which makes it one:

- `unknown_version`: the document's `pace-geojson` when it is not a version
  the implementation runs (this specification is version 1), and null
  otherwise. A version is still decoded — it is an integer ≥ 1, or the file is
  not a document (§2.1) — because a reader has to draw a document written
  against a later version, and must not run it as this one;
- `missing_dialects`: every entry of `pace:dialects` the implementation does
  not ship;
- `refused`: every rule that could not be compiled, as `{ id, dialect, kind,
  why }`, where `why` is the first of these four that holds, in this order and
  in these words:
  - `unknown dialect` — its dialect is not shipped;
  - `unknown kind` — its kind is not in the dialect;
  - `needs a place` — the kind means nothing without a place (§3.4 marks
    which) and its `at` is `null` or a span;
  - `parameters do not fit` — `params` is not a JSON object, or is not the
    kind's shape (§3.4). An object is required even of a kind with no
    parameters: `[]` and `"x"` do not fit `{}`;
- `broken`: every cross-document law broken (§2.1).

A rule is compiled against its own `dialect`, whether or not `pace:dialects`
lists it. The decode corpus asserts the unknown version, the missing dialects
as a set, the broken laws as a multiset of sentences, and the refused rules as
a set of `{ id, why }`.

### 3.4 The dialects of version 1

Four dialects, eleven kinds. Each kind decodes its `params` — a JSON object;
every field listed is required, extra fields are ignored — and expands into
one kernel rule. Parameters that are not this shape refuse the rule (§3.3).
`here` is the rule's `at`. Two kinds **need a place**, because they mean
nothing without one: `station_required` (the station) and `qualifies_within`
(the finish the time is run to). Bound to `null` or to a span, they are
refused with `needs a place` rather than given an invented one. Places a kind
makes for itself carry a fixed point id, so a document that wants them matched
by id names its points that way.

The **`at`** column says what to bind each kind to. For every kind but
`cutoff_at` and the two that need a place, `at` changes nothing but dormancy
(§3.2): bound to a place, the rule does not judge an entrant who has not
reached it. That is rarely what a day-wide rule wants — a `cutoff_within`
bound to the finish never gates a runner who is still out — so bind those to
`null`.

| dialect · kind | at | params | when | then |
| --- | --- | --- | --- | --- |
| `athletics@1` · `cutoff_at` | the place it is judged at, or `null` for the finish | `at` (instant, §2.3), `says` (string, the time as the organiser wrote it) | `clock wall gt at` | `set_standing gated "cutoff"` |
| `athletics@1` · `cutoff_within` | `null` | `within_ms` | `clock elapsed gt within_ms` | `set_standing gated "over time"` |
| `athletics@1` · `qualifies_within` | the finish — **needs a place** | `within_ms`, `award` | all of: `observed{here, finished}`, `clock elapsed lte within_ms` | `award award` |
| `athletics@1` · `station_required` | the station — **needs a place** | `penalty_ms`, `each_time` (boolean) | not `observed{here, punched}` | `adjust_time penalty_ms, each_time` |
| `athletics@1` · `no_outside_help` | `null` | `{}` | `flag outside_help` | `set_standing disqualified "outside help"` |
| `backyard@1` · `lap_within` | `null` | `within_ms`, `from_m`, `to_m`, `lap` (the lap number, an integer ≥ 1; any other value does not fit) | `clock split gt within_ms` from `{lap-N-start, from_m}` to `{lap-N-finish, to_m}`, N = `lap` | `set_standing gated "lap N not closed in the hour"` |
| `backyard@1` · `last_standing` | `null` | `award` | all of: `standing clean`, not `withdrawn`, `field remaining lte 1` | `award award` — stratum 1 |
| `orienteering@1` · `controls` | `null` | `controls` (array of `{point, along_m}`, `point` a string), `in_order` (boolean) | in order: not `order{controls}`; in any order: any of not `observed{control, punched}` | `set_standing disqualified "mispunch"` |
| `triathlon@1` · `drafting` | `null` | `seconds_ms`, `penalty_ms`, `from_m`, `to_m` | all of: `clock split gt seconds_ms` from `{draft-zone-enter, from_m}` to `{draft-zone-leave, to_m}`, not `flag overtaking` | `adjust_time penalty_ms, each_time` |
| `triathlon@1` · `wetsuit_limit` | `null` | `max_c` | all of: `quantity water_c gt max_c`, `flag wetsuit` | `set_standing disqualified "wetsuit above the legal temperature"` |
| `triathlon@1` · `transition_neutral` | `null` | `from_m`, `to_m` | `observed{transition-in @ from_m, entered}` | `neutralise` from `{transition-in, from_m}` to `{transition-out, to_m}` |

Every `when` is one `all` unless it says *any*. Each kind also produces a
sentence a person reads, kept on every firing; its wording is not part of the
conformance surface, and neither is a `reason`.

What each kind does, read literally, and what its sentence therefore says:

- `qualifies_within` needs a `finished` observation **at its own place** — the
  finish it is bound to — as well as *elapsed* inside the time. Elapsed alone
  runs to the last read, so it would award a runner still on the course, or one
  who withdrew early; and any `finished` is not enough, because on a lapped
  course every lap line produces one, so a runner who stopped after two laps of
  four would qualify. Bound to the finish it is also dormant until the entrant
  gets there, so a live view never awards it early. Bound to a place that
  produces no `finished` (a mat), the producer law of §2.1 refuses it.
- `each_time` multiplies by §3.2's *occurrences*, which counts observations
  matching an `observed` clause, not offences. So `station_required` with
  `each_time: true` fires for a runner who missed the station and adds
  nothing: its one `observed` clause found nothing, which is why it fired. Its
  sentence says so. And `drafting`, whose predicate has no `observed` clause,
  adds its penalty **once** per fold: its split runs from the first read
  entering the zone to the first read leaving it, so a second pass is not a
  second offence. Its sentence says *once*. Counting offences would take a
  kind that means something new, which is a new dialect major (§7), not a
  change to these.
- `lap_within` gates a lap *closed* late. A split needs both ends, so a runner
  who stops mid-lap is not gated by it.
- `station_required` fires for a runner who withdrew before its place: a
  withdrawal ends the day, and dormancy with it (§3.2).
- `wetsuit_limit` never fires when no water temperature was taken, because a
  measurement nobody took is false.
- `cutoff_at` is one instant for everybody. In a wave or corral start a later
  wave meets it earlier in its own race; a limit that should follow each
  entrant's own start is a `cutoff_within`, or each wave is its own document.
  Version 1 has no per-wave instant.

## 4. The boundary

pace-geojson has no IO. Everything outside is a **bridge**, and its only output is
the ordered observation log. The bridge owns the four hard problems, and they
are outside the language because each would make it untestable:

1. **Identity** — a transponder id is not an entrant; the tag ↔ entrant binding
   is owned over time, and a correction is a rebinding.
2. **Clock discipline** — device time, received time, corrected time; the
   language sees only the third.
3. **Dedupe** — forty reads of one tag in three seconds become one `passed`;
   the raw reads are kept for the protest.
4. **Lateness** — a reader offline for an hour uploads late; the log is
   re-sorted and re-folded. Correct by construction, because the fold is
   deterministic.

Three more things are the bridge's because the log cannot say them:

- **Unique ids** (§2.3). A bridge that merges devices or feeds namespaces the
  ids it writes.
- **One log per document.** An observation names no way and no document, so
  a bridge serving several ways on shared mats sends each entrant's
  observations to the document of the way they entered, and folds each
  document over its own log.
- **Which clock is official.** Every clock in §3.2 runs from the entrant's own
  first `started`: net time. For gun time the bridge writes each entrant's
  `started` at the gun (a `manual` or `virtual` source says it was not read);
  publishing both takes two folds. A missed start read leaves *elapsed* null,
  and with it every elapsed limit and qualifying time, so a bridge that knows
  the gun or the corral release writes the start from it and says so in
  `source`.

**A reference bridge exists** — `ts/src/bridge.ts` — and is deliberately **not
part of the conformance surface**. It is IO, so another implementation will
have its own: a Rust core driving real hardware would bind tags and correct
clocks in Rust, and nothing about that should have to match this one byte for
byte. What must match is the log it produces, which is §2.3, and the fold over
it, which is §3.

Its shape, for anyone writing another: raw reads carry the device's clock *and*
the received-at, because their difference is the evidence that tells a drifted
reader from a reader that was offline — the reference keeps both and reads
neither; tag bindings are bounded in time, because the same chip is worn by
somebody else next season; a device's clock is corrected by **one measured
offset** per device, and estimating drift over a long day — a rate, a resync
mid-race — is the integrator's; a burst inside a debounce window becomes one
observation stamped at the **first** sighting, with the count kept, whatever
the signal strength of later reads; and every read that cannot be used comes
back as *stranded* with a reason rather than being dropped, because on the day
an unbindable read is a person standing at a mat wondering why the beep did
not happen.

**A watch as the timing system.** `self_timed(track, document, entrant,
started_at)` turns a runner's own recording — samples of `[lat, lon, seconds
from the start]`, latitude first, unlike GeoJSON — into one observation at
every point of the document: the place's own observation kind (§2.2), stamped
at the moment the runner had covered the same share of their own track as the
place is of the course, with `source: "watch_upload"`. It refuses a track
whose length is more than 15 % off the course's `path_length`, so a recording
of a different distance is not scored, while a watch that lost signal in a
tunnel still is. That is the whole test: it does not compare the route, so a
training run or a drive of the right length passes, and because it writes
every place's kind — a `punched` at every `control` — a watch upload cannot
prove anyone was at a station. A route check is map-matching, which the
language leaves upstream (§6).

The rest of `ts/src/` is equally outside the conformance surface: `build.ts`
makes a document from a course line, `simulate.ts` makes a seeded ghost field's
log, `replay.ts` answers "where was everybody at *t*", and `pacing.ts` answers
"what even pace clears every cut-off?" by folding a one-entrant log, which
reads no climb. What is normative is `ids.ts`, `text.ts`, `document.ts`,
`kernel.ts`, `pack.ts`, `packs/`, `observe.ts`, `fold.ts` and `run.ts`, which
is what `rust/src/` implements.

### 4.1 The entrant state

What a fold says about one entrant, as it crosses a boundary. One per entrant
in the settled log, in order of first appearance; `schema/entrant-state.schema.json`
is its schema, and both engines encode it member for member.

| member | type | meaning |
| --- | --- | --- |
| `entrant` | string | whose day this is |
| `standing` | `clean` · `penalised` · `gated` · `disqualified` | where the day ended up (§3.2) |
| `started_at` | instant \| null | *started at*, or null: never seen starting |
| `finished_at` | instant \| null | *finished at*: the **last** `finished`, or null |
| `withdrew` | boolean | a `withdrew` was observed. A fact, not a standing |
| `total_ms` | number \| null | *total* (§3.2): net time, to *finished at* or to the last read |
| `adjustment_ms` | number | the sum of every `adjust_time` that fired |
| `neutralised_ms` | number | time taken off the clock (`neutralise`) |
| `laps` | integer | `finished` observations |
| `punches` | integer | `punched` observations |
| `awards` | string[] | in the order first given |
| `classes` | `{dimension, value}[]` | each `classify` that fired, the latest per dimension |
| `applied` | `{id_rule, kind, sentence, times, added_ms}[]` | every rule that fired, in the order it fired (§3.2) |

Instants are written `YYYY-MM-DDTHH:MM:SS.sssZ`; a whole number of
milliseconds is written as an integer (`2790000`, never `2790000.0`). The
corpus asserts on six members (§5); the differential test compares all
thirteen.

The state says **what happened**, and leaves **placing** to whoever publishes
results:

- **Finished**: `finished_at` is not null. On a lapped course every lap line is
  a `finished`, so a finisher there is one whose `laps` is the number of laps.
- **Did not finish**: `started_at` is set and they did not finish. `withdrew`
  says whether they withdrew or were simply not seen again.
- **Did not start**: absent. The fold's entrants are the log's, so the start
  list — who entered — is the consumer's to compare against.
- **Disqualified, over time**: `standing`, with the rule's sentence in
  `applied`.
- **Never rank a non-finisher by `total_ms`.** It runs to their last read, so
  a runner who stopped at 5 km has the smallest total in the race.

### 4.2 The signatures a host has to provide

Language-neutral, as total functions. Nothing else is required, and nothing
here performs IO.

```
parse_document(bytes)             -> Document | ParseError          the laws of the text, then the per-field laws
laws(document)                    -> [BrokenLaw]                    the laws that need only the document
plan(document, dialects)          -> [KernelRule] | NotRunnable     §3.3, and the producer law
parse_log(bytes)                  -> [Observation] | ParseError     the laws of the text, then §2.3's per-field rules
log_laws([Observation])           -> [BrokenLaw]                    §2.3's log law
fold([KernelRule], [Observation]) -> [EntrantState]                 §3, encoded as §4.1
```

The two parsers take **bytes**: the file as it was written, not a value some
other parser made of it. The laws of the text (§2) can be checked nowhere
else.

A host that has the two files and wants the answer composes them as one call,
`run(dialects, document, log)`, which both engines provide and which answers
exactly one of three:

| answer | when | carries |
| --- | --- | --- |
| `{"kind": "ran", "states": [...]}` | the document parses and plans, and the log parses and keeps its law | every entrant state (§4.1) |
| `{"kind": "refused", "why": {...}}` | the document parses and does not plan (§3.3) | `unknown_version`, `missing_dialects`, `refused` as `{id, dialect, kind, why}`, `broken` as `{law, what}` |
| `{"kind": "malformed", "why": "...", "broken": [...]}` | the document or the log does not parse, or the log breaks its law | `why` in the engine's own words; `broken` the log laws as `{law, what}`, empty when nothing parsed |

Checked in this order: the document parses, the log parses, the document
plans, the log keeps its law. So an unparsable document or log is malformed
whatever else is true, and a document that does not plan is refused even
when its log repeats an id. Everything but the `why` of a malformed answer is
the same, member for member, in both engines; for a law of the text both
`why`s begin with the law's sentence (§2).

`run` takes the two files as text, like the parsers it is made of. The
reference's also takes, for either, a value a JSON parser has already made —
a host in JavaScript may hold nothing else — and then answers for everything
a value can still show: every law but the text's. The Rust has the same
shorter road, a derived `Deserialize`, with the same blindness. Neither is
`parse_document`.

## 5. Conforming

The corpus is part hand-written and part generated. A case carrying a
`generated` member was produced from a synthetic course (`corpus/courses/`) and
a seeded field by `ts/scripts/make-conformance.ts`; its `expect` is what the
reference implementation produces, which is the contract — not a claim that it
is independently right. The hand-written cases are what stop that being
invisible, which is why both kinds are kept.

| case | dialect | entrants | written |
| --- | --- | --- | --- |
| `athletics-cutoff-and-station` | `athletics@1` | 3 | by hand |
| `backyard-last-standing` | `backyard@1` | 3 | by hand |
| `orienteering-order-and-correction` | `orienteering@1` | 2 | by hand |
| `triathlon-drafting-and-transition` | `triathlon@1` | 2 | by hand |
| `athletics-qualifies-within-needs-a-finish` | `athletics@1` | 4 | by hand |
| `athletics-qualifies-within-on-a-lapped-course` | `athletics@1` | 4 | by hand |
| `athletics-outside-help-and-a-retracted-flag` | `athletics@1` | 3 | by hand |
| `triathlon-wetsuit-reads-the-latest-measurement` | `triathlon@1` | 7 | by hand |
| `orienteering-any-order-and-a-missing-punch` | `orienteering@1` | 3 | by hand |
| `each-time-counts-what-the-predicate-observes` | `athletics@1`, `triathlon@1` | 2 | by hand |
| `example-10k-the-readme-race` | `athletics@1` | 5 | by hand: `examples/10k`, the README's race |
| `backyard-five-laps-corralled-hourly` | `backyard@1` | 8 | generated, `loop-6720` |
| `half-flat-field-inside-cutoff` | `athletics@1` | 10 | generated, `half-flat` |
| `long-day-millisecond-arithmetic` | `athletics@1` | 8 | generated, `ride-500k` |
| `marathon-cutoff-cuts-the-tail` | `athletics@1` | 12 | generated, `marathon` |
| `station-required-with-dropped-reads` | `athletics@1` | 12 | generated, `half-hilly` |
| `ultra-wide-field-eight-hour-cutoff` | `athletics@1` | 14 | generated, `trail-50k` |
| `cutoff-edge-exact-pace-finishes` | `athletics@1` | 1 | generated, `road-44k` |
| `cutoff-edge-one-second-slower-is-gated` | `athletics@1` | 1 | generated, `road-44k` |

**Nineteen cases, 104 entrant states**, and every kind of every dialect is
reached by at least one of them — `controls` both in order and in any order —
which both engines' runners check. The cut-off edge pair is one document
twice: a runner at exactly the limit is clean, one a second per kilometre
slower is gated, and an implementation that rounds anywhere gets one of them
wrong. The decode corpus is **54 cases: 14 accept, 23 reject, 17 refuse**,
written by `ts/scripts/make-decode-corpus.ts` as one base document and one
mutation each. Eight of the fourteen accepted documents carry a log with a
verdict of its own: one accepted (an instant with and without milliseconds),
six rejected (an offset, a time that is not one, a day that does not exist, a
missing member, a member named twice, half a surrogate pair) and one refused
(an id used twice). Eleven of the cases carry a **text** where the others carry
a value — nine a document's, two a log's. Ten do because the law each tests is
one of the text's (§2), and a JSON value cannot break it; one because it is
about a number written with more digits than a double holds (§1), which a
JSON writer would write shorter. The seven synthetic
courses (`half-flat`, `half-hilly`, `marathon`, `trail-50k`, `ride-500k`,
`loop-6720`, `road-44k`) are written by `ts/scripts/make-courses.ts`; they sit
within a couple of degrees of 0° N 0° E, in open sea, so nobody mistakes one
for a real course. A generated case depends on its course only through the
course's length, because neither the fold nor the simulator reads a
coordinate.

```
node ts/scripts/make-courses.ts          # the synthetic courses
node ts/scripts/make-conformance.ts      # the generated conformance cases
node ts/scripts/make-decode-corpus.ts    # the decode corpus
```

**The procedure.** For every `corpus/conformance/*.json` — `{ name, why,
generated?, document, log, expect }`:

1. `parse_document` the `document` and `plan` it against your dialects. It
   must plan.
2. `fold` the `log` under the planned rules.
3. The entrants you produce must be exactly the entrants `expect` names — none
   extra, none missing — and each must match its entry on every field:
   `standing`, `total_ms` and `adjustment_ms` exactly, `awards` in order, and
   `laps`.

For every `corpus/decode/*.json` — `{ name, why, document | document_text,
log? | log_text?, expect: { verdict, laws?, missing_dialects?, refused?,
unknown_version?, log? } }`:

- A case carries its document as `document`, a JSON value, or as
  `document_text`, a string that is the file's text. Parse a text exactly as
  it is written, without passing it through another JSON reader first: what
  it tests would not survive one. A value may be written out by any JSON
  writer and parsed, and must get the same verdict. A log is carried the same
  two ways, as `log` or as `log_text`.
- `accepts`: the document parses and plans.
- `rejects`: the document does not parse.
- `refuses`: it parses and does not plan, and the refusal matches — `laws` as
  a multiset of the sentences in §2.1, `missing_dialects` as a set, `refused`
  as a set of `{ id, why }` (§3.3), `unknown_version` as the version refused.
  An absent member is empty or null.
- When `expect.log` is present, the case carries a `log`, judged beside its
  accepted document: `accepts` — it parses and keeps its law; `rejects` — it
  does not parse (§2.3); `refuses` — it parses and breaks the log law, whose
  sentences `expect.log.laws` names as a multiset.

**Two levels.** A *reader* — a map, a validator, an editor — must get every
decode case right: it draws what it accepts and what it refuses, and it runs
neither. A *runner* must also pass every conformance case. There is no level
that runs a document it would refuse.

A new dialect kind lands with a case. That is how the specification grows, and
it is the only way it grows (§7). Every kind of version 1 has its case. What
the corpus does not yet reach is kernel no shipped kind uses: the `moving`
clock, `classify`, the `count` of anything but laps, and the `rank`,
`finishers` and `winner_elapsed` aggregates. The definitions above are what
both engines implement for those, and the first kind to use one lands with the
case that pins it.

### 5a. Two engines, one author

`rust/` implements §2–§3 from this document and the corpus rather than from
the TypeScript. It passes all 19 conformance cases — **104 entrant
states** — and all 54 decode cases, and separately pins the
properties §3 states rather than inheriting them: scrubbing to the end equals
the race, a standing only worsens as time runs, the log's arrival order cannot
change the result, a correction supersedes, an unknown dialect is refused by
name, and instants parse to the millisecond.

```
cargo test --workspace
```

**What that does and does not prove.** It proves the specification is
sufficient to build against: nothing had to be guessed from the reference's
source. It does not prove independence — the same author wrote both, so a
shared misreading would be invisible to it. The value is in what happens
*next*: the corpus has two implementations to keep honest, and the next
divergence between them is a case rather than an argument. A third
implementation, by somebody else, is what would prove the rest.

The Rust instant parser is hand-written rather than pulled in — a date library
would be a second opinion about what a timestamp means — and both engines
accept exactly §2.3's instants and nothing else.

Where the two engines once read a file differently — an omitted member read
as null, a `type` not checked, an offset read as UTC, a date that does not
exist read as 1970, a member named twice kept by one and refused by the
other, half a surrogate pair held by one and not the other — each is now a
decode case, and the sweeps in §5b damage a lawful file every way they can to
look for the next one.

A decimal with more digits than a double holds was one more. The Rust's
parser read a neighbour of the nearest double from sixteen significant digits
on, so `730.65172614218456` was two numbers a step apart: a penalty written
back differently and, for water written a hair over a legal temperature, two
standings. The largest double, written with one digit more than it has, was a
file to one engine and malformed to the other. Both read the nearest double
now (§1). The verdict is a decode case,
`accepts-the-largest-double-written-long`; a number a step apart cannot be
one, because a case carries a value and a value has lost how its number was
written, so those are a sweep: the fourth in §5b.

**What they still read differently**, all of it outside anything the corpus
pins, and none of it in a file a producer writes. Each is held in
`ts/test/differential.test.ts`, with the nearest file on which the engines
agree beside it, so this list fails a test the day it stops being true:

- **The order of two ids.** The Rust orders ids by UTF-8 bytes, the reference
  by UTF-16 code units. These agree unless one id holds a character from
  U+E000 to U+FFFF and the other a character past U+FFFF; every id in the
  corpus is ASCII.
- **A number no double holds** (`1e999`, and anything from half a step past
  the largest double on). Read as a member of the document or of an
  observation, both reject it; in a member nothing reads, both step over it.
  They part inside the four members the Rust keeps as generic JSON until
  it knows what they are — a rule's `at` and `params`, a feature's `geometry`
  and `properties` — where its parser must read the number to keep it and
  cannot. There the Rust answers malformed; the reference ignores it in a
  foreign member, and as a dialect's parameter refuses the rule with
  `parameters do not fit`.
- **Nesting 128 deep.** The Rust's JSON parser stops at 128 arrays and objects
  inside one another, and reaches that depth only in the same four members;
  the reference has no limit. A foreign member nested that deep in one of
  them is malformed to the Rust and ignored by the reference. A document's
  own members nest seven deep.
- **A whole number past 2⁵³ − 1.** Both fold the same double; the reference
  writes it out in digits and the Rust as a float (`9007199254740994.0`), and
  a duration that long is said differently in a sentence. 2⁵³ milliseconds is
  285 000 years.

### 5b. Both engines, on fields nobody wrote down

The corpus is cases a person chose. The other half of keeping two
implementations honest is a sweep, `ts/test/differential.test.ts`: six of the
synthetic courses (`marathon`, `loop-6720`, `half-hilly`, `half-flat`,
`ride-500k`, `trail-50k`), each run two ways — a road race under
`cutoff_within`, `station_required`, a `qualifies_within` bound to the finish,
`no_outside_help` and `wetsuit_limit`, with officials' flags and a water
temperature either side of the limit in the field; and four laps under
`lap_within` and `last_standing` — against four sets of dials (pace, spread,
dropped reads, withdrawals, one of them dropping every read), with 25
simulated entrants each. Of those 48 fields, 44 build and plan; every one is
run by both engines and compared on the whole answer `run` gives (§4.2):
every member of every entrant state, instants and sentences included.
**44 fields, 1 100 entrant states, no disagreement**, and the sweep checks
that it reached a penalty, a gate, a disqualification and an award. What it
does not reach is what those kinds do not: `drafting`, `transition_neutral`,
orienteering, `cutoff_at`, a crowned last one standing, and the rest of §5's
list.

A second sweep is about files rather than folds. It takes one lawful document
and log (`athletics-cutoff-and-station`) and damages them 176 ways: every
member of every object left out in turn, and a log instant with an offset,
one that is not a time, a day that does not exist, one without milliseconds,
and an id used twice. Both engines must give the same answer to each — the
same kind, and for a refusal the same reasons, for a malformed log the same
broken laws. Of the 176, 171 are malformed, 4 refused and 1 runs.

A third is about the text (§2), which the second cannot reach: it is built
from values, and no JSON writer will write a value's member twice. So the same
document and log are written out by hand, with each of their 171 members
named twice — once plainly, once with the second name spelled under an escape
— and with each of the 77 strings a member holds cut to half a surrogate
pair. **419 texts, every one malformed in both engines, for the same law.**
And the other way about: the lawful text spaced out, or with every name
spelled under an escape, is the same file to both and runs to the same answer.

A fourth is about a number written with more digits than a double holds (§1),
which no generated field contains: a writer gives a double its shortest form.
1 800 decimals of thirteen to twenty-one significant digits go through a
rule's parameter and come back in the answer. 400 water temperatures are
written between a legal limit and the next double above it, where the nearer
of the two decides a disqualification. And the largest double is written
long. **2 200 numbers, every answer the same in both engines, to the byte.**

Every sweep hands both engines the same two strings, so what is compared is
each engine's reading of a file, its JSON parser included.

```
wasm-pack build wasm --target nodejs --out-dir pkg-node --release   # the Rust core, for Node
cd ts && npm ci && PACE_GEOJSON_REQUIRE_CORE=1 npm test             # the sweep runs with everything else
```

Without `PACE_GEOJSON_REQUIRE_CORE=1` the sweep is skipped, not failed, when the
core has not been built — a fresh checkout has one engine, and a test that
failed for that would be a test about the toolchain. With it, as in this
repository's CI, a missing core fails: a differential test that compared
nothing must not pass. And it was checked the only way a differential test can
be: by breaking the Rust on purpose (`worse_of` made to never worsen a
standing) and confirming it reported disagreements by the hundred — 440 of
900 states on the sweep as it stood the day it was tried — named by entrant and
field.

The WebAssembly build exposes the same comparison to a browser.
`run(document_json, log_json)` takes the two files as JSON text and answers
§4.2's `run` as JSON text, and `dialects()` returns the dialect ids the build
ships. A tool that simulates fields live can fold every one twice: every
field somebody sets up is another differential test, and a disagreement shows
up beside the standings.

## 6. What is deliberately absent

- **Results in the document.** A file rewritten on every position ping would be
  neither coherent nor fast. Results are the fold's output. A document may
  carry a `pace:results` snapshot with an `as_of` for handing to somebody
  offline; it is never the source of truth, and no reader is required to
  understand it.
- **A scripting language.** Rules are a closed vocabulary over typed
  parameters. That is what a rehearsal can simulate against a ghost field and
  what a court could read.
- **Geometry maths.** Distance along the course arrives as `along_m` on an
  observation. Turning a GPS position into one is map-matching, and it belongs
  to the bridge.
- **Presentation.** Placing, dead heats, rounding a published time, whether a
  gated finisher is placed, and conversion to other interchange formats (IOF
  XML 3.0 for orienteering, a vendor's export) belong to whoever publishes the
  results, under the federation's rules. The entrant state (§4.1) is what they
  work from.

**Not in version 1**, and not by design — each needs a meaning that does not
exist yet, so each is a new dialect or a new format version:

- entrant attributes: age groups, gender categories, results by category
  (`classify` exists in the kernel; no kind uses it, and nothing feeds it
  registration data);
- relays and teams, stage races and multi-day totals;
- a gun instant in the document, and a wall-clock gate per wave (§3.4);
- a decision an official makes that no kind names — a disqualification for a
  bib swap, a time penalty for littering — and an audit trail for corrections:
  a `supersedes` carries no author, authority, reason or time of its own.
  Until then those records are the bridge's;
- a reference to a course certificate (body, certificate id, date).

## 7. Versioning

Three things carry a version, and they move independently.

- **The format**, `pace-geojson`: the shape of the document and the
  observation, the laws, the producer table and everything in §3. This is
  version 1. A change that alters the verdict on, or the fold of, a document
  that was valid before is a new format version. `pace-geojson` is an integer
  ≥ 1 (a per-field law), and a version an implementation does not run is
  readable but not runnable (§3.3): it draws, and `plan` refuses it with
  `unknown_version`. Nothing runs a version-2 document as version 1.
- **A dialect**, `name@major`. Within a major a dialect is **append-only**: it
  may gain kinds, and nothing else. An existing kind's parameters, their units,
  its expansion and its meaning never change, because a rule written in 2027
  has to mean in 2031 what somebody entered under — otherwise a result stops
  being reproducible, which is the point of a fold. Changing what a kind does
  is a new major, `athletics@2`, shipped beside `athletics@1`; a document names
  the major it was written in and keeps meaning the same thing.
- **The code**: the npm package and the Rust crates follow semantic versioning
  of their own. A release that implements a new format version or dialect
  major says so in `CHANGELOG.md`.

**What is breaking**, at the format level: a new per-field, cross-document or
log law, a changed definition in §3.2, a new place kind in the producer table (a
document using that kind planned against `passed` before), a changed
evaluation order, a new or changed atom or consequence semantics. At the
dialect level: anything but a new kind.

**Before the first release.** None of this is frozen yet. Until the first
release is tagged, version 1 and its dialects may still change what they mean
— this is the cheapest the change will ever be — and `CHANGELOG.md` records
every such change. From that tag, the rules above hold without exception: a
change that alters any verdict or any fold is format version 2, or a new
dialect major, even while the packages are 0.x.

**How a new kind lands.** In both engines, in one change, with a conformance
case whose `expect` depends on it — a document using the kind, a log, and at
least one entrant whose state would differ without it — and with a decode case
for any law or refusal it introduces. The case is the definition; this
document's table in §3.4 is its summary. A kind with no case does not exist
yet; every kind of version 1 has one, and both engines' conformance runners
fail if a shipped kind is reached by none. A new atom or consequence needs a
case no existing kind can express.
