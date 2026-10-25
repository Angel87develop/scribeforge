//! In-memory project aggregate.
//!
//! Holds the manifest plus an ordered collection of documents. The aggregate
//! is the unit that the storage layer serialises into a `.scri` container and
//! the unit that the workspace state keeps in memory while a project is open.

use std::collections::HashMap;

use chrono::Utc;
use uuid::Uuid;

use super::document::{Document, DocumentKind, DocumentMetaDto, ImageAttachment};
use super::manifest::Manifest;

/// Binary asset data stored in memory and written to the `assets/` directory
/// inside the `.scri` container.
#[derive(Debug, Clone)]
pub struct AssetData {
    pub bytes: Vec<u8>,
    pub mime_type: String,
    pub filename: String,
}

/// A ScribeForge project loaded in memory.
///
/// Invariants maintained by the methods below:
/// - Document ids are unique.
/// - `order` values under each parent are contiguous starting at 0.
/// - Root folders (Draft, Research, Trash) always exist and can never be
///   trashed, moved or deleted.
/// - A document is either in Trash or in its original location — never both.
/// - Image attachment ids are unique across the project; their bytes live in
///   `assets`, keyed by the same id.
#[derive(Debug, Clone)]
pub struct Project {
    pub manifest: Manifest,
    pub documents: HashMap<Uuid, Document>,
    pub assets: HashMap<Uuid, AssetData>,
}

/// Errors specific to tree manipulation. Mapped to `AppError` by the command
/// layer, but kept separate so the model has no dependency on the IPC layer.
#[derive(Debug, thiserror::Error)]
pub enum TreeError {
    #[error("document not found: {0}")]
    NotFound(Uuid),
    #[error("the {0} root cannot be modified")]
    ProtectedRoot(&'static str),
    #[error("cannot move a folder inside itself or its descendants")]
    Cycle,
    #[error("invalid parent: {0}")]
    InvalidParent(Uuid),
    #[error("operation not allowed on this document kind")]
    InvalidKind,
}

pub type TreeResult<T> = Result<T, TreeError>;

impl Project {
    /// Create a brand-new, empty project with the three mandatory root folders.
    pub fn new(mut manifest: Manifest) -> Self {
        let mut documents = HashMap::new();

        let draft = Document::new("Manuscript".to_string(), DocumentKind::DraftRoot, None, 0);
        let research = Document::new("Research".to_string(), DocumentKind::ResearchRoot, None, 1);
        let trash = Document::new("Trash".to_string(), DocumentKind::TrashRoot, None, 2);

        manifest.modified_at = Utc::now();

        documents.insert(draft.id, draft);
        documents.insert(research.id, research);
        documents.insert(trash.id, trash);

        Self { manifest, documents, assets: HashMap::new() }
    }

    // -----------------------------------------------------------------------
    // Queries
    // -----------------------------------------------------------------------

    pub fn root_of(&self, kind: DocumentKind) -> Option<&Document> {
        self.documents.values().find(|d| d.kind == kind)
    }

    pub fn root_id(&self, kind: DocumentKind) -> Option<Uuid> {
        self.root_of(kind).map(|d| d.id)
    }

    pub fn is_root(&self, id: Uuid) -> bool {
        self.documents
            .get(&id)
            .is_some_and(|d| matches!(d.kind, DocumentKind::DraftRoot | DocumentKind::ResearchRoot | DocumentKind::TrashRoot))
    }

    /// Children of a parent, ordered by `order` then title.
    pub fn children(&self, parent: Option<Uuid>) -> Vec<&Document> {
        let mut kids: Vec<&Document> = self
            .documents
            .values()
            .filter(|d| d.parent == parent)
            .collect();
        kids.sort_by(|a, b| a.order.cmp(&b.order).then_with(|| a.title.cmp(&b.title)));
        kids
    }

    /// Collect a document and all its descendants (inclusive subtree).
    pub fn subtree_ids(&self, id: Uuid) -> Vec<Uuid> {
        let mut out = Vec::new();
        let mut stack = vec![id];
        while let Some(cur) = stack.pop() {
            out.push(cur);
            for d in self.documents.values() {
                if d.parent == Some(cur) {
                    stack.push(d.id);
                }
            }
        }
        out
    }

    /// True if `ancestor` is `id` itself or an ancestor of `id`.
    pub fn is_ancestor_of(&self, ancestor: Uuid, id: Uuid) -> bool {
        if ancestor == id {
            return true;
        }
        let mut cur = self.documents.get(&id).and_then(|d| d.parent);
        while let Some(p) = cur {
            if p == ancestor {
                return true;
            }
            cur = self.documents.get(&p).and_then(|d| d.parent);
        }
        false
    }

