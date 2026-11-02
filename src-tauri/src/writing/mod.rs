//! Writing and productivity tools: word-count goals and daily statistics,
//! document snapshots with diffs, spell checking, and project-wide find and
//! replace.
//!
//! Everything here is plain logic over the project model; the Tauri command
//! layer wires it to the interface and the storage layer persists it inside
//! the `.scri` container (`metadata/stats.json`, `metadata/dictionary.json`,
//! `snapshots/<document>/<snapshot>.json`).

pub mod diff;
pub mod replace;
pub mod snapshots;
pub mod spelling;
pub mod stats;
