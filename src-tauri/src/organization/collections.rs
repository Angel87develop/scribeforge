//! Collections: named groups of documents shown as tabs in the binder.
//!
//! A *manual* collection keeps the documents the user put in it, in that
//! order. A *saved search* stores criteria instead (text, status, label,
//! keyword, sheet kind, part of the binder) and is evaluated every time it is
//! shown, so "every chapter still in First Draft" stays up to date by itself.
//! Documents in the Trash never appear in a collection.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::project::document::{DocumentKind, DocumentMetaDto};
use crate::project::model::Project;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CollectionKind {
    #[default]
    Manual,
    Search,
}

/// Criteria of a saved search. Empty fields match everything; all the
/// filled ones must match.
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct CollectionQuery {
    /// Words found in the title, synopsis, notes or text (case-insensitive).
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub label: String,
    /// One of the document's keywords.
    #[serde(default)]
    pub keyword: String,
    /// "character", "place", "any" (any sheet) or "" (no filter).
    #[serde(default)]
    pub sheet: String,
    /// "manuscript", "research" or "all".
    #[serde(default = "default_scope")]
    pub scope: String,
    /// Leave folders out.
    #[serde(default = "default_true")]
    pub documents_only: bool,
}

fn default_scope() -> String {
    "all".into()
}
fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Collection {
    pub id: Uuid,
    pub name: String,
    /// Tab colour (CSS hex); empty for none.
    #[serde(default)]
    pub color: String,
    #[serde(default)]
    pub kind: CollectionKind,
    /// The documents of a manual collection, in order.
    #[serde(default)]
    pub items: Vec<Uuid>,
    #[serde(default)]
    pub query: CollectionQuery,
}

impl Collection {
    pub fn sanitize(&mut self) {
        self.name = self.name.trim().to_string();
        if self.name.is_empty() {
            self.name = "Untitled Collection".into();
        }
        let mut seen = HashSet::new();
        self.items.retain(|id| seen.insert(*id));
    }
}

fn matches(project: &Project, meta: &DocumentMetaDto, q: &CollectionQuery) -> bool {
    let is_folder = matches!(
        meta.kind,
        DocumentKind::Folder | DocumentKind::DraftRoot | DocumentKind::ResearchRoot | DocumentKind::TrashRoot
    );
    if matches!(meta.kind, DocumentKind::DraftRoot | DocumentKind::ResearchRoot | DocumentKind::TrashRoot) {
        return false;
    }
    if q.documents_only && is_folder {
        return false;
    }
    match q.scope.as_str() {
        "manuscript" if project.in_research(meta.id) => return false,
        "research" if !project.in_research(meta.id) => return false,
        _ => {}
    }
    if !q.status.is_empty() && !meta.status.eq_ignore_ascii_case(&q.status) {
        return false;
    }
    if !q.label.is_empty() && !meta.labels.first().is_some_and(|l| l.eq_ignore_ascii_case(&q.label)) {
        return false;
    }
    if !q.keyword.is_empty() {
        let k = q.keyword.to_lowercase();
        if !meta.labels.iter().skip(1).any(|l| l.to_lowercase().contains(&k)) {
            return false;
        }
    }
    match q.sheet.as_str() {
        "" => {}
        "any" if meta.sheet_kind.is_none() => return false,
        "any" => {}
        kind if meta.sheet_kind.as_deref() != Some(kind) => return false,
        _ => {}
    }
    let text = q.text.trim().to_lowercase();
    if !text.is_empty() {
        let Some(doc) = project.get(meta.id) else { return false };
        let haystack = format!(
            "{}\n{}\n{}\n{}",
            doc.title,
            doc.synopsis,
            doc.notes,
            doc.content.plain_text()
        )
        .to_lowercase();
        if !text.split_whitespace().all(|w| haystack.contains(w)) {
            return false;
        }
    }
    true
}

/// The documents a collection shows: a manual collection's items in their
/// order, or every match of a saved search in binder order.
pub fn items(project: &Project, c: &Collection) -> Vec<DocumentMetaDto> {
    let listing: Vec<DocumentMetaDto> = project.binder_listing().into_iter().filter(|m| !m.in_trash).collect();
    match c.kind {
        CollectionKind::Manual => c
            .items
            .iter()
            .filter_map(|id| listing.iter().find(|m| m.id == *id).cloned())
            .collect(),
        CollectionKind::Search => listing.into_iter().filter(|m| matches(project, m, &c.query)).collect(),
    }
}