    /// True if the document lives anywhere inside the Trash subtree.
    pub fn in_trash(&self, id: Uuid) -> bool {
        match self.root_id(DocumentKind::TrashRoot) {
            Some(trash) => self.is_ancestor_of(trash, id),
            None => false,
        }
    }

    /// True if the document lives anywhere inside the Research subtree.
    pub fn in_research(&self, id: Uuid) -> bool {
        match self.root_id(DocumentKind::ResearchRoot) {
            Some(r) => self.is_ancestor_of(r, id),
            None => false,
        }
    }

    /// Binder-style flat listing in tree order (parents before children).
    /// Excludes nothing — Trash items are listed under the Trash root and
    /// carry `in_trash = true`.
    pub fn binder_listing(&self) -> Vec<DocumentMetaDto> {
        fn walk(
            project: &Project,
            parent: Option<Uuid>,
            in_trash_branch: bool,
            out: &mut Vec<DocumentMetaDto>,
        ) {
            for d in project.children(parent) {
                let in_trash =
                    in_trash_branch || matches!(d.kind, DocumentKind::TrashRoot);
                out.push(DocumentMetaDto::from_doc(d, in_trash));
                if matches!(
                    d.kind,
                    DocumentKind::Folder
                        | DocumentKind::DraftRoot
                        | DocumentKind::ResearchRoot
                        | DocumentKind::TrashRoot
                ) {
                    walk(project, Some(d.id), in_trash, out);
                }
            }
        }
        let mut out = Vec::new();
        walk(self, None, false, &mut out);
        out
    }

    pub fn get(&self, id: Uuid) -> Option<&Document> {
        self.documents.get(&id)
    }

    pub fn get_mut(&mut self, id: Uuid) -> Option<&mut Document> {
        self.documents.get_mut(&id)
    }

    // -----------------------------------------------------------------------
    // Mutations
    // -----------------------------------------------------------------------

    /// Insert a document, placing it last among its siblings.
    pub fn insert(&mut self, mut doc: Document) -> Uuid {
        let parent = doc.parent;
        let next_order = self.children(parent).len() as i32;
        doc.order = next_order;
        doc.touch();
        let id = doc.id;
        self.documents.insert(id, doc);
        self.manifest.touch();
        id
    }

    /// Renumber siblings of `parent` to be contiguous 0..n.
    pub fn renumber_siblings(&mut self, parent: Option<Uuid>) {
        let mut kids: Vec<Uuid> = self
            .documents
            .values()
            .filter(|d| d.parent == parent)
            .map(|d| d.id)
            .collect();
        kids.sort_by(|&a, &b| {
            let da = self.documents.get(&a).unwrap();
            let db = self.documents.get(&b).unwrap();
            da.order.cmp(&db.order).then_with(|| da.title.cmp(&db.title))
        });
        for (i, id) in kids.into_iter().enumerate() {
            if let Some(d) = self.documents.get_mut(&id) {
                d.order = i as i32;
            }
        }
    }

    /// Create a new document or folder under `parent`.
    pub fn create_child(
        &mut self,
        parent: Uuid,
        kind: DocumentKind,
        title: &str,
    ) -> TreeResult<Uuid> {
        if self.is_root(parent) && !matches!(parent_kind(self, parent), Some(DocumentKind::TrashRoot)) {
            // Creating inside Draft/Research roots is allowed (they are folders),
            // but the root itself stays protected.
        }
        if !self.documents.contains_key(&parent) {
            return Err(TreeError::InvalidParent(parent));
        }
        if self.in_trash(parent) {
            return Err(TreeError::InvalidKind);
        }
        let doc_kind = match kind {
            DocumentKind::Document | DocumentKind::Research | DocumentKind::Folder => kind,
            _ => return Err(TreeError::InvalidKind),
        };
        let doc = Document::new(title, doc_kind, Some(parent), 0);
        let id = self.insert(doc);
        Ok(id)
    }

    /// Rename a document or folder. Roots keep their fixed titles so the
    /// binder stays recognisable, but we allow it for future customisation.
    pub fn rename(&mut self, id: Uuid, new_title: &str) -> TreeResult<()> {
        let title = new_title.trim();
        if title.is_empty() {
            return Err(TreeError::InvalidKind);
        }
        let doc = self
            .documents
            .get_mut(&id)
            .ok_or(TreeError::NotFound(id))?;
        doc.title = title.to_string();
        doc.touch();
        self.manifest.touch();
        Ok(())
    }

