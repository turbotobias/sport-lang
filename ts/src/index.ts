/**
 * pace-geojson — a race's rules, in a language that can be simulated.
 *
 * ```
 *   a mat · a tracker · a tablet · a watch upload · a partner's webhook
 *                              │
 *                          the bridge          (identity · clock · dedupe · lateness)
 *                              │
 *                    an ordered observation log
 *                              │
 *   a course document ──────► fold ──────► every entrant's day
 *   (dialects + rules)                     (derived, deterministic, replayable)
 * ```
 *
 * Read `kernel.ts` for what a rule can say, `pack.ts` for how a sport gets a
 * vocabulary without changing that, `observe.ts` for why timing is outside the
 * language, `fold.ts` for the evaluation order, and `document.ts` for the file
 * that carries all of it. Every module is also importable on its own —
 * `pace-geojson/document`, `pace-geojson/fold`, `pace-geojson/packs/athletics`.
 *
 * @see SPEC.md §4 — the four calls a host provides: parse, laws, plan, fold
 */
export * from './ids.ts'
export * from './kernel.ts'
export * from './observe.ts'
export * from './pack.ts'
export * from './fold.ts'
export * from './document.ts'
export * from './bridge.ts'
export * from './build.ts'
export * from './replay.ts'
export * from './simulate.ts'
export * from './pacing.ts'
export * from './run.ts'

import type { TPack } from './pack.ts'
import { athletics } from './packs/athletics.ts'
import { backyard } from './packs/backyard.ts'
import { orienteering } from './packs/orienteering.ts'
import { triathlon } from './packs/triathlon.ts'

/**
 * The dialects this build understands.
 *
 * A document naming anything not in here is readable — the course still draws —
 * and **not runnable**: `plan` refuses the rule by name rather than dropping
 * it, because a fold that silently skips a gate reports a finisher who was cut.
 */
export const PACKS: ReadonlyArray<TPack> = [athletics, backyard, orienteering, triathlon]

export { athletics, backyard, orienteering, triathlon }
