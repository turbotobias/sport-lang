# Reading a result

How to turn the fold's entrant states into a results page: who finished, who did not, who did not
start, how to place them, what time to publish, and what an official can and cannot record.
[SPEC §4.1](../SPEC.md#41-the-entrant-state) is the normative definition of the state.

## The entrant state

`fold` returns one state per entrant who appears in the log, with 13 members:
`entrant, standing, started_at, finished_at, withdrew, total_ms, adjustment_ms, neutralised_ms,
laps, punches, awards, classes, applied`.

- `standing` is one of `clean < penalised < gated < disqualified`, and it **only ever worsens**.
- `total_ms` is net time: from the entrant's own first `started`, less anything neutralised, plus
  every adjustment. Elapsed is finish − start, or last observation − start when there is no
  finish; it is null without a `started`.
- `applied[]` lists every rule that fired as `{id_rule, kind, sentence, times, added_ms}`. The
  sentence is generated from the rule itself by `plan`, so the words cannot drift from what the
  rule does. Show it at the results desk: a protest then argues with a sentence, not a config
  screen.

The corpus asserts on six members (`entrant, standing, total_ms, adjustment_ms, awards, laps`); the
two engines are compared on all of them.

## From a state to a results line

| results line | read it from |
| --- | --- |
| finished | `finished_at` is not null; on a lapped course, `laps` is also the number of laps, because every lap line produces a `finished` |
| did not finish | `started_at` is set and they did not finish; `withdrew` says whether they withdrew or were simply not seen again |
| did not start | absent: the fold's entrants are the log's, so the start list is yours to compare against |
| disqualified, over time | `standing` is `disqualified` or `gated`, and `applied[].sentence` says which rule and why |
| placing | yours: finishers ordered by `total_ms`, within whatever grouping your rules use |

**Never rank on a non-finisher's `total_ms`.** It runs to their last read, so a runner who
stopped at 5 km has the smallest total in the race.

## Placings are the publisher's

Placing, dead heats, rounding a published time (up to the whole second, say), whether a gated
finisher is placed, and conversion to IOF XML 3.0 or a vendor's export belong to whoever publishes
the results, under the federation's rules. The kernel's `field` atom does rank finishers by
`total`, ascending, from 1, for rules that read it (a cut-off at 120 % of the winner), but no
shipped kind publishes a placing. A converter is a welcome contribution.

## Gun time and chip time

There is one clock per entrant, net time from their own first `started`. For gun time, the bridge
writes a `started` at the gun for every entrant; publishing gun and net side by side takes two
folds. A missed start read leaves `total_ms` null, and with it every elapsed limit and qualifying
time, so a bridge should write the start from the gun or the corral and say so in `source`. A
document-level gun instant would be a new format version.

## Waves

`cutoff_at` is one wall-clock instant for everybody, so a later wave meets it earlier in its own
race. For a wave start, write time limits as `cutoff_within`, which runs from each entrant's own
start, or give each wave its own document. A gate per wave is not expressible yet.

## Categories, relays, stages

Entrants have no attributes in version 1: age groups, gender categories and results by category,
relays and teams, and stage races or multi-day totals are outside it. `classify` exists in the
kernel, but no kind uses it and nothing feeds it registration data. Group finishers yourself, from
your registration data, before placing them.

## What an official can record

An official can flag what a dialect reads (`outside_help`, `wetsuit`, `overtaking`), on any
observation, for instance from a marshal's tablet (`source: "manual"`). Any row can be corrected
by appending one that `supersedes` it: the replaced row stays in the log, where a protest can see
it, and no longer counts. A disqualification or time penalty for a reason no kind names, such as a
bib swap or littering, cannot be recorded, and a correction carries no author, authority, reason
or time of its own. Until a dialect for officials' decisions exists, those records belong to the
bridge.

## Live, and after the fact

The fold up to _t_ is the standings at _t_, and scrubbing to the end gives exactly the result, so a
live board and the official result cannot disagree. Corrections append, never edit: a late read or
an upheld protest is one more row, and the result follows. Replay is by event time over the log as it
stands now, corrections included; what a board showed before a late upload arrived is in the
bridge's arrival records, not in the format. A rule bound to a place is dormant until the entrant
reaches it, finishes or withdraws, so a live view never judges a station or a qualifying time
early.