    /// Duplicate a document. The copy gets new ids for itself and for each
    /// image attachment (the asset bytes are copied too).
    pub fn duplicate(&mut self, id: Uuid) -> TreeResult<Uuid> {
        let original = self
            .documents
            .get(&id)
            .ok_or(TreeError::NotFound(id))?
            .clone();
        if self.is_root(id) {
            return Err(TreeError::ProtectedRoot(root_name(&original)));
        }
        let mut copy = original.clone();
        copy.id = Uuid::new_v4();
        copy.title = format!("{} (copy)", original.title);
        copy.created_at = Utc::now();
        copy.modified_at = Utc::now();
        // Deep-copy attachments: new id for each, bytes duplicated.
        let mut new_attachments = Vec::with_capacity(copy.attachments.len());
        for att in &copy.attachments {
            let new_att_id = Uuid::new_v4();
            if let Some(asset) = self.assets.get(&att.id) {
                self.assets.insert(
                    new_att_id,
                    AssetData {
                        bytes: asset.bytes.clone(),
                        mime_type: asset.mime_type.clone(),
                        filename: asset.filename.clone(),
                    },
                );
            }
            let mut new_att = att.clone();
            new_att.id = new_att_id;
            new_att.created_at = Utc::now();
            new_attachments.push(new_att);
        }
        copy.attachments = new_attachments;
        // Insert after the original among siblings.
        let parent = original.parent;
        let insert_at = original.order + 1;
        self.shift_orders(parent, insert_at, 1);
        copy.order = insert_at;
        copy.touch();
        let new_id = copy.id;
        self.documents.insert(new_id, copy);
        self.renumber_siblings(parent);
        self.manifest.touch();
        Ok(new_id)
    }

    /// Bump `order` of siblings from `from` onwards by `delta`.
    fn shift_orders(&mut self, parent: Option<Uuid>, from: i32, delta: i32) {
        for d in self.documents.values_mut() {
            if d.parent == parent && d.order >= from {
                d.order += delta;
            }
        }
    }

    /// Move a document to a new parent at a specific index. Guards against
    /// cycles (moving a folder into its own subtree) and root protection.
    pub fn move_node(&mut self, id: Uuid, new_parent: Uuid, index: i32) -> TreeResult<()> {
        if self.is_root(id) {
            let kind = self.documents.get(&id).unwrap().kind;
            let _ = kind;
            return Err(TreeError::ProtectedRoot("root"));
        }
        if !self.documents.contains_key(&new_parent) {
            return Err(TreeError::InvalidParent(new_parent));
        }
        if new_parent == id || self.is_ancestor_of(id, new_parent) {
            return Err(TreeError::Cycle);
        }
        // Moving into trash is a different operation (move_to_trash).
        if self.in_trash(new_parent) && !matches!(self.documents.get(&new_parent), Some(d) if d.kind == DocumentKind::TrashRoot) {
            // Restoring into a trashed folder is not allowed via move.
            return Err(TreeError::InvalidKind);
        }
        let old_parent = self.documents.get(&id).and_then(|d| d.parent);
        // Documents can hold sub-documents too (Scrivener-style).
        let doc_kind_allows_children = matches!(
            self.documents.get(&new_parent).map(|d| d.kind),
            Some(
                DocumentKind::Folder
                    | DocumentKind::Document
                    | DocumentKind::Research
                    | DocumentKind::DraftRoot
                    | DocumentKind::ResearchRoot
                    | DocumentKind::TrashRoot
            )
        );
        if !doc_kind_allows_children {
            return Err(TreeError::InvalidKind);
        }

        let target_len = self.children(Some(new_parent)).len() as i32;
        let index = index.clamp(0, target_len);

        if let Some(d) = self.documents.get_mut(&id) {
            d.parent = Some(new_parent);
            d.order = index;
            d.touch();
        }
        if old_parent != Some(new_parent) {
            self.renumber_siblings(old_parent);
        }
        self.renumber_siblings(Some(new_parent));
        self.manifest.touch();
        Ok(())
    }

    /// Soft-delete: move a node (with its whole subtree) into Trash,
    /// remembering the original parent so it can be restored.
    pub fn move_to_trash(&mut self, id: Uuid) -> TreeResult<()> {
        if self.is_root(id) {
            let name = self
                .documents
                .get(&id)
                .map(|d| root_name(d))
                .unwrap_or("root");
            return Err(TreeError::ProtectedRoot(name));
        }
        if self.in_trash(id) {
            // Already trashed — idempotent.
            return Ok(());
        }
        let trash_id = self
            .root_id(DocumentKind::TrashRoot)
            .ok_or(TreeError::NotFound(id))?;
        let old_parent = self.documents.get(&id).and_then(|d| d.parent);

        if let Some(d) = self.documents.get_mut(&id) {
            d.original_parent = old_parent;
            d.parent = Some(trash_id);
            d.touch();
        }
        self.renumber_siblings(old_parent);
        self.renumber_siblings(Some(trash_id));
        self.manifest.touch();
        Ok(())
    }

