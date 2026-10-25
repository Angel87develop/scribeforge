//! The template catalog: categories, template definitions, and the factory
//! that materialises a new [`Project`] from a template.

use crate::errors::{AppError, AppResult};
use crate::project::document::{Document, DocumentKind, RichDoc};
use crate::project::manifest::Manifest;
use crate::project::model::Project;

/// A category in the Project Templates sidebar.
#[derive(Debug, Clone)]
pub struct Category {
    pub id: &'static str,
    pub label: &'static str,
    pub description: &'static str,
}

pub fn categories() -> &'static [Category] {
    &CATEGORIES
}

/// One selectable template.
#[derive(Debug, Clone)]
pub struct Template {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    /// Longer preview text shown in the right-hand panel.
    pub preview: &'static str,
    /// True if the template ships with starter content (sample documents).
    pub has_starter_content: bool,
    pub build: fn(&Project) -> Vec<Document>,
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct TemplatePreview {
    pub id: String,
    pub name: String,
    pub category: String,
    pub description: String,
    pub preview: String,
    pub has_starter_content: bool,
}

impl From<&Template> for TemplatePreview {
    fn from(t: &Template) -> Self {
        Self {
            id: t.id.to_string(),
            name: t.name.to_string(),
            category: t.category.to_string(),
            description: t.description.to_string(),
            preview: t.preview.to_string(),
            has_starter_content: t.has_starter_content,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct CategoryDto {
    pub id: String,
    pub label: String,
    pub description: String,
}

pub static CATEGORIES: [Category; 7] = [
    Category {
        id: "getting-started",
        label: "Getting Started",
        description: "Templates and sample projects that introduce ScribeForge.",
    },
    Category {
        id: "all",
        label: "All",
        description: "Every template available in ScribeForge.",
    },
    Category {
        id: "blank",
        label: "Blank",
        description: "A single empty project with no preset structure.",
    },
    Category {
        id: "fiction",
        label: "Fiction",
        description: "Templates for novels, novellas, short stories and series.",
    },
    Category {
        id: "non-fiction",
        label: "Non-Fiction",
        description: "Templates for essays, theses, biographies, reports and more.",
    },
    Category {
        id: "scriptwriting",
        label: "Scriptwriting",
        description: "Templates for screenplays, stage plays, TV scripts and audio.",
    },
    Category {
        id: "miscellaneous",
        label: "Miscellaneous",
        description: "Journals, notebooks, collections, documentation and custom.",
    },
];

pub fn category_by_id(id: &str) -> Option<&'static Category> {
    CATEGORIES.iter().find(|c| c.id == id)
}

pub fn find_template(id: &str) -> Option<&'static Template> {
    TEMPLATES.iter().find(|t| t.id == id)
}

/// Templates visible in a given category. `all` returns everything except the
/// Getting Started entries (which are themselves listed under their own
/// category and would otherwise double up).
pub fn templates_for_category(category: &str) -> Vec<&'static Template> {
    match category {
        "all" => TEMPLATES
            .iter()
            .filter(|t| t.category != "getting-started")
            .collect(),
        _ => TEMPLATES.iter().filter(|t| t.category == category).collect(),
    }
}

pub fn template_preview(id: &str) -> AppResult<TemplatePreview> {
    Ok(find_template(id)
        .ok_or_else(|| AppError::TemplateNotFound(id.to_string()))?
        .into())
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

pub static TEMPLATES: &[Template] = &[
    // ---- Getting Started ----
    Template {
        id: "getting-started/getting-started",
        name: "Getting Started",
        category: "getting-started",
        description: "A guided tour of ScribeForge with sample chapters.",
        preview: "Walks you through the binder, the editor, the inspector and the corkboard \
                  using a small sample manuscript. Recommended for first-time users.",
        has_starter_content: true,
        build: build_getting_started,
    },
    Template {
        id: "getting-started/writing-basics",
        name: "Writing Basics",
        category: "getting-started",
        description: "A minimal project that demonstrates chapters and notes.",
        preview: "Three short chapters and a Research note. Perfect for trying out the editor \
                  without committing to a full template.",
        has_starter_content: true,
        build: build_writing_basics,
    },
    Template {
        id: "getting-started/research-and-notes",
        name: "Research and Notes",
        category: "getting-started",
        description: "A project focused on the Research folder.",
        preview: "Shows how to collect notes, references and clippings alongside a manuscript.",
        has_starter_content: true,
        build: build_research_and_notes,
    },
    Template {
        id: "getting-started/project-organization",
        name: "Project Organization",
        category: "getting-started",
        description: "Demonstrates parts, chapters and scenes.",
        preview: "A two-part structure with chapters and scenes under each part. Useful for \
                  understanding how the binder nests documents.",
        has_starter_content: true,
        build: build_project_organization,
    },
    // ---- Blank ----
    Template {
        id: "blank/blank",
        name: "Blank",
        category: "blank",
        description: "A completely empty project.",
        preview: "Starts with an empty Manuscript, an empty Research folder and an empty Trash. \
                  Add your own documents and folders freely.",
        has_starter_content: false,
        build: build_blank,
    },
    // ---- Fiction ----
    Template {
        id: "fiction/novel",
        name: "Novel",
        category: "fiction",
        description: "Chapters and scenes for a standalone novel.",
        preview: "Manuscript contains a Chapters folder with three starter chapters, each holding \
                  a scene. Research folder includes Characters, Settings and Plot notes.",
        has_starter_content: true,
        build: build_novel,
    },
    Template {
        id: "fiction/novel-with-parts",
        name: "Novel with Parts",
        category: "fiction",
        description: "A novel structured into Parts, each with chapters.",
        preview: "Two Parts, each containing a Chapters folder with starter chapters. Useful for \
                  longer works divided into movements.",
        has_starter_content: true,
        build: build_novel_with_parts,
    },
    Template {
        id: "fiction/short-story",
        name: "Short Story",
        category: "fiction",
        description: "A single-document manuscript for short works.",
        preview: "One document under Manuscript, plus a minimal Research folder. Ideal for \
                  stories under ~7,500 words.",
        has_starter_content: true,
        build: build_short_story,
    },
    Template {
        id: "fiction/series",
        name: "Series",
        category: "fiction",
        description: "A series bible with one book folder per volume.",
        preview: "Manuscript contains a Book folder per volume. Research holds a Series Bible \
                  document for continuity tracking.",
        has_starter_content: true,
        build: build_series,
    },
    Template {
        id: "fiction/fantasy-novel",
        name: "Fantasy Novel",
        category: "fiction",
        description: "Novel template with world-building research sections.",
        preview: "Chapters plus dedicated Research folders for World, Magic System, Characters \
                  and Timeline.",
        has_starter_content: true,
        build: build_fantasy_novel,
    },
    Template {
        id: "fiction/mystery-thriller",
        name: "Mystery or Thriller",
        category: "fiction",
        description: "Novel template with clues and timeline research.",
        preview: "Chapters plus Research folders for Suspects, Clues, Red Herrings and a \
                  Timeline.",
        has_starter_content: true,
        build: build_mystery_thriller,
    },
    Template {
        id: "fiction/character-driven",
        name: "Character-Driven Fiction",
        category: "fiction",
        description: "Novel template centred on character arcs.",
        preview: "Chapters plus Research folders for Character Arcs, Relationships and Voice.",
        has_starter_content: true,
        build: build_character_driven,
    },
    // ---- Non-Fiction ----
    Template {
        id: "non-fiction/general",
        name: "General Non-Fiction",
        category: "non-fiction",
        description: "Introduction, chapters and conclusion.",
        preview: "Manuscript has Introduction, Chapters folder and Conclusion. Research has \
                  Sources and Notes.",
        has_starter_content: true,
        build: build_general_nonfiction,
    },
    Template {
        id: "non-fiction/research-project",
        name: "Research Project",
        category: "non-fiction",
        description: "Heavy on research, light on structure.",
        preview: "Manuscript has a single Overview document. Research is pre-populated with \
                  Literature Review, Methodology, Data and References.",
        has_starter_content: true,
        build: build_research_project,
    },
    Template {
        id: "non-fiction/academic-essay",
        name: "Academic Essay",
        category: "non-fiction",
        description: "A structured essay with abstract and references.",
        preview: "Manuscript contains Abstract, Introduction, Body and Conclusion. Research has \
                  References.",
        has_starter_content: true,
        build: build_academic_essay,
    },
    Template {
        id: "non-fiction/thesis",
        name: "Thesis or Dissertation",
        category: "non-fiction",
        description: "Long-form academic work with chapters and appendices.",
        preview: "Manuscript has Front Matter, Chapters, Conclusion and Appendices. Research \
                  holds Literature Review and References.",
        has_starter_content: true,
        build: build_thesis,
    },
    Template {
        id: "non-fiction/biography",
        name: "Biography",
        category: "non-fiction",
        description: "A life story organised by periods.",
        preview: "Manuscript has Early Life, Career, Later Years and Legacy. Research has \
                  Sources and Timeline.",
        has_starter_content: true,
        build: build_biography,
    },
    Template {
        id: "non-fiction/memoir",
        name: "Memoir",
        category: "non-fiction",
        description: "Personal essays grouped by theme.",
        preview: "Manuscript has Themes folder with starter essays. Research has Memories and \
                  Photographs placeholders.",
        has_starter_content: true,
        build: build_memoir,
    },
    Template {
        id: "non-fiction/business-book",
        name: "Business Book",
        category: "non-fiction",
        description: "Framework-driven business book structure.",
        preview: "Manuscript has Introduction, Framework chapters and Case Studies. Research \
                  has Data and Citations.",
        has_starter_content: true,
        build: build_business_book,
    },
    Template {
        id: "non-fiction/article-report",
        name: "Article or Report",
        category: "non-fiction",
        description: "A short, single-purpose document with notes.",
        preview: "Manuscript has a single Article document. Research has Notes and Sources.",
        has_starter_content: true,
        build: build_article_report,
    },
    // ---- Scriptwriting ----
    Template {
        id: "scriptwriting/screenplay",
        name: "Screenplay",
        category: "scriptwriting",
        description: "Feature screenplay with acts and scenes.",
        preview: "Manuscript has Act folders with Scene documents. Research has Characters and \
                  Locations.",
        has_starter_content: true,
        build: build_screenplay,
    },
    Template {
        id: "scriptwriting/stage-play",
        name: "Stage Play",
        category: "scriptwriting",
        description: "Acts and scenes for the stage.",
        preview: "Manuscript has Act folders with Scene documents. Research has Cast and \
                  Stage Directions.",
        has_starter_content: true,
        build: build_stage_play,
    },
    Template {
        id: "scriptwriting/television",
        name: "Television Script",
        category: "scriptwriting",
        description: "An episode teleplay broken into acts.",
        preview: "Manuscript has Teaser, Act folders and Tag. Research has Series Bible and \
                  Cast.",
        has_starter_content: true,
        build: build_television,
    },
    Template {
        id: "scriptwriting/short-film",
        name: "Short Film",
        category: "scriptwriting",
        description: "A single short script with notes.",
        preview: "Manuscript has a single Script document. Research has Notes and Look Book.",
        has_starter_content: true,
        build: build_short_film,
    },
    Template {
        id: "scriptwriting/audio-drama",
        name: "Audio Drama",
        category: "scriptwriting",
        description: "An audio play with episodes and cues.",
        preview: "Manuscript has Episode documents. Research has Sound Cues and Cast.",
        has_starter_content: true,
        build: build_audio_drama,
    },
    // ---- Miscellaneous ----
    Template {
        id: "misc/journal",
        name: "Journal",
        category: "miscellaneous",
        description: "Dated entries grouped by month.",
        preview: "Manuscript has a Months folder with starter entries. Research has Reflections.",
        has_starter_content: true,
        build: build_journal,
    },
    Template {
        id: "misc/personal-notebook",
        name: "Personal Notebook",
        category: "miscellaneous",
        description: "Free-form notes organised by topic.",
        preview: "Manuscript has a Topics folder with starter notes. Research is empty.",
        has_starter_content: true,
        build: build_personal_notebook,
    },
    Template {
        id: "misc/creative-collection",
        name: "Creative Writing Collection",
        category: "miscellaneous",
        description: "A collection of standalone pieces.",
        preview: "Manuscript has a Pieces folder with starter works. Research has Prompts and \
                  Inspirations.",
        has_starter_content: true,
        build: build_creative_collection,
    },
    Template {
        id: "misc/documentation",
        name: "Documentation Project",
        category: "miscellaneous",
        description: "Technical documentation with sections.",
        preview: "Manuscript has Overview, Sections and Appendix. Research has Style Guide.",
        has_starter_content: true,
        build: build_documentation,
    },
    Template {
        id: "misc/custom",
        name: "Custom Project",
        category: "miscellaneous",
        description: "A blank project labelled as custom.",
        preview: "Equivalent to the Blank template but tagged as custom. Add your own structure.",
        has_starter_content: false,
        build: build_blank,
    },
];

// ---------------------------------------------------------------------------
// Project factory
// ---------------------------------------------------------------------------

/// Build a brand-new project from a template, writing starter documents into
/// the Manuscript and Research root folders.
pub fn build_project_from_template(
    template_id: &str,
    name: String,
    author: Option<String>,
) -> AppResult<Project> {
    let template = find_template(template_id)
        .ok_or_else(|| AppError::TemplateNotFound(template_id.to_string()))?;
    let category = template.category.to_string();
    let mut manifest = Manifest::new(name, author, template_id.to_string(), category);
    let mut project = Project::new(manifest.clone());

    // The template factory returns the *additional* documents to insert; they
    // will be parented under the appropriate root folder by the factory itself,
    // using the roots already present on `project`.
    let extra = (template.build)(&project);
    for doc in extra {
        project.insert(doc);
    }
    project.renumber_siblings(project.root_id(DocumentKind::DraftRoot));
    project.renumber_siblings(project.root_id(DocumentKind::ResearchRoot));
    manifest.modified_at = chrono::Utc::now();
    project.manifest = manifest;
    Ok(project)
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

fn draft_root_id(project: &Project) -> uuid::Uuid {
    project.root_id(DocumentKind::DraftRoot).expect("draft root must exist")
}
fn research_root_id(project: &Project) -> uuid::Uuid {
    project.root_id(DocumentKind::ResearchRoot).expect("research root must exist")
}

/// Append a child document under `parent` with the next sibling order.
fn child(title: &str, kind: DocumentKind, parent: uuid::Uuid) -> Document {
    Document::new(title, kind, Some(parent), 0)
}

fn doc_with_text(title: &str, parent: uuid::Uuid, text: &str) -> Document {
    let mut d = Document::new(title, DocumentKind::Document, Some(parent), 0);
    d.content = RichDoc::from_paragraph(text);
    d.recount_words();
    d
}

fn research_note(title: &str, parent: uuid::Uuid, text: &str) -> Document {
    let mut d = Document::new(title, DocumentKind::Research, Some(parent), 0);
    d.content = RichDoc::from_paragraph(text);
    d.recount_words();
    d
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

fn build_blank(_project: &Project) -> Vec<Document> {
    Vec::new()
}

fn build_getting_started(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text(
        "Welcome to ScribeForge",
        draft,
        "Welcome to ScribeForge.\n\nThis sample project walks you through the basics. \
         Select this document in the binder to see its text here in the editor.\n\n\
         Try the inspector on the right to edit the synopsis, notes and metadata.",
    ));
    out.push(doc_with_text(
        "Chapter 1 — The Binder",
        draft,
        "The binder on the left organises your manuscript.\n\n\
         You can drag documents to reorder them, nest them inside folders, and \
         right-click to rename, duplicate or delete.",
    ));
    out.push(doc_with_text(
        "Chapter 2 — The Editor",
        draft,
        "This is the editor. It supports rich text: bold, italic, headings, lists \
         and more. Changes are saved automatically to your .scri project file.",
    ));
    out.push(research_note(
        "Note — Corkboard",
        research,
        "Switch to the Corkboard view to see index cards for each chapter. Drag \
         cards to reorder chapters; the binder updates instantly.",
    ));
    out
}

fn build_writing_basics(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Chapter 1", draft, "Chapter 1 begins here."),
        doc_with_text("Chapter 2", draft, "Chapter 2 continues the story."),
        doc_with_text("Chapter 3", draft, "Chapter 3 brings it to a close."),
        research_note("Ideas", research, "Jot down ideas as they come."),
    ]
}

fn build_research_and_notes(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Overview", draft, "A short overview of the project."));
    out.push(research_note("Note 1", research, "First research note."));
    out.push(research_note("Note 2", research, "Second research note."));
    out.push(research_note("References", research, "Collect bibliographic references here."));
    out
}

fn build_project_organization(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let mut out = Vec::new();
    let part1 = child("Part One", DocumentKind::Folder, draft);
    let part1_id = part1.id;
    out.push(part1);
    out.push(doc_with_text("Chapter 1", part1_id, "Opening chapter of Part One."));
    out.push(doc_with_text("Scene 1.1", part1_id, "First scene."));
    out.push(doc_with_text("Scene 1.2", part1_id, "Second scene."));

    let part2 = child("Part Two", DocumentKind::Folder, draft);
    let part2_id = part2.id;
    out.push(part2);
    out.push(doc_with_text("Chapter 2", part2_id, "Opening chapter of Part Two."));
    out.push(doc_with_text("Scene 2.1", part2_id, "First scene of Part Two."));
    out
}

fn build_novel(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let chapters_id = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", chapters_id, ""));
    out.push(doc_with_text("Chapter 2", chapters_id, ""));
    out.push(doc_with_text("Chapter 3", chapters_id, ""));

    out.push(research_note("Characters", research, "Character profiles."));
    out.push(research_note("Settings", research, "Setting descriptions."));
    out.push(research_note("Plot", research, "Plot outline and beats."));
    out
}

fn build_novel_with_parts(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let mut out = Vec::new();
    for part in ["Part One", "Part Two"] {
        let p = child(part, DocumentKind::Folder, draft);
        let pid = p.id;
        out.push(p);
        let chapters = child("Chapters", DocumentKind::Folder, pid);
        let cid = chapters.id;
        out.push(chapters);
        out.push(doc_with_text("Chapter 1", cid, ""));
        out.push(doc_with_text("Chapter 2", cid, ""));
    }
    out
}

fn build_short_story(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Short Story", draft, ""),
        research_note("Notes", research, ""),
    ]
}

fn build_series(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    for book in ["Book One", "Book Two"] {
        let b = child(book, DocumentKind::Folder, draft);
        let bid = b.id;
        out.push(b);
        out.push(doc_with_text("Chapter 1", bid, ""));
    }
    out.push(research_note("Series Bible", research, "Continuity tracking across books."));
    out
}

fn build_fantasy_novel(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let cid = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", cid, ""));
    out.push(doc_with_text("Chapter 2", cid, ""));
    out.push(research_note("World", research, "World-building notes."));
    out.push(research_note("Magic System", research, "Rules and limits of magic."));
    out.push(research_note("Characters", research, "Character profiles."));
    out.push(research_note("Timeline", research, "Chronology of events."));
    out
}

fn build_mystery_thriller(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let cid = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", cid, ""));
    out.push(doc_with_text("Chapter 2", cid, ""));
    out.push(research_note("Suspects", research, "Suspect profiles and motives."));
    out.push(research_note("Clues", research, "Clues and reveals."));
    out.push(research_note("Red Herrings", research, "Misdirections."));
    out.push(research_note("Timeline", research, "When things happened."));
    out
}

fn build_character_driven(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let cid = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", cid, ""));
    out.push(doc_with_text("Chapter 2", cid, ""));
    out.push(research_note("Character Arcs", research, "Arcs for each major character."));
    out.push(research_note("Relationships", research, "Relationship map."));
    out.push(research_note("Voice", research, "Voice and dialogue notes."));
    out
}

fn build_general_nonfiction(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Introduction", draft, ""));
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let cid = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", cid, ""));
    out.push(doc_with_text("Chapter 2", cid, ""));
    out.push(doc_with_text("Conclusion", draft, ""));
    out.push(research_note("Sources", research, ""));
    out.push(research_note("Notes", research, ""));
    out
}

fn build_research_project(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Overview", draft, ""));
    out.push(research_note("Literature Review", research, ""));
    out.push(research_note("Methodology", research, ""));
    out.push(research_note("Data", research, ""));
    out.push(research_note("References", research, ""));
    out
}

fn build_academic_essay(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Abstract", draft, ""),
        doc_with_text("Introduction", draft, ""),
        doc_with_text("Body", draft, ""),
        doc_with_text("Conclusion", draft, ""),
        research_note("References", research, ""),
    ]
}

