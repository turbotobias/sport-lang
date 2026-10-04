/**
 * The branded identifiers of the language.
 *
 * Every id in a document and a log is a string, which means every id is
 * assignable to every other: a function taking a point id and a segment id
 * takes them in an order nothing checks, and a rule handed the wrong one fires
 * in the wrong place rather than failing. A brand is the cheapest fix — one
 * `Schema.decode` where the value is already being decoded, and nothing at
 * runtime, because `Schema.brand` is a type-level tag over the same string.
 *
 * **No format is checked.** Whoever mints an id owns its shape — `obs_…`,
 * `lap-3-finish`, a timing vendor's own serial — and the language only needs
 * two ids not to be confused. A host that wants a format checks it before the
 * value crosses into a document.
 *
 * @see SPEC.md §2.1 — the document members these ids appear in
 */
import * as Schema from 'effect/Schema'

/** The shared shape: a string. Named so a format check has one place to go. */
const Id = Schema.String

/** One course document — `pace:id`. */
export const DocumentId = Id.pipe(Schema.brand('DocumentId')).annotate({
  identifier: 'DocumentId',
  description: 'One course document — `pace:id`',
})
export type TDocumentId = typeof DocumentId.Type

/** The event a document belongs to — `pace:event`. Opaque to the fold. */
export const EventId = Id.pipe(Schema.brand('EventId')).annotate({
  identifier: 'EventId',
  description: 'The event a document belongs to — `pace:event`',
})
export type TEventId = typeof EventId.Type

/**
 * The way in — `pace:way`: the entry option an entrant signs up for, a
 * distance or a category. Opaque to the fold; `null` when the event has one.
 */
export const WayId = Id.pipe(Schema.brand('WayId')).annotate({
  identifier: 'WayId',
  description: 'The entry option an entrant signs up for — `pace:way`',
})
export type TWayId = typeof WayId.Type

/** A stored line a document's path is a playlist over. */
export const LineId = Id.pipe(Schema.brand('LineId')).annotate({
  identifier: 'LineId',
  description: 'A line a course document draws over',
})
export type TLineId = typeof LineId.Type

/**
 * A place on a course document, referred to by rules and by observations.
 *
 * Document-local — `lap-3-finish` — and branded anyway, because a point id and
 * a segment id both name a piece of the same course.
 */
export const PointId = Id.pipe(Schema.brand('PointId')).annotate({
  identifier: 'PointId',
  description: 'A named place on a course document — `lap-3-finish`',
})
export type TPointId = typeof PointId.Type

/** A named stretch of a course document. */
export const SegmentId = Id.pipe(Schema.brand('SegmentId')).annotate({
  identifier: 'SegmentId',
  description: 'A named stretch of a course document',
})
export type TSegmentId = typeof SegmentId.Type

/** One rule, as its sentence was written. */
export const RuleId = Id.pipe(Schema.brand('RuleId')).annotate({
  identifier: 'RuleId',
  description: 'One rule sentence',
})
export type TRuleId = typeof RuleId.Type

/** Whoever the fold is judging — one competitor on one way in. */
export const EntrantId = Id.pipe(Schema.brand('EntrantId')).annotate({
  identifier: 'EntrantId',
  description: 'One competitor the fold judges',
})
export type TEntrantId = typeof EntrantId.Type

/**
 * One thing a bridge saw.
 *
 * A correction names the observation it supersedes, so an observation id and
 * the id of the thing it corrects are the same shape and are passed side by side.
 */
export const ObservationId = Id.pipe(Schema.brand('ObservationId')).annotate({
  identifier: 'ObservationId',
  description: 'One thing a bridge saw',
})
export type TObservationId = typeof ObservationId.Type

/** A mat, a tracker, a tablet — whatever produced an observation. */
export const DeviceId = Id.pipe(Schema.brand('DeviceId')).annotate({
  identifier: 'DeviceId',
  description: 'Whatever produced an observation',
})
export type TDeviceId = typeof DeviceId.Type

/**
 * One raw sighting by a device, before anybody knows who it was.
 *
 * Distinct from {@link ObservationId} because forty of these become one of
 * those, and a function handed the wrong one would collapse a burst that had
 * already been collapsed.
 */
export const ReadId = Id.pipe(Schema.brand('ReadId')).annotate({
  identifier: 'ReadId',
  description: 'One raw sighting by a device',
})
export type TReadId = typeof ReadId.Type