    /// Restore a node from Trash back to its original parent. If the original
    /// parent no longer exists (or was itself trashed), fall back to the
    /// Draft root (or Research root for research nodes) so nothing is lost.
    /// Returns the parent actually used.
    pub fn restore_from_trash(&mut self, id: Uuid) -> TreeResult<Uuid> {
        if !self.in_trash(id) {
            return Err(TreeError::InvalidKind);
        }
        let trash_id = self.root_id(DocumentKind::TrashRoot).unwrap();

        // Restoring a folder restores the folder itself; descendants that are
        // its children come along automatically because they remain parented
        // to the restored folder.
        let original_parent = self.documents.get(&id).and_then(|d| d.original_parent);
        let is_research = self
            .documents
            .get(&id)
            .is_some_and(|d| matches!(d.kind, DocumentKind::Research));

        // Determine a valid destination.
        let destination = match original_parent {
            Some(p)
                if self.documents.contains_key(&p)
                    && !self.is_ancestor_of(trash_id, p)
                    && p != trash_id =>
            {
                p
            }
            _ => {
                // Fallback: research items go back to Research, others to Draft.
                let fallback_kind = if is_research {
                    DocumentKind::ResearchRoot
                } else {
                    DocumentKind::DraftRoot
                };
                self.root_id(fallback_kind)
                    .ok_or(TreeError::NotFound(id))?
            }
        };

        if let Some(d) = self.documents.get_mut(&id) {
            d.parent = Some(destination);
            d.original_parent = None;
            d.touch();
        }
        self.renumber_siblings(Some(trash_id));
        self.renumber_siblings(Some(destination));
        self.manifest.touch();
        Ok(destination)
    }

    /// Permanently remove a document and its entire subtree. Also removes
    /// any image assets referenced by the purged documents.
    pub fn purge_subtree(&mut self, id: Uuid) -> TreeResult<()> {
        if self.is_root(id) {
            let name = self
                .documents
                .get(&id)
                .map(|d| root_name(d))
                .unwrap_or("root");
            return Err(TreeError::ProtectedRoot(name));
        }
        let parent = self.documents.get(&id).and_then(|d| d.parent);
        // Collect all attachment ids from the subtree before removing docs.
        let subtree = self.subtree_ids(id);
        for r in &subtree {
            if let Some(doc) = self.documents.get(r) {
                for att in &doc.attachments {
                    self.assets.remove(&att.id);
                }
            }
            self.documents.remove(r);
        }
        self.renumber_siblings(parent);
        self.manifest.touch();
        Ok(())
    }

    /// Permanently empty the Trash. Returns the number of purged documents.
    pub fn empty_trash(&mut self) -> TreeResult<usize> {
        let trash_id = match self.root_id(DocumentKind::TrashRoot) {
            Some(t) => t,
            None => return Ok(0),
        };
        let kids: Vec<Uuid> = self
            .children(Some(trash_id))
            .iter()
            .map(|d| d.id)
            .collect();
        let mut count = 0;
        for kid in kids {
            count += self.subtree_ids(kid).len();
            self.purge_subtree(kid)?;
        }
        Ok(count)
    }

    // -----------------------------------------------------------------------
    // Word counts
    // -----------------------------------------------------------------------

    /// Total word count across all non-trash, non-research documents.
    pub fn manuscript_word_count(&self) -> u32 {
        let draft_id = self.root_id(DocumentKind::DraftRoot);
        let mut total = 0u32;
        let mut stack: Vec<Option<Uuid>> = vec![draft_id];
        while let Some(parent) = stack.pop() {
            for d in self.children(parent) {
                if matches!(d.kind, DocumentKind::Document | DocumentKind::Research) {
                    total += d.word_count;
                }
                if matches!(d.kind, DocumentKind::Folder | DocumentKind::DraftRoot) {
                    stack.push(Some(d.id));
                }
            }
        }
        total
    }

    /// Mark the project as modified now.
    pub fn touch(&mut self) {
        self.manifest.touch();
    }
}

fn parent_kind(project: &Project, id: Uuid) -> Option<DocumentKind> {
    project.documents.get(&id).map(|d| d.kind)
}

fn root_name(d: &Document) -> &'static str {
    match d.kind {
        DocumentKind::DraftRoot => "Manuscript",
        DocumentKind::ResearchRoot => "Research",
        DocumentKind::TrashRoot => "Trash",
        _ => "root",
    }
}
