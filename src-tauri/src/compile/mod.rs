//! Compile: turn a selection of binder documents into one output file
//! (plain text, Markdown, HTML, DOCX, PDF or EPUB).
//!
//! The pipeline has two stages:
//! 1. `collect` walks the binder in tree order and flattens the selected
//!    nodes into `CompileItem`s (folders and documents with their depth).
//! 2. `Compiled::flow` turns those items into a format-neutral sequence of
//!    sections, separators and content blocks, applying the title and
//!    separator rules of the `CompileSettings`. One writer per format then
//!    renders that flow.
//!
//! Settings start from a preset (standard manuscript, ebook, screenplay) and
//! the user may adjust any field before compiling. No writer depends on
//! external libraries: DOCX and EPUB are ZIP containers built with the same
//! `zip` crate as `.scri`, and the PDF writer emits the file by hand using
//! the standard PDF base fonts.

mod docx;
mod epub;
mod html;
mod pdf;
mod text;

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::project::document::{Block, DocumentKind, Mark, RichDoc, Span};
use crate::project::model::Project;

// ---------------------------------------------------------------------------
// Formats
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum CompileFormat {
    Txt,
    Markdown,
    Html,
    Docx,
    Pdf,
    Epub,
}

impl CompileFormat {
    pub fn extension(self) -> &'static str {
        match self {
            CompileFormat::Txt => "txt",
            CompileFormat::Markdown => "md",
            CompileFormat::Html => "html",
            CompileFormat::Docx => "docx",
            CompileFormat::Pdf => "pdf",
            CompileFormat::Epub => "epub",
        }
    }

    pub fn label(self) -> &'static str {
        match self {
            CompileFormat::Txt => "Plain Text",
            CompileFormat::Markdown => "Markdown",
            CompileFormat::Html => "Web Page",
            CompileFormat::Docx => "Word Document",
            CompileFormat::Pdf => "PDF Document",
            CompileFormat::Epub => "EPUB Ebook",
        }
    }
}

// ---------------------------------------------------------------------------
// Settings and presets
// ---------------------------------------------------------------------------

/// Everything that controls how the output looks. All fields have defaults
/// (the standard manuscript preset), so a partial JSON object is accepted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct CompileSettings {
    /// Preset these settings started from ("manuscript", "ebook", "screenplay").
    pub preset: String,
    /// Body font. PDF maps it to Courier, Times or Helvetica.
    pub font_family: String,
    /// Body font size, in points.
    pub font_size: f32,
    /// Line spacing multiplier (1.0 single, 2.0 double).
    pub line_spacing: f32,
    /// First-line indent of body paragraphs, in inches (0 = none).
    pub first_line_indent: f32,
    /// Space after each paragraph, in points.
    pub paragraph_spacing: f32,
    /// Space before each body paragraph, in points.
    pub paragraph_spacing_before: f32,
    /// Body text alignment: "left" or "justify".
    pub alignment: String,
    /// Show folder titles as chapter headings.
    pub folder_titles: bool,
    /// Show document titles as headings.
    pub document_titles: bool,
    /// Write section titles in capitals.
    pub uppercase_titles: bool,
    /// Chapter title size, in points. 0 derives it from the body size.
    pub chapter_title_size: f32,
    /// Text placed between consecutive documents when their titles are
    /// hidden. Empty means a blank line.
    pub separator: String,
    /// Start every chapter (folder, or top-level document) on a new page.
    pub page_break_before_chapters: bool,
    /// Add a title page with the title and author.
    pub title_page: bool,
    /// Keep bold, italic, underline and the like from the documents.
    pub keep_formatting: bool,
    /// "letter", "a4" or "a5".
    pub page_size: String,
    /// Top, right and bottom margins, in inches.
    pub margin: f32,
    /// Left margin, in inches.
    pub margin_left: f32,
    /// Page numbers on paged formats (PDF, DOCX).
    pub page_numbers: bool,
    /// Running header on paged formats (PDF, DOCX). Empty means none.
    pub header_text: String,
    /// Language tag for HTML and EPUB.
    pub language: String,
}

impl Default for CompileSettings {
    fn default() -> Self {
        manuscript_settings()
    }
}