fn build_thesis(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let front = child("Front Matter", DocumentKind::Folder, draft);
    let fid = front.id;
    out.push(front);
    out.push(doc_with_text("Title Page", fid, ""));
    out.push(doc_with_text("Abstract", fid, ""));
    let chapters = child("Chapters", DocumentKind::Folder, draft);
    let cid = chapters.id;
    out.push(chapters);
    out.push(doc_with_text("Chapter 1", cid, ""));
    out.push(doc_with_text("Chapter 2", cid, ""));
    out.push(doc_with_text("Conclusion", draft, ""));
    let appendices = child("Appendices", DocumentKind::Folder, draft);
    let aid = appendices.id;
    out.push(appendices);
    out.push(doc_with_text("Appendix A", aid, ""));
    out.push(research_note("Literature Review", research, ""));
    out.push(research_note("References", research, ""));
    out
}

fn build_biography(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Early Life", draft, ""),
        doc_with_text("Career", draft, ""),
        doc_with_text("Later Years", draft, ""),
        doc_with_text("Legacy", draft, ""),
        research_note("Sources", research, ""),
        research_note("Timeline", research, ""),
    ]
}

fn build_memoir(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    let themes = child("Themes", DocumentKind::Folder, draft);
    let tid = themes.id;
    out.push(themes);
    out.push(doc_with_text("Theme 1", tid, ""));
    out.push(doc_with_text("Theme 2", tid, ""));
    out.push(research_note("Memories", research, ""));
    out.push(research_note("Photographs", research, ""));
    out
}

