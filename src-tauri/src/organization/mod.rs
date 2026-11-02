//! Organisation tools: collections and saved searches, coloured labels and
//! statuses, wiki-style links between documents with backlinks, and the
//! story timeline.
//!
//! Collections live in `metadata/collections.json` and the timeline in
//! `metadata/timeline.json` inside the `.scri` container; label and status
//! definitions are part of the project configuration in the manifest.

pub mod collections;
pub mod labels;
pub mod links;
pub mod timeline;
