# The data model, on one screen

Three JSON shapes cross a boundary, and nothing else does. Each has a JSON Schema generated from the
TypeScript: [document](../schema/document.schema.json), [observation](../schema/observation.schema.json),
[entrant state](../schema/entrant-state.schema.json). [SPEC §2](../SPEC.md#2-the-data) is
normative.

## The course document

A GeoJSON `FeatureCollection`. Every document is valid GeoJSON, but not every GeoJSON is a
document: where RFC 7946 permits something and a result depends on it, pace-geojson requires it. Its
places are ordinary features addressed by metres along the course, not by coordinate: a course that
doubles back has two places at one lat/lon, but only one at 31 400 m. The path and the rules ride
along as `pace:` members, each rule a *kind* from a versioned *dialect*.

| member | type | meaning |
| --- | --- | --- |
| `pace-geojson` | `1` | format version, an integer ≥ 1; a version the engine does not run is refused, not guessed |
| `pace:id`, `pace:event` | string | this document, and the event it belongs to |
| `pace:way` | string \| null | the entry option (a distance, a category): one document per way, `null` when the event has one |
| `pace:name`, `pace:dialects` | string, `["name@major"]` | display name; every dialect the rules use |
| `pace:measure` | object | nine members, all nullable: `distance_m` and its method, `stated_m`, `certified_m`, ascent, descent, how elevation was taken |
| `pace:provenance` | array | `source`, `origin_url`, `sha256`, `format`, `verified_by`, `verified_at`, per original |
| `pace:path` | `[{line, from_m, to_m, repeat}]` | the course as a playlist over stored lines: four laps are one line with `repeat: 4` |
| `pace:rules` | `[{id, dialect, kind, ordinal, at, params}]` | `at` is a place `{point, along_m}`, a span `{from_m, to_m}`, or `null`; `params` is an object |
| `features` | GeoJSON | `properties.role` is `line` (LineString), `point` (Point), `segment` (LineString) or `zone` (Polygon) |

<details>
<summary><b>Why a root <code>"pace-geojson": 1</code> and <code>pace:</code> members?</b> What a reader can tell from the first bytes.</summary>

- **What.** The member that names the format also carries its version: `"pace-geojson": 1` sits beside
  `"type": "FeatureCollection"`, and everything the format adds is a `pace:` member.
- **Why.** A GeoJSON file is only a pace-geojson document if it says so, and a reader needs to know
  which rules it was written against before running any of them. One member answers both, the way
  `"openapi": "3.1.0"` does for an API description. The `pace:` prefix keeps the additions out of
  GeoJSON's own names, so RFC 7946 treats them as foreign members and every map tool ignores them.
- **So what.** Detection is one key lookup, with no schema and no guessing from shape. A version this
  engine does not run is refused by name (`unknown_version`), never run as `1`, and the same bytes
  still open in any GeoJSON viewer.

</details>

## The observation

The only input: `{id, entrant, at: {point | null, along_m}, kind, t, quantity_name,
quantity_value, flags, source, device, confidence, supersedes}`, every member present. `kind` is one
of 8: `started passed entered left punched checked finished withdrew`; `source` one of 6:
`transponder gps watch_upload manual partner virtual`. `t` is UTC and already corrected, so no
device clock reaches the language: exactly `YYYY-MM-DDTHH:MM:SS[.sss]Z`, on a real calendar day; an
offset is refused, not converted. **`id` is unique in the log**: it breaks ties and is what
`supersedes` names (`an observation id is used twice` makes a log malformed).

## The entrant state

The output, one per entrant in the log: `entrant, standing, started_at, finished_at, withdrew,
total_ms, adjustment_ms, neutralised_ms, laps, punches, awards, classes, applied`. `standing` is
`clean < penalised < gated < disqualified` and **only ever worsens**. `total_ms` is net time from
the entrant's own first `started`. **Never rank on a non-finisher's `total_ms`**: it runs to their
last read. [results.md](results.md) turns a state into a results line.

## What a place produces

**A place's `kind` fixes the observation it produces** (`control` → `punched`, `finish` →
`finished`, `mat` → `passed`, …), and a rule asking for any other kind there is refused. **If a rule
has to prove somebody was at a timing point, declare that point a `control`.** The whole table is
in [rules.md](rules.md#what-a-place-produces).
