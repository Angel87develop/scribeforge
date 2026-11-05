//! Import a Scrivener project (`.scriv` folder) into a new ScribeForge
//! project.
//!
//! Reads the binder from the `.scrivx` file and each item's files:
//! - Scrivener 3: `Files/Data/<UUID>/content.rtf`, `notes.rtf`,
//!   `synopsis.txt` (and `content.<ext>` for images and PDFs);
//! - Scrivener 2 and Scrivener 1 for Windows: `Files/Docs/<ID>.rtf`,
//!   `<ID>_notes.rtf`, `<ID>_synopsis.txt`.
//!
//! Mapping:
//! - Draft → Manuscript, Research → Research, Trash → Trash; other
//!   top-level folders (Characters, Places, Front Matter…) go into Research.
//! - A text keeps its sub-documents. A folder with text becomes a document
//!   (ScribeForge folders have no text of their own); without text it stays
//!   a folder.
//! - Title, text, synopsis, notes, label, status, creation and modification
//!   dates and word targets are kept; the project's labels, statuses and
//!   targets too.
//! - Images become image attachments of a research note. PDFs and other
//!   files are not copied: their note says where the original is.
//!
//! Not imported: snapshots, comments, keywords, custom icons, compile
//! settings, document links.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, NaiveDate, Utc};
use roxmltree::Node;
use serde::Serialize;

use super::rtf::{rtf_to_rich, rtf_to_text};
use crate::errors::{AppError, AppResult};
use crate::project::document::{Document, DocumentKind, ImageAttachment, RichDoc};
use crate::project::manifest::{default_statuses, ColorDef, Manifest};
use crate::project::model::{AssetData, Project};

/// What the import did, for the message shown afterwards.
#[derive(Debug, Clone, Default, Serialize)]
pub struct ImportSummary {
    /// Texts and folders imported (roots not counted).
    pub documents: usize,
    pub images: usize,
    /// Files that were not copied (PDFs, media, web archives, large images),
    /// by binder title.
    pub not_copied: Vec<String>,
}

/// Image files larger than this stay in the Scrivener project.
const MAX_IMAGE_BYTES: u64 = 10 * 1024 * 1024;

/// Find the `.scrivx` file for `source`: the file itself, the `.scriv`
/// folder holding it, or a folder holding one `.scriv` project.
pub fn find_scrivx(source: &Path) -> AppResult<PathBuf> {
    let is_scrivx = |p: &Path| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("scrivx"));
    if source.is_file() && is_scrivx(source) {
        return Ok(source.to_path_buf());
    }
    let in_dir = |dir: &Path| -> Option<PathBuf> {
        let mut found: Vec<PathBuf> =
            fs::read_dir(dir).ok()?.flatten().map(|e| e.path()).filter(|p| p.is_file() && is_scrivx(p)).collect();
        found.sort();
        found.into_iter().next()
    };
    if source.is_dir() {
        if let Some(p) = in_dir(source) {
            return Ok(p);
        }
        // A folder that holds exactly one .scriv project.
        let projects: Vec<PathBuf> = fs::read_dir(source)?
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir() && p.extension().is_some_and(|e| e.eq_ignore_ascii_case("scriv")))
            .collect();
        if let [only] = projects.as_slice() {
            if let Some(p) = in_dir(only) {
                return Ok(p);
            }
        }
    }
    Err(AppError::InvalidProject(format!(
        "no Scrivener project found in {} (choose the .scriv folder)",
        source.display()
    )))
}

/// The project name Scrivener shows: the `.scriv` folder name without its
/// extension (else the `.scrivx` file name).
pub fn project_name(scrivx: &Path) -> String {
    let folder = scrivx.parent().filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("scriv")));
    folder
        .unwrap_or(scrivx)
        .file_stem()
        .map(|s| s.to_string_lossy().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Scrivener".into())
}