fn manuscript_settings() -> CompileSettings {
    CompileSettings {
        preset: "manuscript".into(),
        font_family: "Courier New".into(),
        font_size: 12.0,
        line_spacing: 2.0,
        first_line_indent: 0.5,
        paragraph_spacing: 0.0,
        paragraph_spacing_before: 0.0,
        alignment: "left".into(),
        folder_titles: true,
        document_titles: false,
        uppercase_titles: true,
        chapter_title_size: 0.0,
        separator: "#".into(),
        page_break_before_chapters: true,
        title_page: true,
        keep_formatting: true,
        page_size: "letter".into(),
        margin: 1.0,
        margin_left: 1.0,
        page_numbers: true,
        header_text: String::new(),
        language: "en".into(),
    }
}

fn ebook_settings() -> CompileSettings {
    CompileSettings {
        preset: "ebook".into(),
        font_family: "Georgia".into(),
        font_size: 11.0,
        line_spacing: 1.3,
        first_line_indent: 0.3,
        paragraph_spacing: 0.0,
        paragraph_spacing_before: 0.0,
        alignment: "left".into(),
        folder_titles: true,
        document_titles: false,
        uppercase_titles: false,
        chapter_title_size: 0.0,
        separator: "* * *".into(),
        page_break_before_chapters: true,
        title_page: true,
        keep_formatting: true,
        page_size: "a4".into(),
        margin: 0.8,
        margin_left: 0.8,
        page_numbers: true,
        header_text: String::new(),
        language: "en".into(),
    }
}

