//! `.scri` container storage.
//!
//! File layout (a ZIP archive, extension `.scri`):
//!
//! ```text
//! project.scri
//! ├── manifest.json            // authoritative manifest
//! ├── documents/
//! │   ├── index.json           // ordered list of document ids + binder meta
//! │   └── <uuid>.json          // one file per document, full content
//! ├── metadata/
//! │   └── project.json         // project-scoped preferences (mirror of manifest.config)
//! └── backups/                 // reserved; managed externally for now
//! ```
//!
//! Safety properties implemented below:
//! - The active project file is never written to in place. We build a fresh
//!   archive in a sibling `.scri.tmp` file and atomically replace the original
//!   once the temp file has been fully flushed and verified.
//! - On Windows, where open files cannot be atomically replaced, we retry the
//!   rename and fall back to a backup-rename sequence.
//! - Reading never mutates the source file; a corrupted archive is reported,
//!   not silently "repaired" in place.

pub mod archive;
pub mod paths;

pub use archive::{read_project_from_path, write_project_to_path};
pub use paths::ensure_scri_extension;