/// Build a ScribeForge project from the Scrivener project at `scrivx`.
pub fn import(scrivx: &Path, name: String, author: Option<String>) -> AppResult<(Project, ImportSummary)> {
    let xml = fs::read_to_string(scrivx)?;
    let xml = xml.trim_start_matches('\u{feff}');
    let tree = roxmltree::Document::parse(xml)
        .map_err(|e| AppError::InvalidProject(format!("the Scrivener project file could not be read: {e}")))?;
    let root = tree.root_element();
    let binder = child(root, "Binder")
        .ok_or_else(|| AppError::InvalidProject("the Scrivener project has no binder".into()))?;

    let mut project = Project::new(Manifest::new(name, author, "import/scrivener".into(), "import".into()));
    let labels = color_defs(root, "LabelSettings", "Labels", "Label");
    let statuses = color_defs(root, "StatusSettings", "StatusItems", "Status");
    if !labels.is_empty() {
        project.manifest.config.labels = labels.iter().map(|(_, d)| d.clone()).collect();
    }
    if !statuses.is_empty() {
        project.manifest.config.statuses = statuses.iter().map(|(_, d)| d.clone()).collect();
    }
    read_targets(root, &mut project);

    let mut reader = Reader {
        base: scrivx.parent().unwrap_or(Path::new(".")).to_path_buf(),
        labels: labels.into_iter().map(|(id, d)| (id, d.name)).collect(),
        statuses: statuses.into_iter().map(|(id, d)| (id, d.name)).collect(),
        summary: ImportSummary::default(),
    };
    let draft = project.root_id(DocumentKind::DraftRoot).expect("new project has a draft root");
    let research = project.root_id(DocumentKind::ResearchRoot).expect("new project has a research root");
    let trash = project.root_id(DocumentKind::TrashRoot).expect("new project has a trash root");

    for item in children(binder, "BinderItem") {
        match item.attribute("Type").unwrap_or("") {
            "DraftFolder" => reader.import_children(&mut project, item, draft, true),
            "ResearchFolder" => reader.import_children(&mut project, item, research, false),
            "TrashFolder" => reader.import_children(&mut project, item, trash, false),
            _ => reader.import_item(&mut project, item, research, false),
        }
    }
    project.manifest.touch();
    Ok((project, reader.summary))
}

struct Reader {
    base: PathBuf,
    labels: HashMap<String, String>,
    statuses: HashMap<String, String>,
    summary: ImportSummary,
}

impl Reader {
    fn import_children(&mut self, project: &mut Project, item: Node, parent: uuid::Uuid, draft: bool) {
        if let Some(kids) = child(item, "Children") {
            for kid in children(kids, "BinderItem") {
                self.import_item(project, kid, parent, draft);
            }
        }
    }

    fn import_item(&mut self, project: &mut Project, item: Node, parent: uuid::Uuid, draft: bool) {
        let kind_name = item.attribute("Type").unwrap_or("Text");
        let title = child_text(item, "Title").unwrap_or_default();
        let files = self.files(item);

        let content = files.text.as_deref().map(read_rich).unwrap_or_default();
        let has_children = child(item, "Children").is_some_and(|c| children(c, "BinderItem").next().is_some());
        let text_kind = if draft { DocumentKind::Document } else { DocumentKind::Research };
        let kind = match kind_name {
            "Folder" | "DraftFolder" | "ResearchFolder" | "TrashFolder" if content.is_empty() => DocumentKind::Folder,
            "Folder" | "Text" => text_kind,
            _ => DocumentKind::Research,
        };
        let title = if title.trim().is_empty() { "Untitled".to_string() } else { title };

        let mut doc = Document::new(title.clone(), kind, Some(parent), 0);
        doc.content = content;
        if let Some(p) = &files.synopsis {
            doc.synopsis = fs::read_to_string(p).map(|s| s.trim().to_string()).unwrap_or_default();
        }
        if let Some(p) = &files.notes {
            doc.notes = fs::read(p).map(|b| rtf_to_text(&b)).unwrap_or_default();
        }

        let meta = child(item, "MetaData");
        let meta_value = |name: &str| meta.and_then(|m| child_text(m, name));
        doc.labels = meta_value("LabelID").and_then(|id| self.labels.get(&id).cloned()).into_iter().collect();
        doc.status = meta_value("StatusID").and_then(|id| self.statuses.get(&id).cloned()).unwrap_or_default();
        doc.word_goal = word_target(item).or_else(|| meta.and_then(word_target)).unwrap_or(0);

        // Images, PDFs and other files.
        if !matches!(kind_name, "Folder" | "Text" | "DraftFolder" | "ResearchFolder" | "TrashFolder") {
            self.attach_file(project, &mut doc, files.other.as_deref(), &title);
        }

        let created = item.attribute("Created").and_then(parse_date);
        let modified = item.attribute("Modified").and_then(parse_date);
        let id = project.insert(doc);
        self.summary.documents += 1;
        if let Some(d) = project.get_mut(id) {
            if let Some(c) = created {
                d.created_at = c;
            }
            d.modified_at = modified.or(created).unwrap_or(d.modified_at);
        }

        if has_children {
            self.import_children(project, item, id, draft);
        }
    }