fn screenplay_settings() -> CompileSettings {
    CompileSettings {
        preset: "screenplay".into(),
        font_family: "Courier New".into(),
        font_size: 12.0,
        line_spacing: 1.0,
        first_line_indent: 0.0,
        paragraph_spacing: 12.0,
        paragraph_spacing_before: 0.0,
        alignment: "left".into(),
        folder_titles: true,
        document_titles: true,
        uppercase_titles: true,
        chapter_title_size: 0.0,
        separator: String::new(),
        page_break_before_chapters: false,
        title_page: true,
        keep_formatting: false,
        page_size: "letter".into(),
        margin: 1.0,
        margin_left: 1.5,
        page_numbers: true,
        header_text: String::new(),
        language: "en".into(),
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct CompilePreset {
    pub id: String,
    pub label: String,
    pub description: String,
    pub settings: CompileSettings,
}

pub fn presets() -> Vec<CompilePreset> {
    vec![
        CompilePreset {
            id: "manuscript".into(),
            label: "Standard Manuscript".into(),
            description: "Courier 12 pt, double spaced, 1-inch margins, indented paragraphs and \
                          chapters on new pages. The format agents and publishers expect."
                .into(),
            settings: manuscript_settings(),
        },
        CompilePreset {
            id: "ebook".into(),
            label: "Ebook".into(),
            description: "Serif type, comfortable spacing and one chapter per file. Best with EPUB."
                .into(),
            settings: ebook_settings(),
        },
        CompilePreset {
            id: "screenplay".into(),
            label: "Screenplay".into(),
            description: "Courier 12 pt, single spaced, 1.5-inch left margin, scene titles in \
                          capitals and no paragraph indents."
                .into(),
            settings: screenplay_settings(),
        },
    ]
}

pub fn preset_settings(id: &str) -> Option<CompileSettings> {
    presets().into_iter().find(|p| p.id == id).map(|p| p.settings)
}

impl CompileSettings {
    /// Clamp numeric fields to ranges every writer can handle.
    pub fn sanitized(mut self) -> Self {
        let fix = |v: f32, lo: f32, hi: f32, def: f32| if v.is_finite() { v.clamp(lo, hi) } else { def };
        self.font_size = fix(self.font_size, 6.0, 48.0, 12.0);
        self.line_spacing = fix(self.line_spacing, 0.8, 4.0, 1.0);
        self.first_line_indent = fix(self.first_line_indent, 0.0, 3.0, 0.0);
        self.paragraph_spacing = fix(self.paragraph_spacing, 0.0, 72.0, 0.0);
        self.paragraph_spacing_before = fix(self.paragraph_spacing_before, 0.0, 72.0, 0.0);
        if self.alignment != "justify" {
            self.alignment = "left".into();
        }
        self.chapter_title_size = if self.chapter_title_size.is_finite() && self.chapter_title_size >= 6.0 {
            self.chapter_title_size.min(72.0)
        } else {
            0.0
        };
        self.margin = fix(self.margin, 0.25, 3.0, 1.0);
        self.margin_left = fix(self.margin_left, 0.25, 3.0, 1.0);
        if !matches!(self.page_size.as_str(), "a4" | "a5") {
            self.page_size = "letter".into();
        }
        self.header_text = self.header_text.replace(['\r', '\n'], " ").trim().chars().take(200).collect();
        if self.language.trim().is_empty() {
            self.language = "en".into();
        }
        self
    }

    pub fn justified(&self) -> bool {
        self.alignment == "justify"
    }

    /// Page width and height, in points.
    pub fn page_size_points(&self) -> (f32, f32) {
        match self.page_size.as_str() {
            "a4" => (595.28, 841.89),
            "a5" => (419.53, 595.28),
            _ => (612.0, 792.0),
        }
    }

    pub fn title_text(&self, title: &str) -> String {
        if self.uppercase_titles {
            title.to_uppercase()
        } else {
            title.to_string()
        }
    }
}

// ---------------------------------------------------------------------------
// Collecting the selection
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemKind {
    Folder,
    Document,
}

/// One selected binder node, in binder order.
#[derive(Debug, Clone)]
pub struct CompileItem {
    pub kind: ItemKind,
    /// Depth below the Manuscript / Research root (children of a root are 0).
    pub depth: usize,
    pub title: String,
    pub content: RichDoc,
    pub word_count: u32,
}

/// Flatten the selected nodes in binder order. An empty `include` means the
/// whole Manuscript. Trash is never compiled.
pub fn collect(project: &Project, include: &[Uuid]) -> Vec<CompileItem> {
    let selected: HashSet<Uuid> = include.iter().copied().collect();
    let mut roots = Vec::new();
    if let Some(d) = project.root_id(DocumentKind::DraftRoot) {
        roots.push(d);
    }
    if !selected.is_empty() {
        if let Some(r) = project.root_id(DocumentKind::ResearchRoot) {
            roots.push(r);
        }
    }

    fn walk(
        project: &Project,
        parent: Uuid,
        depth: usize,
        selected: &HashSet<Uuid>,
        out: &mut Vec<CompileItem>,
    ) {
        for d in project.children(Some(parent)) {
            if selected.is_empty() || selected.contains(&d.id) {
                let kind = if matches!(d.kind, DocumentKind::Folder) {
                    ItemKind::Folder
                } else {
                    ItemKind::Document
                };
                out.push(CompileItem {
                    kind,
                    depth,
                    title: d.title.clone(),
                    content: d.content.clone(),
                    word_count: d.word_count,
                });
            }
            walk(project, d.id, depth + 1, selected, out);
        }
    }

    let mut out = Vec::new();
    for root in roots {
        walk(project, root, 0, &selected, &mut out);
    }
    out
}

// ---------------------------------------------------------------------------
// Format-neutral flow
// ---------------------------------------------------------------------------

/// What writers render, in order.
#[derive(Debug, Clone)]
pub enum Flow<'a> {
    /// Start of a folder or document. `chapter` marks a new chapter (a
    /// folder, or a document at the top level); EPUB splits files there.
    Section {
        title: String,
        show_title: bool,
        /// Heading level, 1 to 6.
        level: u8,
        chapter: bool,
        /// Start on a new page (paged formats only).
        new_page: bool,
    },
    /// Scene separator between two documents whose titles are hidden.
    Separator,
    Block(&'a Block),
}

/// The selection plus everything a writer needs to render it.
pub struct Compiled<'a> {
    pub title: String,
    pub author: String,
    pub project_id: Uuid,
    pub settings: &'a CompileSettings,
    pub items: Vec<CompileItem>,
}

impl<'a> Compiled<'a> {
    pub fn word_count(&self) -> u32 {
        self.items.iter().map(|i| i.word_count).sum()
    }

    pub fn flow(&self) -> Vec<Flow<'_>> {
        let s = self.settings;
        let mut out = Vec::new();
        let mut prev_was_document = false;
        let mut emitted_anything = false;
        for item in &self.items {
            let is_folder = item.kind == ItemKind::Folder;
            let chapter = is_folder || item.depth == 0;
            let show_title = if is_folder { s.folder_titles } else { s.document_titles };
            let level = if is_folder {
                (item.depth + 1).min(3) as u8
            } else {
                (item.depth + 2).min(4) as u8
            };
            let starts_page = chapter && s.page_break_before_chapters;
            if !is_folder && !show_title && !starts_page && prev_was_document {
                out.push(Flow::Separator);
            }
            out.push(Flow::Section {
                title: s.title_text(&item.title),
                show_title,
                level,
                chapter,
                new_page: chapter && s.page_break_before_chapters && emitted_anything,
            });
            emitted_anything = true;
            let mut has_text = false;
            for b in &item.content.blocks {
                if is_blank(b) {
                    continue;
                }
                has_text = true;
                out.push(Flow::Block(b));
            }
            // A folder heading followed by its first scene is not a scene
            // break; an empty document is skipped for separator purposes.
            prev_was_document = if is_folder { false } else { has_text || prev_was_document };
        }
        out
    }
}

