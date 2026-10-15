//! pace-geojson — a declarative language for the rules of an endurance event.
//!
//! ```text
//!   a mat · a tracker · a tablet · a watch upload · a partner's webhook
//!                              │
//!                          the bridge     (identity · clock · dedupe · lateness)
//!                              │
//!                    an ordered observation log
//!                              │
//!   a course document ──────► fold ──────► every entrant's day
//!   (dialects + rules)                     (derived, deterministic, replayable)
//! ```
//!
//! This is the **second** implementation. It exists to find out whether
//! `SPEC.md` is a specification or merely a description: it
//! was written from the spec and the conformance corpus rather than from the
//! TypeScript, so anywhere the spec is ambiguous the two disagree and the
//! corpus gains a case.
//!
//! Pure. No clock of its own, no IO, no randomness, and no floating point in a
//! decision — every time is milliseconds and every distance metres, both whole.

pub mod document;
pub mod fold;
pub mod geodesic;
pub mod kernel;
pub mod observe;
pub mod packs;
pub mod run;
pub mod summary;
pub mod text;