    /// Copy an image into the note as an attachment, or say where the
    /// original file is.
    fn attach_file(&mut self, project: &mut Project, doc: &mut Document, file: Option<&Path>, title: &str) {
        let Some(file) = file else { return };
        let mime = file.extension().and_then(|e| image_mime(&e.to_string_lossy().to_ascii_lowercase()));
        let size = fs::metadata(file).map(|m| m.len()).unwrap_or(u64::MAX);
        if let (Some(mime), true) = (mime, size <= MAX_IMAGE_BYTES) {
            if let Ok(bytes) = fs::read(file) {
                let filename = format!("{title}.{}", file.extension().unwrap_or_default().to_string_lossy());
                let att = ImageAttachment::new(filename.clone(), mime.to_string());
                project.assets.insert(att.id, AssetData { bytes, mime_type: mime.to_string(), filename });
                doc.attachments.push(att);
                self.summary.images += 1;
                return;
            }
        }
        self.summary.not_copied.push(title.to_string());
        if doc.content.is_empty() {
            doc.content = RichDoc::from_paragraph(&format!("Original file: {}", file.display()));
        }
    }

    /// The files of a binder item, in either project layout.
    fn files(&self, item: Node) -> ItemFiles {
        let existing = |p: PathBuf| p.is_file().then_some(p);
        if let Some(uuid) = item.attribute("UUID").filter(|u| is_safe_name(u)) {
            let dir = self.base.join("Files").join("Data").join(uuid);
            let other = fs::read_dir(&dir).ok().and_then(|entries| {
                entries.flatten().map(|e| e.path()).find(|p| {
                    p.is_file()
                        && p.file_stem().is_some_and(|s| s == "content")
                        && !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("rtf"))
                })
            });
            return ItemFiles {
                text: existing(dir.join("content.rtf")),
                notes: existing(dir.join("notes.rtf")),
                synopsis: existing(dir.join("synopsis.txt")),
                other,
            };
        }
        if let Some(id) = item.attribute("ID").filter(|u| is_safe_name(u)) {
            let dir = self.base.join("Files").join("Docs");
            let other = fs::read_dir(&dir).ok().and_then(|entries| {
                entries.flatten().map(|e| e.path()).find(|p| {
                    p.is_file()
                        && p.file_stem().is_some_and(|s| s.to_string_lossy() == id)
                        && !p.extension().is_some_and(|e| e.eq_ignore_ascii_case("rtf"))
                })
            });
            return ItemFiles {
                text: existing(dir.join(format!("{id}.rtf"))),
                notes: existing(dir.join(format!("{id}_notes.rtf"))),
                synopsis: existing(dir.join(format!("{id}_synopsis.txt"))),
                other,
            };
        }
        ItemFiles::default()
    }
}

#[derive(Default)]
struct ItemFiles {
    text: Option<PathBuf>,
    notes: Option<PathBuf>,
    synopsis: Option<PathBuf>,
    /// Image, PDF or other file of a non-text item.
    other: Option<PathBuf>,
}

