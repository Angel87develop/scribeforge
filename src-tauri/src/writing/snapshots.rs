//! Snapshots: frozen copies of a document's text that can be compared with
//! the current text (or with each other) and restored.
//!
//! Each snapshot is stored as `snapshots/<document-id>/<snapshot-id>.json`
//! inside the `.scri` container. Restoring a snapshot first takes an
//! automatic snapshot of the current text, so a restore can always be undone.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::project::document::RichDoc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Snapshot {
    pub id: Uuid,
    pub document_id: Uuid,
    /// The user's label ("Before the rewrite"); may be empty.
    #[serde(default)]
    pub name: String,
    pub created_at: DateTime<Utc>,
    /// Document title at the time the snapshot was taken.
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub word_count: u32,
    #[serde(default)]
    pub content: RichDoc,
}

impl Snapshot {
    pub fn new(document_id: Uuid, name: &str, title: &str, content: &RichDoc) -> Self {
        Self {
            id: Uuid::new_v4(),
            document_id,
            name: name.trim().to_string(),
            created_at: Utc::now(),
            title: title.to_string(),
            word_count: content.word_count(),
            content: content.clone(),
        }
    }
}

/// A snapshot without its content, for listings.
#[derive(Debug, Clone, Serialize)]
pub struct SnapshotMeta {
    pub id: Uuid,
    pub document_id: Uuid,
    pub name: String,
    pub title: String,
    pub created_at: DateTime<Utc>,
    pub word_count: u32,
}

impl From<&Snapshot> for SnapshotMeta {
    fn from(s: &Snapshot) -> Self {
        Self {
            id: s.id,
            document_id: s.document_id,
            name: s.name.clone(),
            title: s.title.clone(),
            created_at: s.created_at,
            word_count: s.word_count,
        }
    }
}