fn build_business_book(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Introduction", draft, ""));
    let framework = child("Framework", DocumentKind::Folder, draft);
    let fwid = framework.id;
    out.push(framework);
    out.push(doc_with_text("Principle 1", fwid, ""));
    out.push(doc_with_text("Principle 2", fwid, ""));
    let cases = child("Case Studies", DocumentKind::Folder, draft);
    let cases_id = cases.id;
    out.push(cases);
    out.push(doc_with_text("Case Study 1", cases_id, ""));
    out.push(research_note("Data", research, ""));
    out.push(research_note("Citations", research, ""));
    out
}

fn build_article_report(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Article", draft, ""),
        research_note("Notes", research, ""),
        research_note("Sources", research, ""),
    ]
}

fn build_screenplay(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    for act in ["Act One", "Act Two", "Act Three"] {
        let a = child(act, DocumentKind::Folder, draft);
        let aid = a.id;
        out.push(a);
        out.push(doc_with_text("Scene 1", aid, ""));
        out.push(doc_with_text("Scene 2", aid, ""));
    }
    out.push(research_note("Characters", research, ""));
    out.push(research_note("Locations", research, ""));
    out
}

fn build_stage_play(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    for act in ["Act One", "Act Two"] {
        let a = child(act, DocumentKind::Folder, draft);
        let aid = a.id;
        out.push(a);
        out.push(doc_with_text("Scene 1", aid, ""));
    }
    out.push(research_note("Cast", research, ""));
    out.push(research_note("Stage Directions", research, ""));
    out
}