/// Binder ids are used as file names; anything else is ignored.
fn is_safe_name(s: &str) -> bool {
    !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

fn read_rich(path: &Path) -> RichDoc {
    fs::read(path).map(|b| rtf_to_rich(&b)).unwrap_or_default()
}

fn image_mime(ext: &str) -> Option<&'static str> {
    Some(match ext {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        _ => return None,
    })
}

fn child<'a, 'i>(node: Node<'a, 'i>, name: &str) -> Option<Node<'a, 'i>> {
    node.children().find(|n| n.has_tag_name(name))
}

fn children<'a, 'i: 'a>(node: Node<'a, 'i>, name: &'a str) -> impl Iterator<Item = Node<'a, 'i>> + 'a {
    node.children().filter(move |n| n.has_tag_name(name))
}

fn child_text(node: Node, name: &str) -> Option<String> {
    child(node, name).map(|n| n.text().unwrap_or("").trim().to_string())
}

/// "2023-01-05 10:22:11 +0100" (Scrivener 3) or with a "T".
fn parse_date(s: &str) -> Option<DateTime<Utc>> {
    let s = s.trim();
    ["%Y-%m-%d %H:%M:%S %z", "%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%d %H:%M:%S%z"]
        .iter()
        .find_map(|f| DateTime::parse_from_str(s, f).ok())
        .map(|d| d.with_timezone(&Utc))
}

/// A word target (`<Target Type="Words">2000</Target>`) under `node`.
fn word_target(node: Node) -> Option<u32> {
    let target = child(node, "Target")?;
    let words = target.attribute("Type").map_or(true, |t| t.eq_ignore_ascii_case("Words"));
    words.then(|| target.text()?.trim().parse().ok()).flatten()
}

/// Labels or statuses with their Scrivener ids. "No Label" / "No Status"
/// (id -1) is left out. Labels keep their colour; statuses, which have
/// none in Scrivener, get ScribeForge's status colours in turn.
fn color_defs(root: Node, settings: &str, list: &str, item: &str) -> Vec<(String, ColorDef)> {
    let Some(items) = child(root, settings).and_then(|s| child(s, list)) else {
        return Vec::new();
    };
    let palette = default_statuses();
    let mut out: Vec<(String, ColorDef)> = Vec::new();
    for (i, node) in children(items, item).enumerate() {
        let id = node.attribute("ID").unwrap_or("").to_string();
        let name = node.text().unwrap_or("").trim().to_string();
        if id == "-1" || name.is_empty() || out.iter().any(|(_, d)| d.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        let color = node
            .attribute("Color")
            .and_then(rgb_floats_to_hex)
            .unwrap_or_else(|| palette[i % palette.len()].color.clone());
        out.push((id, ColorDef { name, color }));
    }
    out
}

/// "0.698039 0.2 1.0" → "#b233ff".
fn rgb_floats_to_hex(s: &str) -> Option<String> {
    let parts: Vec<f32> = s.split_whitespace().filter_map(|p| p.parse().ok()).collect();
    if parts.len() < 3 {
        return None;
    }
    let c = |v: f32| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
    Some(format!("#{:02x}{:02x}{:02x}", c(parts[0]), c(parts[1]), c(parts[2])))
}

/// Draft and session word targets, and the deadline.
fn read_targets(root: Node, project: &mut Project) {
    let Some(targets) = child(root, "ProjectTargets") else { return };
    let words = |name: &str| -> Option<u32> {
        let node = child(targets, name)?;
        if node.attribute("Type").is_some_and(|t| !t.eq_ignore_ascii_case("Words")) {
            return None;
        }
        node.text()?.trim().parse().ok()
    };
    let config = &mut project.manifest.config;
    if let Some(n) = words("DraftTarget") {
        config.project_word_goal = n;
    }
    if let Some(n) = words("SessionTarget") {
        config.session_word_goal = n;
    }
    if let Some(deadline) = child_text(targets, "Deadline") {
        config.deadline = deadline.get(..10).and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
    }
}
