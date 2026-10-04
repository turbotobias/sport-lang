# One event, end to end

A 10 km with one timing point at 5 km, four rules and five runners. The files are in
[examples/10k/](../examples/10k); a test folds them through both engines and fails if anything this
page shows disagrees with what the engines return. It is also the conformance case
[example-10k-the-readme-race](../corpus/conformance/example-10k-the-readme-race.json).

## The whole pipeline

Everything on this page happens somewhere on this picture. The bridge is yours; from the
observation log on, it is pace-geojson's.

```text
  mats · trackers · a marshal's tablet · a watch file · a partner feed
                        │  raw reads: tag, device clock, received-at
                        ▼
                     bridge             yours: identity · clock · dedupe · lateness
                        ▼
                observation log         append-only; a correction supersedes, never edits
                        │
  course document ──► plan ──► fold ──► every entrant: standing · total_ms · finished_at
  (GeoJSON + rules)     │                              awards · laps · the sentence why
                        └──► not runnable: unknown version, dialect or kind, or a broken law.
                             The course still draws; nobody gets a result.
```

([the bridge's part](implementing.md#the-bridge-is-yours), [a reference bridge](../ts/src/bridge.ts))

## The result

This is `fold(rules, log)`:

| entrant | standing | total_ms | adjustment_ms | awards | why (`applied[].sentence`) |
| --- | --- | --- | --- | --- | --- |
| `ent_ana` | clean | 2 790 000 (46:30) | 0 | sub-50 | Finishing inside 50:00 qualifies for sub-50. |
| `ent_ben` | gated | 5 100 000 (1:25:00) | 0 | — | The day ends for anyone reaching km-5 after 07:40. |
| `ent_cy` | penalised | 3 240 000 (54:00) | 120 000 | — | Missing km-5 costs 2:00. |
| `ent_dee` | clean | 2 880 000 (48:00) | 0 | sub-50 | Finishing inside 50:00 qualifies for sub-50. |
| `ent_eve` | disqualified | 3 300 000 (55:00) | 0 | — | Taking outside assistance ends the day. |

## The document

Trimmed; every member shown is exactly what the file holds:

```jsonc
// excerpt of examples/10k/document.json
{
  "type": "FeatureCollection",
  "pace-geojson": 1,
  "pace:id": "crs_example_10k", "pace:event": "evt_example", "pace:way": null,
  "pace:name": "Example 10K",
  "pace:dialects": ["athletics@1"],
  "pace:measure": { "distance_m": 10000, "distance_method": "wgs84-geodesic-2d", "stated_m": 10000 },
  // … six more measure members, and "pace:provenance": [], where each original file came from
  "pace:path": [{ "line": "ln_1", "from_m": 0, "to_m": 10000, "repeat": 1 }],
  "pace:rules": [
    { "id": "rul_gate", "dialect": "athletics@1", "kind": "cutoff_at", "ordinal": 0,
      "at": { "point": "km-5", "along_m": 5000 },
      "params": { "at": "2027-05-02T07:40:00.000Z", "says": "07:40" } },
    { "id": "rul_station", "dialect": "athletics@1", "kind": "station_required", "ordinal": 1,
      "at": { "point": "km-5", "along_m": 5000 }, "params": { "penalty_ms": 120000, "each_time": false } },
    { "id": "rul_help", "dialect": "athletics@1", "kind": "no_outside_help", "ordinal": 2,
      "at": null, "params": {} },
    { "id": "rul_sub50", "dialect": "athletics@1", "kind": "qualifies_within", "ordinal": 3,
      "at": { "point": "finish", "along_m": 10000 }, "params": { "within_ms": 3000000, "award": "sub-50" } }
  ],
  "features": [
    { "type": "Feature", "properties": { "role": "point", "id": "km-5", "kind": "control", "name": "5 km", "along_m": 5000 } }
    // … its geometry, the line ln_1, and the points "start" (0 m) and "finish" (10 000 m)
  ]
}
```

`plan` expands each rule into the kernel and writes its sentence from the rule itself, so the words
cannot drift from what the rule does. The gate is already in UTC; `says` is how the organiser wrote
it. `qualifies_within` needs a `finished` read at its place inside the time, so nobody still out,
withdrawn or short of the distance is awarded ([rules.md](rules.md)).

## The log

15 observations, every time 2027-05-02, UTC:

| entrant | `started` at start | `punched` at km-5 | `finished` at finish |
| --- | --- | --- | --- |
| `ent_ana` | 07:00:00 | 07:22:00 | 07:46:30 |
| `ent_ben` | 07:00:00 | **07:41:00** | 08:25:00 |
| `ent_cy` | 07:00:00 | _no read_ | 07:52:00 |
| `ent_dee` | 07:00:00 | 07:24:00 | 07:58:00 keyed in wrong (`obs_11`), then 07:48:00 (`obs_15`, which `supersedes` it) |
| `ent_eve` | 07:00:00 | 07:26:00, from a marshal's tablet with `flags: ["outside_help"]` | 07:55:00 |

`obs_11` stays in the log, where a protest can see it, but it no longer counts. Every row has the
same 12 fields.

## The late read

This one arrives an hour late, from a backup reader at 5 km:

```jsonc
// examples/10k/late-read.json
{
  "id": "obs_16", "entrant": "ent_cy", "at": { "point": "km-5", "along_m": 5000 }, "kind": "punched",
  "t": "2027-05-02T07:25:40.000Z", "quantity_name": null, "quantity_value": null, "flags": [],
  "source": "transponder", "device": "dev_km5_backup", "confidence": 1, "supersedes": null
}
```

Append it and fold again, and `ent_cy` is **clean at 3 120 000 (52:00)**. Nothing was edited and no
state was patched. The log grew by one row, and the result is a function of the log.

## The same two files answer the rest

A time here is an Effect `DateTime.Utc`; [api.md](api.md) has every signature.

| question | call | the engines' answer |
| --- | --- | --- |
| Standings at 07:30, live | `fold_until(rules, log, 07:30)` | `ent_eve` is already disqualified: the rule is bound to no place, so the marshal's flag at 07:26 applies at once. Everyone else is clean. `ent_cy`'s missing punch is **dormant** until they reach 5 km or their day ends; `sub-50` waits for the finish. |
| … and at 07:50 | the same | `ent_ben` is gated; `ent_ana` and `ent_dee` hold sub-50; `ent_cy` is still clean, not yet seen at 5 km or the finish. |
| Where is everyone at 07:30? | `order_at(positions_at(log, 07:30))` | ana 6 633 m, dee 6 250 m, cy 5 769 m, eve 5 690 m, ben 3 659 m, each interpolated between two reads (`between: true`; cy's spans the read the mat missed), by `along_m`, never by coordinates. |
| Can `ent_ben` still make the gate? (asked at 07:30) | append a `punched` with `source: "virtual"` at km-5, fold | At 07:40:00.000, clean. At 07:40:00.001, gated. The rule is _after_ 07:40, and time is whole milliseconds. |
| What even pace clears every cut-off? | `slowest_clear_pace(document, rules, 07:00)` | 479.99 s/km, an 8:00/km day: at 480 s/km `plan_at_pace` reaches km-5 at 07:40:00.000, clean; at 481, gated there. Found by bisecting a one-runner fold, so it works for rules nobody has written yet; it ignores climb. |
| What if 5 km were a plain `mat`? | change the point's `kind` | `plan` refuses: `a rule requires an observation the place never produces`, `rul_station wants punched at km-5, a mat which produces passed`. |
| What if it needed `ski@1`? | add it to `pace:dialects` | `plan` refuses with `missing_dialects: ["ski@1"]`. The course still draws; nobody gets a result. |
| Does it draw? | any GeoJSON viewer | Yes: the `pace:*` members are foreign members, which a viewer ignores. |

## Rehearsed before race day

On 1 000 simulated runners, the station rule fired 15 times, and every one was a read the mat
dropped; a field 30 s/km slower than planned turns 8 % gated into 19 %. The table and the field are
in [rehearsal.md](rehearsal.md).