fn build_television(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Teaser", draft, ""));
    for act in ["Act One", "Act Two", "Act Three", "Act Four"] {
        let a = child(act, DocumentKind::Folder, draft);
        let aid = a.id;
        out.push(a);
        out.push(doc_with_text("Scene 1", aid, ""));
    }
    out.push(doc_with_text("Tag", draft, ""));
    out.push(research_note("Series Bible", research, ""));
    out.push(research_note("Cast", research, ""));
    out
}

fn build_short_film(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    vec![
        doc_with_text("Script", draft, ""),
        research_note("Notes", research, ""),
        research_note("Look Book", research, ""),
    ]
}

fn build_audio_drama(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Episode 1", draft, ""));
    out.push(doc_with_text("Episode 2", draft, ""));
    out.push(research_note("Sound Cues", research, ""));
    out.push(research_note("Cast", research, ""));
    out
}

fn build_journal(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let months = child("Months", DocumentKind::Folder, draft);
    let mid = months.id;
    let mut out = vec![months];
    out.push(doc_with_text("Entry 1", mid, ""));
    out.push(doc_with_text("Entry 2", mid, ""));
    out.push(research_note("Reflections", research, ""));
    out
}

fn build_personal_notebook(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let topics = child("Topics", DocumentKind::Folder, draft);
    let tid = topics.id;
    let mut out = vec![topics];
    out.push(doc_with_text("Note 1", tid, ""));
    out.push(doc_with_text("Note 2", tid, ""));
    out
}

fn build_creative_collection(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let pieces = child("Pieces", DocumentKind::Folder, draft);
    let pid = pieces.id;
    let mut out = vec![pieces];
    out.push(doc_with_text("Piece 1", pid, ""));
    out.push(doc_with_text("Piece 2", pid, ""));
    out.push(research_note("Prompts", research, ""));
    out.push(research_note("Inspirations", research, ""));
    out
}

fn build_documentation(project: &Project) -> Vec<Document> {
    let draft = draft_root_id(project);
    let research = research_root_id(project);
    let mut out = Vec::new();
    out.push(doc_with_text("Overview", draft, ""));
    let sections = child("Sections", DocumentKind::Folder, draft);
    let sid = sections.id;
    out.push(sections);
    out.push(doc_with_text("Section 1", sid, ""));
    out.push(doc_with_text("Section 2", sid, ""));
    out.push(doc_with_text("Appendix", draft, ""));
    out.push(research_note("Style Guide", research, ""));
    out
}
