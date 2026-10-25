//! Document model including a portable rich-text representation.
//!
//! The rich-text model is intentionally a small, stable, JSON-serialisable
//! block/span tree (similar in spirit to ProseMirror / TipTap). It maps cleanly
//! to HTML for the web editor (Phase 4) and to plain text / Markdown for
//! compilation (Phase 6), without depending on any specific editor library.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Top-level kind of a binder node. Folders may contain other nodes; documents
/// hold editable rich text. Research and Trash are special root folders.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum DocumentKind {
    Folder,
    Document,
    /// Root folder containing the manuscript draft.
    DraftRoot,
    /// Root folder holding research material.
    ResearchRoot,
    /// Root folder holding soft-deleted items.
    TrashRoot,
    /// A research material node (note, image ref, attachment, etc.).
    Research,
}

impl Default for DocumentKind {
    fn default() -> Self {
        DocumentKind::Document
    }
}

/// Metadata for an image attached to a document's Notes tab. The actual
/// binary bytes live in `Project::assets`, keyed by the attachment id.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageAttachment {
    pub id: Uuid,
    pub filename: String,
    pub mime_type: String,
    /// User-adjusted display width in pixels (CSS px).
    #[serde(default = "default_display_width")]
    pub display_width: u32,
    /// User-adjusted display height in pixels (CSS px).
    #[serde(default = "default_display_height")]
    pub display_height: u32,
    pub created_at: DateTime<Utc>,
}

fn default_display_width() -> u32 {
    240
}
fn default_display_height() -> u32 {
    180
}

impl ImageAttachment {
    pub fn new(filename: String, mime_type: String) -> Self {
        Self {
            id: Uuid::new_v4(),
            filename,
            mime_type,
            display_width: default_display_width(),
            display_height: default_display_height(),
            created_at: Utc::now(),
        }
    }
}

/// A single document (binder leaf or folder) inside a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: Uuid,
    pub title: String,
    #[serde(default)]
    pub kind: DocumentKind,
    /// Parent node id, or `None` for a root-level node.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<Uuid>,
    /// When a document is moved to Trash, its previous parent is stored here
    /// so that `restore_from_trash` can return it to its original location.
    /// `None` means the document has never been trashed (or was restored).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_parent: Option<Uuid>,
    /// Sibling ordering under the parent. Lower comes first.
    #[serde(default)]
    pub order: i32,
    /// Rich-text content. Empty for folders.
    #[serde(default)]
    pub content: RichDoc,
    #[serde(default)]
    pub synopsis: String,
    /// Corkboard index-card title, independent from `title`. Empty means the
    /// card shows the document title.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub card_title: String,
    /// Custom binder icon id (e.g. "book:red", "light-bulb"). Empty means the
    /// default icon for the document kind.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub icon: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub labels: Vec<String>,
    #[serde(default = "default_status")]
    pub status: String,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
    #[serde(default)]
    pub word_count: u32,
    /// Images attached to this document's Notes tab.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub attachments: Vec<ImageAttachment>,
}

fn default_status() -> String {
    "First Draft".to_string()
}

impl Document {
    pub fn new(title: impl Into<String>, kind: DocumentKind, parent: Option<Uuid>, order: i32) -> Self {
        let now = Utc::now();
        let title = title.into();
        Self {
            id: Uuid::new_v4(),
            title,
            kind,
            parent,
            original_parent: None,
            order,
            content: RichDoc::default(),
            synopsis: String::new(),
            card_title: String::new(),
            icon: String::new(),
            notes: String::new(),
            labels: Vec::new(),
            status: default_status(),
            created_at: now,
            modified_at: now,
            word_count: 0,
            attachments: Vec::new(),
        }
    }

    /// Recompute the cached word count from the rich-text content.
    pub fn recount_words(&mut self) {
        self.word_count = self.content.word_count();
    }

    pub fn touch(&mut self) {
        self.recount_words();
        self.modified_at = Utc::now();
    }
}

// ---- Rich text model -------------------------------------------------------

