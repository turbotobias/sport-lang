# Rehearsing the rules before race day

How an organiser runs a document's rules against a simulated field before the event, and what the
README's 10 km shows when it is rehearsed. Every number on this page is recomputed by
[ts/test/readme.test.ts](../ts/test/readme.test.ts).

`simulate(document, config)` builds a seeded ghost field ([api.md](api.md#typescript) lists the
13 members of `config`). Fold it with the same rules, and `selectivity` says which rule fired for
how many runners. Here the field has 1 000 runners, seed 7, 1 % of mat reads dropped, 2 s of read
jitter, and a 1-in-1 000 chance per place of an outside-help flag, folded under the four rules of
[examples/10k/](../examples/10k). Nobody stops (`dnf: 0`):

| simulated field | clean | penalised | gated | disqualified | sub-50 | station rule fired |
| --- | --- | --- | --- | --- | --- | --- |
| median 6:00/km, spread 25 % | 903 | 15 | 80 | 2 | 281 | 15 |
| median 6:30/km, spread 30 % | 789 | 15 | 194 | 2 | 240 | 15 |

Every simulated runner passes 5 km, so **every station penalty is a read the mat dropped**. A rule
that fires on _not observed here_ is only as good as the hardware. The rehearsal is where an
organiser finds that out, not 15 protests after the race. The same run shows that a field 30 s/km
slower than planned turns 8 % gated into 19 %. With 3 % of runners stopping (`dnf: 0.03`),
penalties rise to 28, and 13 of those are runners who stopped before 5 km, whom the station rule
counts as a miss ([known-gaps.md](known-gaps.md)).

What to do with it:

- A station rule that fires on dropped reads wants a backup reader at that place, whose read
  clears the penalty when it arrives: the README's late read from `dev_km5_backup` is one.
- A gate that closes on a fifth of a slower field is worth checking against the pace the entry
  page advertises; `slowest_clear_pace` gives the even pace that clears every cut-off.
- The simulator sits outside the conformance surface: it is seeded (mulberry32, written out so
  another language can reproduce it), but a third engine need not ship one.