fn is_blank(b: &Block) -> bool {
    match b {
        Block::Paragraph { spans, .. } => spans.iter().all(|s| s.text.trim().is_empty()),
        _ => false,
    }
}

// ---------------------------------------------------------------------------
// Inline helpers shared by the writers
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InlineStyle {
    pub bold: bool,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    pub code: bool,
}

pub fn span_style(span: &Span, keep_formatting: bool) -> InlineStyle {
    let mut st = InlineStyle::default();
    if !keep_formatting {
        return st;
    }
    for m in &span.marks {
        match m {
            Mark::Bold => st.bold = true,
            Mark::Italic => st.italic = true,
            Mark::Underline => st.underline = true,
            Mark::Strikethrough => st.strike = true,
            Mark::CodeSpan => st.code = true,
            _ => {}
        }
    }
    st
}

pub fn span_link(span: &Span) -> Option<&str> {
    span.marks.iter().find_map(|m| match m {
        Mark::Link { href } => Some(href.as_str()),
        _ => None,
    })
}

pub fn spans_text(spans: &[Span]) -> String {
    spans.iter().map(|s| s.text.as_str()).collect()
}

/// Paragraph style names that the writers center (title page-like styles).
pub fn is_centered_style(style: Option<&str>) -> bool {
    matches!(style, Some("title" | "subtitle" | "caption" | "centered"))
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/// What the frontend asks for.
#[derive(Debug, Clone, Deserialize)]
pub struct CompileRequest {
    pub format: CompileFormat,
    #[serde(default)]
    pub settings: CompileSettings,
    /// Selected binder ids. Empty compiles the whole Manuscript.
    #[serde(default)]
    pub include: Vec<Uuid>,
    /// Overrides the project name on the title page and metadata.
    #[serde(default)]
    pub title: Option<String>,
    /// Overrides the project author.
    #[serde(default)]
    pub author: Option<String>,
}

/// Render the project to the bytes of the requested format.
pub fn compile(project: &Project, req: &CompileRequest) -> AppResult<Vec<u8>> {
    let settings = req.settings.clone().sanitized();
    let items = collect(project, &req.include);
    if items.is_empty() {
        return Err(AppError::Other("nothing to compile: no documents are selected".into()));
    }
    let title = req
        .title
        .as_deref()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| project.manifest.name.clone());
    let author = req
        .author
        .as_deref()
        .map(str::trim)
        .filter(|a| !a.is_empty())
        .map(str::to_string)
        .or_else(|| project.manifest.author.clone())
        .unwrap_or_default();
    let compiled = Compiled {
        title,
        author,
        project_id: project.manifest.project_id,
        settings: &settings,
        items,
    };
    match req.format {
        CompileFormat::Txt => Ok(text::to_txt(&compiled).into_bytes()),
        CompileFormat::Markdown => Ok(text::to_markdown(&compiled).into_bytes()),
        CompileFormat::Html => Ok(html::to_html(&compiled).into_bytes()),
        CompileFormat::Docx => docx::to_docx(&compiled),
        CompileFormat::Pdf => Ok(pdf::to_pdf(&compiled)),
        CompileFormat::Epub => epub::to_epub(&compiled),
    }
}