/// Paragraph-level formatting attributes (alignment, spacing, indents,
/// named style). All fields are optional so an old `.scri` file deserialises
/// cleanly (additive migration — see `docs/scri-format.md`).
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct ParaAttrs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style: Option<String>,
    /// `left` | `center` | `right` | `justify`
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub align: Option<String>,
    /// Line-height multiplier (1.0, 1.15, 1.5, 2.0…)
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line_height: Option<f32>,
    /// Space above the paragraph, in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_before: Option<f32>,
    /// Space below the paragraph, in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub space_after: Option<f32>,
    /// Left margin, in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_left: Option<f32>,
    /// Right margin, in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_right: Option<f32>,
    /// First-line indent, in points.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub indent_first: Option<f32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct RichDoc {
    #[serde(default)]
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Block {
    Paragraph {
        #[serde(default)]
        attrs: ParaAttrs,
        #[serde(default)]
        spans: Vec<Span>,
    },
    Heading {
        level: u8,
        #[serde(default)]
        attrs: ParaAttrs,
        #[serde(default)]
        spans: Vec<Span>,
    },
    BlockQuote {
        #[serde(default)]
        attrs: ParaAttrs,
        #[serde(default)]
        spans: Vec<Span>,
    },
    ListOrdered {
        #[serde(default)]
        items: Vec<ListItem>,
    },
    ListUnordered {
        #[serde(default)]
        items: Vec<ListItem>,
    },
    CodeBlock {
        #[serde(default)]
        text: String,
    },
    Divider,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct ListItem {
    #[serde(default)]
    pub spans: Vec<Span>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Span {
    #[serde(default)]
    pub text: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub marks: Vec<Mark>,
}

/// Character marks. New variants (code_span, font_family, font_size, color,
/// highlight) were added additively; old `.scri` files without these
/// deserialize normally. Old applications reading newer files will fail on
/// unknown marks (intentional — forward-incompatible new mark vocabulary).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Mark {
    Bold,
    Italic,
    Underline,
    Strikethrough,
    CodeSpan,
    Link {
        href: String,
    },
    FontFamily {
        family: String,
    },
    FontSize {
        pt: f32,
    },
    Color {
        hex: String,
    },
    Highlight {
        hex: String,
    },
}

impl RichDoc {
    pub fn from_paragraph(text: &str) -> Self {
        let mut blocks = Vec::new();
        for line in text.split("\n\n") {
            let spans = vec![Span { text: line.to_string(), marks: Vec::new() }];
            blocks.push(Block::Paragraph {
                attrs: ParaAttrs::default(),
                spans,
            });
        }
        Self { blocks }
    }

    /// Concatenate all span text in document order.
    pub fn plain_text(&self) -> String {
        let mut out = String::new();
        for block in &self.blocks {
            match block {
                Block::Paragraph { spans, .. }
                | Block::Heading { spans, .. }
                | Block::BlockQuote { spans, .. } => {
                    for s in spans {
                        out.push_str(&s.text);
                    }
                    out.push('\n');
                }
                Block::ListOrdered { items } | Block::ListUnordered { items } => {
                    for item in items {
                        for s in &item.spans {
                            out.push_str(&s.text);
                        }
                        out.push('\n');
                    }
                }
                Block::CodeBlock { text } => {
                    out.push_str(text);
                    out.push('\n');
                }
                Block::Divider => out.push('\n'),
            }
        }
        out
    }

    /// Whitespace-separated word count across the whole document.
    pub fn word_count(&self) -> u32 {
        self.plain_text().split_whitespace().count() as u32
    }

    pub fn is_empty(&self) -> bool {
        self.blocks.is_empty()
            || self.blocks.iter().all(|b| {
                matches!(b, Block::Paragraph { spans, .. } if spans.iter().all(|s| s.text.is_empty()))
            })
    }
}

// ---- DTOs for the frontend -------------------------------------------------

/// Lightweight binder row — no content payload.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentMetaDto {
    pub id: Uuid,
    pub title: String,
    pub kind: DocumentKind,
    pub parent: Option<Uuid>,
    pub order: i32,
    pub synopsis: String,
    pub card_title: String,
    pub icon: String,
    pub status: String,
    pub labels: Vec<String>,
    pub word_count: u32,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
    /// True if the document (or any ancestor) is inside the Trash root.
    pub in_trash: bool,
}

impl DocumentMetaDto {
    /// Build a DTO from a document, computing the `in_trash` flag externally.
    pub fn from_doc(d: &Document, in_trash: bool) -> Self {
        Self {
            id: d.id,
            title: d.title.clone(),
            kind: d.kind,
            parent: d.parent,
            order: d.order,
            synopsis: d.synopsis.clone(),
            card_title: d.card_title.clone(),
            icon: d.icon.clone(),
            status: d.status.clone(),
            labels: d.labels.clone(),
            word_count: d.word_count,
            created_at: d.created_at,
            modified_at: d.modified_at,
            in_trash,
        }
    }
}

/// Full document including rich-text content, used when opening a node in the
/// editor.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DocumentDto {
    pub id: Uuid,
    pub title: String,
    pub kind: DocumentKind,
    pub content: RichDoc,
    pub synopsis: String,
    pub notes: String,
    pub labels: Vec<String>,
    pub status: String,
    pub word_count: u32,
    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,
    #[serde(default)]
    pub attachments: Vec<ImageAttachment>,
}

impl From<&Document> for DocumentDto {
    fn from(d: &Document) -> Self {
        Self {
            id: d.id,
            title: d.title.clone(),
            kind: d.kind,
            content: d.content.clone(),
            synopsis: d.synopsis.clone(),
            notes: d.notes.clone(),
            labels: d.labels.clone(),
            status: d.status.clone(),
            word_count: d.word_count,
            created_at: d.created_at,
            modified_at: d.modified_at,
            attachments: d.attachments.clone(),
        }
    }
}
