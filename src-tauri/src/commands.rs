//! Tauri command surface exposed to the frontend.
//!
//! All commands return `AppResult<T>`; Tauri serialises `AppError` into a
//! string for the frontend.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::compile::{self, CompileFormat, CompilePreset, CompileRequest};
use crate::errors::{AppError, AppResult};
use crate::format_profiles::{self, FormatSettings};
use crate::project::document::{
    CardPos, Comment, DocumentDto, DocumentKind, DocumentMetaDto, ImageAttachment, RichDoc, Sheet,
};
use crate::project::model::{AssetData, TreeError};
use crate::settings::{
    AppearanceSettings, CompositionSettings, EditorSettings, GeneralSettings, SavingSettings,
};
use crate::state::AppState;
use crate::storage::{ensure_scri_extension, read_project_from_path, write_project_to_path};
use crate::templates::{
    build_project_from_template, categories, category_by_id, find_template, template_preview,
    templates_for_category, CategoryDto, TemplatePreview,
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_categories() -> Vec<CategoryDto> {
    categories()
        .iter()
        .map(|c| CategoryDto {
            id: c.id.to_string(),
            label: c.label.to_string(),
            description: c.description.to_string(),
        })
        .collect()
}

#[tauri::command]
pub fn list_templates(category: String) -> AppResult<Vec<TemplatePreview>> {
    if category_by_id(&category).is_none() {
        return Err(AppError::TemplateNotFound(format!("unknown category: {category}")));
    }
    Ok(templates_for_category(&category)
        .iter()
        .map(|t| (*t).into())
        .collect())
}

#[tauri::command]
pub fn get_template_preview(template_id: String) -> AppResult<TemplatePreview> {
    template_preview(&template_id)
}

// ---------------------------------------------------------------------------
// Recent projects
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_recent_projects(state: State<'_, AppState>) -> AppResult<Vec<RecentProjectDto>> {
    let settings = state.settings.read();
    Ok(settings
        .recent_projects
        .iter()
        .map(|r| RecentProjectDto {
            path: r.path.to_string_lossy().to_string(),
            name: r.name.clone(),
            last_opened: r.last_opened,
            available: r.is_available(),
        })
        .collect())
}

#[derive(Debug, Clone, Serialize)]
pub struct RecentProjectDto {
    pub path: String,
    pub name: String,
    pub last_opened: chrono::DateTime<chrono::Utc>,
    pub available: bool,
}

#[tauri::command]
pub fn remove_recent_project(state: State<'_, AppState>, path: String) -> AppResult<()> {
    {
        let mut settings = state.settings.write();
        settings.remove_recent(&PathBuf::from(&path));
    }
    state.settings.read().save()?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Open existing file
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn open_existing_file_dialog(
    state: State<'_, AppState>,
) -> AppResult<Option<OpenProjectResult>> {
    let file = rfd::FileDialog::new()
        .add_filter(localized(&state, "ScribeForge Project", "Proyecto de ScribeForge"), &["scri"])
        .set_title(localized(&state, "Open ScribeForge Project", "Abrir proyecto de ScribeForge"))
        .pick_file();

    let Some(path) = file else {
        return Ok(None);
    };

    let path = ensure_scri_extension(&path);
    let result = open_project_internal(&state, &path)?;
    Ok(Some(result))
}

#[tauri::command]
pub fn open_project_at_path(state: State<'_, AppState>, path: String) -> AppResult<OpenProjectResult> {
    let path = ensure_scri_extension(&PathBuf::from(path));
    open_project_internal(&state, &path)
}

fn open_project_internal(state: &State<'_, AppState>, path: &Path) -> AppResult<OpenProjectResult> {
    if !path.exists() {
        return Err(AppError::InvalidProject(format!(
            "file does not exist: {}",
            path.display()
        )));
    }
    let project = read_project_from_path(path)?;

    let name = project.manifest.name.clone();
    let project_id = project.manifest.project_id.to_string();
    let manifest = serde_json::to_value(&project.manifest)?;

    {
        let mut open = state.open_project.write();
        open.project = Some(project);
        open.path = Some(path.to_path_buf());
        open.dirty = false;
    }
    {
        let mut settings = state.settings.write();
        settings.record_recent(path.to_path_buf(), name);
    }
    state.settings.read().save()?;

    Ok(OpenProjectResult {
        path: path.to_string_lossy().to_string(),
        project_id,
        manifest,
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct OpenProjectResult {
    pub path: String,
    pub project_id: String,
    pub manifest: serde_json::Value,
}

// ---------------------------------------------------------------------------
// Create project
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct CreateProjectArgs {
    pub name: String,
    pub template_id: String,
    /// Directory where the new `.scri` file should be created.
    pub directory: String,
    #[serde(default)]
    pub author: Option<String>,
}

#[tauri::command]
pub fn create_project(
    state: State<'_, AppState>,
    args: CreateProjectArgs,
) -> AppResult<OpenProjectResult> {
    validate_project_name(&args.name)?;

    let dir = PathBuf::from(&args.directory);
    if !dir.exists() {
        fs::create_dir_all(&dir)?;
    }
    if !dir.is_dir() {
        return Err(AppError::PathNotAllowed(format!(
            "not a directory: {}",
            dir.display()
        )));
    }

    let target = ensure_scri_extension(&dir.join(&args.name));
    if target.exists() {
        // Refuse to overwrite silently; the frontend prompts the user before
        // calling create_project with an existing target path.
        return Err(AppError::InvalidName(format!(
            "a file already exists at {}",
            target.display()
        )));
    }

    let template = find_template(&args.template_id)
        .ok_or_else(|| AppError::TemplateNotFound(args.template_id.clone()))?;
    if template.name.is_empty() {
        return Err(AppError::TemplateNotFound(args.template_id.clone()));
    }

    let project = build_project_from_template(&args.template_id, args.name.clone(), args.author.clone())?;

    // Write the file. If anything fails, attempt to clean up the partial file
    // so we never leave a half-written project behind.
    if let Err(e) = write_project_to_path(&project, &target) {
        let _ = fs::remove_file(&target);
        return Err(e);
    }

    // Re-open to validate round-trip.
    open_project_internal(&state, &target)
}

fn validate_project_name(name: &str) -> AppResult<()> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidName("project name cannot be empty".into()));
    }
    if trimmed.len() > 120 {
        return Err(AppError::InvalidName("project name is too long".into()));
    }
    for c in trimmed.chars() {
        if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
            return Err(AppError::InvalidName(format!(
                "project name contains an illegal character: {c:?}"
            )));
        }
    }
    Ok(())
}

// `fs` shorthand used in a couple of commands.
use std::fs;

/// Text for a native dialog in the interface language of the preferences.
/// Titles chosen by the interface arrive already translated.
fn localized(state: &State<'_, AppState>, en: &'static str, es: &'static str) -> &'static str {
    if state.settings.read().general.language == "es" {
        es
    } else {
        en
    }
}

// ---------------------------------------------------------------------------
// Directory picker (native, via rfd)
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn pick_directory(title: Option<String>) -> AppResult<Option<String>> {
    let mut dialog = rfd::FileDialog::new();
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    let picked = dialog.pick_folder();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// Native save-file dialog used by "Save As".
#[tauri::command]
pub fn pick_save_file(
    state: State<'_, AppState>,
    title: Option<String>,
    file_name: Option<String>,
) -> AppResult<Option<String>> {
    let mut dialog = rfd::FileDialog::new()
        .add_filter(localized(&state, "ScribeForge Project", "Proyecto de ScribeForge"), &["scri"]);
    if let Some(t) = title {
        dialog = dialog.set_title(&t);
    }
    if let Some(name) = file_name {
        dialog = dialog.set_file_name(&name);
    }
    let picked = dialog.save_file();
    Ok(picked.map(|p| p.to_string_lossy().to_string()))
}

/// Default location for new projects: `<Documents>/ScribeForge`.
#[tauri::command]
pub fn get_default_project_dir() -> AppResult<String> {
    let base = dirs::document_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| AppError::Other("no documents directory available".into()))?;
    let dir = base.join("ScribeForge");
    Ok(dir.to_string_lossy().to_string())
}

/// Pre-check used by the create dialog to warn before submitting.
#[tauri::command]
pub fn project_path_exists(directory: String, name: String) -> AppResult<bool> {
    let target = ensure_scri_extension(&PathBuf::from(directory).join(name));
    Ok(target.exists())
}

// ---------------------------------------------------------------------------
// Current project queries
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct CurrentProjectDto {
    pub path: String,
    pub project_id: String,
    pub name: String,
    pub author: Option<String>,
    pub binder: Vec<DocumentMetaDto>,
    pub word_count: u32,
    pub dirty: bool,
}

#[tauri::command]
pub fn get_current_project(state: State<'_, AppState>) -> AppResult<CurrentProjectDto> {
    let path_str;
    let project_id;
    let name;
    let author;
    let dirty;
    {
        let open = state.open_project.read();
        let project = open.project.as_ref().ok_or(AppError::NoProjectOpen)?;
        let path = open.path.as_ref().ok_or(AppError::NoProjectOpen)?;
        path_str = path.to_string_lossy().to_string();
        project_id = project.manifest.project_id.to_string();
        name = project.manifest.name.clone();
        author = project.manifest.author.clone();
        dirty = open.dirty;
    }
    let binder = state.with_project(|p| Ok(p.binder_listing()))?;
    let word_count = state.with_project(|p| Ok(p.manuscript_word_count()))?;
    Ok(CurrentProjectDto {
        path: path_str,
        project_id,
        name,
        author,
        binder,
        word_count,
        dirty,
    })
}

#[tauri::command]
pub fn get_document(state: State<'_, AppState>, id: String) -> AppResult<DocumentDto> {
    let uuid = Uuid::parse_str(&id).map_err(|_| AppError::DocumentNotFound(id.clone()))?;
    state.with_project(|p| {
        let doc = p.get(uuid).ok_or_else(|| AppError::DocumentNotFound(id.clone()))?;
        Ok(doc.into())
    })
}

// ---------------------------------------------------------------------------
// Document CRUD
// ---------------------------------------------------------------------------

/// Convert a tree error into an AppError with a user-readable message.
fn tree_err(e: TreeError) -> AppError {
    AppError::Other(e.to_string())
}

fn parse_uuid(id: &str) -> AppResult<Uuid> {
    Uuid::parse_str(id).map_err(|_| AppError::DocumentNotFound(id.to_string()))
}

#[tauri::command]
pub fn create_document(
    state: State<'_, AppState>,
    parent: String,
    kind: String,
    title: Option<String>,
) -> AppResult<DocumentMetaDto> {
    let parent_id = parse_uuid(&parent)?;
    let doc_kind = match kind.as_str() {
        "document" => DocumentKind::Document,
        "folder" => DocumentKind::Folder,
        "research" => DocumentKind::Research,
        _ => return Err(AppError::Other(format!("invalid document kind: {kind}"))),
    };
    let title = title.unwrap_or_else(|| {
        match doc_kind {
            DocumentKind::Folder => localized(&state, "New Folder", "Nueva carpeta"),
            DocumentKind::Research => localized(&state, "New Note", "Nueva nota"),
            _ => localized(&state, "Untitled Document", "Documento sin título"),
        }
        .to_string()
    });

    let meta = state.mutate_project(|p| {
        let id = p.create_child(parent_id, doc_kind, &title).map_err(tree_err)?;
        let doc = p.get(id).ok_or_else(|| AppError::DocumentNotFound(id.to_string()))?;
        Ok(DocumentMetaDto::from_doc(doc, false))
    })?;
    Ok(meta)
}

#[tauri::command]
pub fn rename_document(state: State<'_, AppState>, id: String, title: String) -> AppResult<DocumentMetaDto> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| {
        p.rename(id, &title).map_err(tree_err)?;
        let doc = p.get(id).ok_or_else(|| AppError::DocumentNotFound(id.to_string()))?;
        let in_trash = p.in_trash(id);
        Ok(DocumentMetaDto::from_doc(doc, in_trash))
    })
}

#[tauri::command]
pub fn duplicate_document(state: State<'_, AppState>, id: String) -> AppResult<DocumentMetaDto> {
    let id = parse_uuid(&id)?;
    let suffix = localized(&state, "(copy)", "(copia)");
    state.mutate_project(|p| {
        let new_id = p.duplicate(id).map_err(tree_err)?;
        // The model names copies "<title> (copy)"; use the interface language.
        if suffix != "(copy)" {
            if let Some(doc) = p.get_mut(new_id) {
                if let Some(base) = doc.title.strip_suffix(" (copy)") {
                    doc.title = format!("{base} {suffix}");
                }
            }
        }
        let doc = p.get(new_id).ok_or_else(|| AppError::DocumentNotFound(new_id.to_string()))?;
        let in_trash = p.in_trash(new_id);
        Ok(DocumentMetaDto::from_doc(doc, in_trash))
    })
}

#[tauri::command]
pub fn move_document(
    state: State<'_, AppState>,
    id: String,
    new_parent: String,
    index: Option<i32>,
) -> AppResult<()> {
    let id = parse_uuid(&id)?;
    let parent_id = parse_uuid(&new_parent)?;
    state.mutate_project(|p| {
        p.move_node(id, parent_id, index.unwrap_or(i32::MAX))
            .map_err(tree_err)
    })
}

#[tauri::command]
pub fn move_to_trash(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| p.move_to_trash(id).map_err(tree_err))
}

#[tauri::command]
pub fn restore_from_trash(state: State<'_, AppState>, id: String) -> AppResult<DocumentMetaDto> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| {
        let destination = p.restore_from_trash(id).map_err(tree_err)?;
        let doc = p.get(id).ok_or_else(|| AppError::DocumentNotFound(id.to_string()))?;
        let _ = destination;
        Ok(DocumentMetaDto::from_doc(doc, false))
    })
}

#[tauri::command]
pub fn purge_document(state: State<'_, AppState>, id: String) -> AppResult<()> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| p.purge_subtree(id).map_err(tree_err))
}

#[tauri::command]
pub fn empty_trash(state: State<'_, AppState>) -> AppResult<usize> {
    state.mutate_project(|p| p.empty_trash().map_err(tree_err))
}

/// Update a document's rich-text content, synopsis, notes, labels and/or
/// status in one call. Recomputes the word count.
#[derive(Debug, Clone, Deserialize, Default)]
pub struct UpdateDocumentArgs {
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub content: Option<RichDoc>,
    #[serde(default)]
    pub synopsis: Option<String>,
    /// Corkboard card title; an empty string falls back to the document title.
    #[serde(default)]
    pub card_title: Option<String>,
    /// Binder icon id; an empty string resets to the default icon.
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub labels: Option<Vec<String>>,
    #[serde(default)]
    pub status: Option<String>,
    /// Word-count target; 0 removes it.
    #[serde(default)]
    pub word_goal: Option<u32>,
    /// The full list of margin comments.
    #[serde(default)]
    pub comments: Option<Vec<Comment>>,
    /// Character/place sheet; see `remove_sheet` to drop it.
    #[serde(default)]
    pub sheet: Option<Sheet>,
    #[serde(default)]
    pub remove_sheet: bool,
    /// Freeform corkboard position; see `clear_card_pos` to drop it.
    #[serde(default)]
    pub card_pos: Option<CardPos>,
    #[serde(default)]
    pub clear_card_pos: bool,
}

#[tauri::command]
pub fn update_document(
    state: State<'_, AppState>,
    args: UpdateDocumentArgs,
) -> AppResult<DocumentDto> {
    let id = parse_uuid(&args.id)?;
    state.mutate_project(|p| {
        let doc = p
            .get_mut(id)
            .ok_or_else(|| AppError::DocumentNotFound(id.to_string()))?;
        if let Some(title) = &args.title {
            let t = title.trim();
            if t.is_empty() {
                return Err(AppError::InvalidName("title cannot be empty".into()));
            }
            doc.title = t.to_string();
        }
        if let Some(content) = &args.content {
            doc.content = content.clone();
        }
        if let Some(synopsis) = &args.synopsis {
            doc.synopsis = synopsis.clone();
        }
        if let Some(card_title) = &args.card_title {
            doc.card_title = card_title.trim().to_string();
        }
        if let Some(icon) = &args.icon {
            doc.icon = icon.trim().to_string();
        }
        if let Some(notes) = &args.notes {
            doc.notes = notes.clone();
        }
        if let Some(labels) = &args.labels {
            doc.labels = labels.clone();
        }
        if let Some(status) = &args.status {
            doc.status = status.clone();
        }
        if let Some(goal) = args.word_goal {
            doc.word_goal = goal.min(10_000_000);
        }
        if let Some(comments) = &args.comments {
            doc.comments = comments.clone();
        }
        if let Some(sheet) = &args.sheet {
            doc.sheet = Some(sheet.clone());
        }
        if args.remove_sheet {
            doc.sheet = None;
        }
        if let Some(pos) = args.card_pos {
            if pos.x.is_finite() && pos.y.is_finite() {
                doc.card_pos = Some(CardPos { x: pos.x.clamp(0.0, 20_000.0), y: pos.y.clamp(0.0, 20_000.0) });
            }
        }
        if args.clear_card_pos {
            doc.card_pos = None;
        }
        let words_before = doc.word_count as i64;
        doc.touch();
        let delta = doc.word_count as i64 - words_before;
        let dto: DocumentDto = (&*doc).into();
        // Typing in the editor is what counts as writing.
        if args.content.is_some() {
            p.record_writing(id, delta);
        }
        Ok(dto)
    })
}

/// Whether the open project has unsaved changes.
#[tauri::command]
pub fn is_project_dirty(state: State<'_, AppState>) -> AppResult<bool> {
    Ok(state.open_project.read().dirty)
}

// ---------------------------------------------------------------------------
// Project search
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SearchHitDto {
    pub document_id: String,
    pub title: String,
    pub kind: String,
    pub in_trash: bool,
    /// Plain-text excerpt around the first match, or "" for title-only hits.
    pub excerpt: String,
    /// Where the hit was found: "title", "content", "synopsis", "notes".
    pub field: String,
}

/// Case-insensitive substring search across titles, content, synopsis and
/// notes. Trash is excluded.
#[tauri::command]
pub fn search_project(state: State<'_, AppState>, query: String) -> AppResult<Vec<SearchHitDto>> {
    let q = query.trim().to_lowercase();
    if q.is_empty() {
        return Ok(Vec::new());
    }
    state.with_project(|p| {
        let mut hits = Vec::new();
        for d in p.documents.values() {
            if p.in_trash(d.id) {
                continue;
            }
            let title_hit = d.title.to_lowercase().contains(&q);
            let synopsis_hit = d.synopsis.to_lowercase().contains(&q);
            let notes_hit = d.notes.to_lowercase().contains(&q);
            let plain = d.content.plain_text();
            let content_hit = plain.to_lowercase().contains(&q);

            if !title_hit && !synopsis_hit && !notes_hit && !content_hit {
                continue;
            }

            let (field, excerpt) = if title_hit {
                ("title".to_string(), String::new())
            } else if content_hit {
                let lower = plain.to_lowercase();
                let pos = lower.find(&q).unwrap_or(0);
                let start = pos.saturating_sub(40);
                let end = (pos + q.len() + 60).min(plain.len());
                ("content".to_string(), format!("…{}…", &plain[start..end].replace('\n', " ")))
            } else if synopsis_hit {
                ("synopsis".to_string(), d.synopsis.chars().take(140).collect())
            } else {
                ("notes".to_string(), d.notes.chars().take(140).collect())
            };

            hits.push(SearchHitDto {
                document_id: d.id.to_string(),
                title: d.title.clone(),
                kind: format!("{:?}", d.kind).to_lowercase(),
                in_trash: false,
                excerpt,
                field,
            });
        }
        // Sort by title for stable UX.
        hits.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
        Ok(hits)
    })
}

#[tauri::command]
pub fn save_current_project(state: State<'_, AppState>) -> AppResult<()> {
    state.save_now()
}

/// Autosave hook: saves only when dirty. Returns true if a write happened.
#[tauri::command]
pub fn autosave_project(state: State<'_, AppState>) -> AppResult<bool> {
    state.save_if_dirty()
}

/// Save a copy of the open project to a new path (Save As).
#[tauri::command]
pub fn save_project_as(state: State<'_, AppState>, path: String) -> AppResult<OpenProjectResult> {
    let path = ensure_scri_extension(&PathBuf::from(path));
    if path.exists() {
        return Err(AppError::InvalidName(format!(
            "a file already exists at {}",
            path.display()
        )));
    }
    let (mut project, _) = {
        let guard = state.open_project.read();
        let project = guard.project.as_ref().ok_or(AppError::NoProjectOpen)?;
        (project.clone(), ())
    };
    project.manifest.touch();
    write_project_to_path(&project, &path)?;

    // Open the newly saved copy.
    open_project_internal(&state, &path)
}

#[tauri::command]
pub fn close_project(state: State<'_, AppState>) -> AppResult<()> {
    let mut open = state.open_project.write();
    open.project = None;
    open.path = None;
    open.dirty = false;
    Ok(())
}

// ---------------------------------------------------------------------------
// Image attachments
// ---------------------------------------------------------------------------

/// Hard limit for a single imported image (10 MB).
const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;

fn is_allowed_image_mime(mime: &str) -> bool {
    matches!(
        mime,
        "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/bmp" | "image/svg+xml"
    )
}

/// Payload returned when an attachment is added or fetched.
#[derive(Debug, Clone, Serialize)]
pub struct AttachmentDto {
    pub id: String,
    pub document_id: String,
    pub filename: String,
    pub mime_type: String,
    pub display_width: u32,
    pub display_height: u32,
    /// data:<mime>;base64,<payload> — ready for an <img src>.
    pub data_url: String,
}

fn attachment_dto(att: &ImageAttachment, document_id: Uuid, bytes: &[u8], mime: &str) -> AttachmentDto {
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(bytes);
    AttachmentDto {
        id: att.id.to_string(),
        document_id: document_id.to_string(),
        filename: att.filename.clone(),
        mime_type: mime.to_string(),
        display_width: att.display_width,
        display_height: att.display_height,
        data_url: format!("data:{mime};base64,{b64}"),
    }
}

/// Add an image attachment to a document's Notes tab. The bytes arrive as a
/// base64 data URL from the frontend (drag-and-drop or file picker).
#[tauri::command]
pub fn add_image_attachment(
    state: State<'_, AppState>,
    document_id: String,
    data_url: String,
    filename: Option<String>,
) -> AppResult<AttachmentDto> {
    use base64::Engine;
    let doc_id = parse_uuid(&document_id)?;

    // Parse "data:<mime>;base64,<payload>"
    let rest = data_url
        .strip_prefix("data:")
        .ok_or_else(|| AppError::Other("invalid data URL: missing 'data:' prefix".into()))?;
    let (meta, payload) = rest
        .split_once(',')
        .ok_or_else(|| AppError::Other("invalid data URL: missing comma separator".into()))?;
    let mime = meta
        .strip_suffix(";base64")
        .ok_or_else(|| AppError::Other("invalid data URL: expected ';base64' payload".into()))?
        .to_string();

    if !is_allowed_image_mime(&mime) {
        return Err(AppError::Other(format!(
            "unsupported image type: {mime} (allowed: PNG, JPEG, GIF, WebP, BMP, SVG)"
        )));
    }

    let bytes = base64::engine::general_purpose::STANDARD
        .decode(payload)
        .map_err(|e| AppError::Other(format!("invalid base64 payload: {e}")))?;

    if bytes.len() > MAX_IMAGE_BYTES {
        return Err(AppError::Other(format!(
            "image is too large ({} KB); the limit is 10 MB",
            bytes.len() / 1024
        )));
    }
    // Defensive: sniff magic bytes to confirm the payload matches the claim.
    verify_image_magic(&bytes, &mime)?;

    let filename = filename.unwrap_or_else(|| format!("image.{}", extension_hint(&mime)));

    state.mutate_project(|p| {
        let att = ImageAttachment::new(filename, mime.clone());
        let att_id = att.id;
        p.assets.insert(
            att_id,
            AssetData {
                bytes,
                mime_type: mime.clone(),
                filename: att.filename.clone(),
            },
        );
        let doc = p
            .get_mut(doc_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
        doc.attachments.push(att.clone());
        doc.touch();
        Ok(attachment_dto(&att, doc_id, &p.assets[&att_id].bytes, &mime))
    })
}

/// List all attachments of a document (with data URLs for rendering).
#[tauri::command]
pub fn list_image_attachments(
    state: State<'_, AppState>,
    document_id: String,
) -> AppResult<Vec<AttachmentDto>> {
    let doc_id = parse_uuid(&document_id)?;
    state.with_project(|p| {
        let doc = p
            .get(doc_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
        let mut out = Vec::new();
        for att in &doc.attachments {
            let asset = p
                .assets
                .get(&att.id)
                .ok_or_else(|| AppError::Other(format!("missing asset bytes for {}", att.id)))?;
            out.push(attachment_dto(att, doc_id, &asset.bytes, &asset.mime_type));
        }
        Ok(out)
    })
}

/// Adjust the display size of an attachment.
#[tauri::command]
pub fn resize_image_attachment(
    state: State<'_, AppState>,
    document_id: String,
    attachment_id: String,
    width: u32,
    height: u32,
) -> AppResult<AttachmentDto> {
    let doc_id = parse_uuid(&document_id)?;
    let att_id = parse_uuid(&attachment_id)?;
    // Clamp to sane display bounds.
    let width = width.clamp(32, 4096);
    let height = height.clamp(32, 4096);
    state.mutate_project(|p| {
        let doc = p
            .get_mut(doc_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
        let att = doc
            .attachments
            .iter_mut()
            .find(|a| a.id == att_id)
            .ok_or_else(|| AppError::DocumentNotFound(attachment_id.clone()))?;
        att.display_width = width;
        att.display_height = height;
        let att_clone = att.clone();
        doc.touch();
        let asset = &p.assets[&att_id];
        Ok(attachment_dto(&att_clone, doc_id, &asset.bytes, &asset.mime_type))
    })
}

/// Remove an attachment and its asset bytes permanently.
#[tauri::command]
pub fn remove_image_attachment(
    state: State<'_, AppState>,
    document_id: String,
    attachment_id: String,
) -> AppResult<()> {
    let doc_id = parse_uuid(&document_id)?;
    let att_id = parse_uuid(&attachment_id)?;
    state.mutate_project(|p| {
        let doc = p
            .get_mut(doc_id)
            .ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
        let before = doc.attachments.len();
        doc.attachments.retain(|a| a.id != att_id);
        if doc.attachments.len() == before {
            return Err(AppError::DocumentNotFound(attachment_id.clone()));
        }
        doc.touch();
        p.assets.remove(&att_id);
        Ok(())
    })
}

/// Export an attachment to a file chosen with a native save dialog.
#[tauri::command]
pub fn export_image_attachment(
    state: State<'_, AppState>,
    attachment_id: String,
) -> AppResult<Option<String>> {
    let att_id = parse_uuid(&attachment_id)?;
    let (bytes, filename, mime) = state.with_project(|p| {
        // Find the attachment across all documents (it may belong to any doc).
        for doc in p.documents.values() {
            if let Some(att) = doc.attachments.iter().find(|a| a.id == att_id) {
                let asset = p
                    .assets
                    .get(&att_id)
                    .ok_or_else(|| AppError::Other(format!("missing asset bytes for {att_id}")))?;
                return Ok((asset.bytes.clone(), att.filename.clone(), asset.mime_type.clone()));
            }
        }
        Err(AppError::DocumentNotFound(attachment_id.clone()))
    })?;

    let default_name = format!(
        "image-{}.{}",
        attachment_id.chars().take(8).collect::<String>(),
        extension_hint(&mime)
    );
    let Some(target) = rfd::FileDialog::new()
        .set_title(localized(&state, "Save Image", "Guardar imagen"))
        .add_filter(localized(&state, "Images", "Imágenes"), &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"])
        .set_file_name(if filename.is_empty() { default_name } else { filename })
        .save_file()
    else {
        return Ok(None);
    };
    std::fs::write(&target, &bytes)?;
    Ok(Some(target.to_string_lossy().to_string()))
}

fn extension_hint(mime: &str) -> &'static str {
    match mime {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

/// Confirm the byte payload matches the declared MIME type (magic numbers).
fn verify_image_magic(bytes: &[u8], mime: &str) -> AppResult<()> {
    let ok = match mime {
        "image/png" => {
            bytes.len() > 8 && bytes[..8] == [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]
        }
        "image/jpeg" => bytes.len() > 3 && bytes[..3] == [0xFF, 0xD8, 0xFF],
        "image/gif" => {
            bytes.len() > 6
                && (bytes[..6] == *b"GIF87a" || bytes[..6] == *b"GIF89a")
        }
        "image/bmp" => bytes.len() > 2 && bytes[..2] == [0x42, 0x4D],
        // WebP: RIFF....WEBP
        "image/webp" => {
            bytes.len() > 12 && bytes[..4] == *b"RIFF" && bytes[8..12] == *b"WEBP"
        }
        // SVG is textual; accept if it starts with '<' (after whitespace/BOM).
        "image/svg+xml" => {
            let head: Vec<u8> = bytes.iter().copied().take(64).collect();
            let trimmed = head
                .iter()
                .skip_while(|b| b.is_ascii_whitespace())
                .copied()
                .collect::<Vec<u8>>();
            trimmed.first() == Some(&b'<')
        }
        _ => false,
    };
    if !ok {
        return Err(AppError::Other(format!(
            "image data does not match the declared type ({mime})"
        )));
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Compile / export
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_compile_presets(state: State<'_, AppState>) -> Vec<CompilePreset> {
    let mut list = compile::presets();
    let s = state.settings.read();
    let id = &s.format.active_profile;
    let name = format_profiles::builtin_name(id).unwrap_or_else(|| id.clone());
    list.insert(
        0,
        CompilePreset {
            id: format_profiles::COMPILE_PRESET_ID.into(),
            label: format!("Writing Format: {name}"),
            description: "Uses the active profile from Preferences › Format: font, line spacing, indents, \
                          page, margins, chapter start, scene separator and header."
                .into(),
            settings: s.format.active().compile_settings(&s.general.language),
        },
    );
    list
}

/// The built-in writing format profiles with their original values.
#[tauri::command]
pub fn list_format_profiles() -> Vec<format_profiles::BuiltinProfile> {
    format_profiles::builtin_profiles()
}

/// Compile the selection, asking where to save it with a native dialog.
/// Returns the written path, or `None` if the user cancelled.
#[tauri::command]
pub fn compile_project(state: State<'_, AppState>, request: CompileRequest) -> AppResult<Option<String>> {
    let (bytes, name) = state.with_project(|p| {
        let bytes = compile::compile(p, &request)?;
        Ok((bytes, p.manifest.name.clone()))
    })?;
    let ext = request.format.extension();
    let file_name = format!("{}.{ext}", request.title.as_deref().filter(|t| !t.trim().is_empty()).unwrap_or(&name).trim());
    let format_label = match request.format {
        CompileFormat::Txt => localized(&state, "Plain Text", "Texto sin formato"),
        CompileFormat::Markdown => "Markdown",
        CompileFormat::Html => localized(&state, "Web Page", "Página web"),
        CompileFormat::Docx => localized(&state, "Word Document", "Documento de Word"),
        CompileFormat::Pdf => localized(&state, "PDF Document", "Documento PDF"),
        CompileFormat::Epub => localized(&state, "EPUB Ebook", "Libro electrónico EPUB"),
    };
    let Some(target) = rfd::FileDialog::new()
        .set_title(localized(&state, "Compile Project", "Compilar proyecto"))
        .add_filter(format_label, &[ext])
        .set_file_name(&file_name)
        .save_file()
    else {
        return Ok(None);
    };
    let target = if target.extension().is_none() { target.with_extension(ext) } else { target };
    fs::write(&target, &bytes)?;
    Ok(Some(target.to_string_lossy().to_string()))
}

/// Compile to a string for the in-dialog preview (text formats only).
#[tauri::command]
pub fn compile_preview(state: State<'_, AppState>, request: CompileRequest) -> AppResult<String> {
    if !matches!(request.format, CompileFormat::Txt | CompileFormat::Markdown | CompileFormat::Html) {
        return Err(AppError::Other("preview is only available for text formats".into()));
    }
    let bytes = state.with_project(|p| compile::compile(p, &request))?;
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

/// The user-editable part of the global settings (everything except the
/// recent-projects history).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PreferencesDto {
    pub general: GeneralSettings,
    pub editor: EditorSettings,
    pub appearance: AppearanceSettings,
    pub saving: SavingSettings,
    pub composition: CompositionSettings,
    #[serde(default)]
    pub format: FormatSettings,
}

fn preferences_of(s: &crate::settings::Settings) -> PreferencesDto {
    PreferencesDto {
        general: s.general.clone(),
        editor: s.editor.clone(),
        appearance: s.appearance.clone(),
        saving: s.saving.clone(),
        composition: s.composition.clone(),
        format: s.format.clone(),
    }
}

#[tauri::command]
pub fn get_preferences(state: State<'_, AppState>) -> PreferencesDto {
    preferences_of(&state.settings.read())
}

/// Replace the preferences, clamp them to valid ranges, save them to disk and
/// return what was stored.
#[tauri::command]
pub fn update_preferences(state: State<'_, AppState>, prefs: PreferencesDto) -> AppResult<PreferencesDto> {
    let stored = {
        let mut s = state.settings.write();
        s.general = prefs.general;
        s.editor = prefs.editor;
        s.appearance = prefs.appearance;
        s.saving = prefs.saving;
        s.composition = prefs.composition;
        s.format = prefs.format;
        s.sanitize();
        preferences_of(&s)
    };
    state.settings.read().save()?;
    Ok(stored)
}

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    log::info!("Quit requested");
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Writing goals and statistics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct WritingGoalsDto {
    pub project_goal: u32,
    pub session_goal: u32,
    /// `YYYY-MM-DD`, or null when there is no deadline.
    pub deadline: Option<chrono::NaiveDate>,
    pub manuscript_words: u32,
    pub session_added: u32,
    pub session_removed: u32,
    pub session_started_at: chrono::DateTime<chrono::Utc>,
    pub today_added: u32,
    /// Days left until the deadline, counting today.
    pub days_left: Option<i64>,
    /// Words a day needed to reach the project goal by the deadline.
    pub words_per_day: Option<u32>,
}

fn goals_of(p: &crate::project::model::Project) -> WritingGoalsDto {
    use crate::writing::stats;
    let cfg = &p.manifest.config;
    let today = stats::today();
    let manuscript_words = p.manuscript_word_count();
    let (days_left, words_per_day) = match cfg.deadline {
        Some(deadline) if cfg.project_word_goal > 0 => {
            let (d, w) = stats::daily_target(cfg.project_word_goal, manuscript_words, deadline, today);
            (Some(d), w)
        }
        Some(deadline) => (Some((deadline - today).num_days() + 1), None),
        None => (None, None),
    };
    WritingGoalsDto {
        project_goal: cfg.project_word_goal,
        session_goal: cfg.session_word_goal,
        deadline: cfg.deadline,
        manuscript_words,
        session_added: p.session.added,
        session_removed: p.session.removed,
        session_started_at: p.session.started_at,
        today_added: p.stats.added_on(today),
        days_left,
        words_per_day,
    }
}

#[tauri::command]
pub fn get_writing_goals(state: State<'_, AppState>) -> AppResult<WritingGoalsDto> {
    state.with_project(|p| Ok(goals_of(p)))
}

#[derive(Debug, Clone, Deserialize)]
pub struct WritingGoalsArgs {
    pub project_goal: u32,
    pub session_goal: u32,
    /// `YYYY-MM-DD`; empty or null removes the deadline.
    #[serde(default)]
    pub deadline: Option<String>,
}

#[tauri::command]
pub fn set_writing_goals(state: State<'_, AppState>, args: WritingGoalsArgs) -> AppResult<WritingGoalsDto> {
    let deadline = match args.deadline.as_deref().map(str::trim) {
        None | Some("") => None,
        Some(s) => Some(
            chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d")
                .map_err(|_| AppError::Other(format!("invalid deadline: {s}")))?,
        ),
    };
    state.mutate_project(|p| {
        let cfg = &mut p.manifest.config;
        cfg.project_word_goal = args.project_goal.min(100_000_000);
        cfg.session_word_goal = args.session_goal.min(10_000_000);
        cfg.deadline = deadline;
        p.touch();
        Ok(goals_of(p))
    })
}

/// Start a new writing session (the session counter goes back to zero).
#[tauri::command]
pub fn reset_writing_session(state: State<'_, AppState>) -> AppResult<WritingGoalsDto> {
    state.with_project_mut(|p| {
        p.session = crate::writing::stats::SessionStats::default();
        Ok(goals_of(p))
    })
}

#[tauri::command]
pub fn get_writing_stats(state: State<'_, AppState>) -> AppResult<crate::writing::stats::StatsSummary> {
    state.with_project(|p| Ok(p.stats.summary(crate::writing::stats::today())))
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

use crate::writing::snapshots::{Snapshot, SnapshotMeta};

#[tauri::command]
pub fn create_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    name: Option<String>,
) -> AppResult<SnapshotMeta> {
    let id = parse_uuid(&document_id)?;
    state.mutate_project(|p| p.take_snapshot(id, name.as_deref().unwrap_or("")).map_err(tree_err))
}

#[tauri::command]
pub fn list_snapshots(state: State<'_, AppState>, document_id: String) -> AppResult<Vec<SnapshotMeta>> {
    let id = parse_uuid(&document_id)?;
    state.with_project(|p| Ok(p.list_snapshots(id)))
}

#[tauri::command]
pub fn get_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    snapshot_id: String,
) -> AppResult<Snapshot> {
    let id = parse_uuid(&document_id)?;
    let sid = parse_uuid(&snapshot_id)?;
    state.with_project(|p| {
        p.snapshot(id, sid)
            .cloned()
            .ok_or_else(|| AppError::DocumentNotFound(snapshot_id.clone()))
    })
}

#[tauri::command]
pub fn rename_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    snapshot_id: String,
    name: String,
) -> AppResult<()> {
    let id = parse_uuid(&document_id)?;
    let sid = parse_uuid(&snapshot_id)?;
    state.mutate_project(|p| p.rename_snapshot(id, sid, &name).map_err(tree_err))
}

#[tauri::command]
pub fn delete_snapshot(state: State<'_, AppState>, document_id: String, snapshot_id: String) -> AppResult<()> {
    let id = parse_uuid(&document_id)?;
    let sid = parse_uuid(&snapshot_id)?;
    state.mutate_project(|p| p.delete_snapshot(id, sid).map_err(tree_err))
}

/// Put a snapshot's text back into the document. The text it replaces is
/// kept as a new snapshot.
#[tauri::command]
pub fn restore_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    snapshot_id: String,
) -> AppResult<DocumentDto> {
    let id = parse_uuid(&document_id)?;
    let sid = parse_uuid(&snapshot_id)?;
    state.mutate_project(|p| {
        p.restore_snapshot(id, sid).map_err(tree_err)?;
        let doc = p.get(id).ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
        Ok(doc.into())
    })
}

/// Compare a snapshot with the current text, or with another snapshot when
/// `other_id` is given (the older one is treated as the original).
#[tauri::command]
pub fn diff_snapshot(
    state: State<'_, AppState>,
    document_id: String,
    snapshot_id: String,
    other_id: Option<String>,
) -> AppResult<crate::writing::diff::DiffResult> {
    let id = parse_uuid(&document_id)?;
    let sid = parse_uuid(&snapshot_id)?;
    let other = other_id.as_deref().map(parse_uuid).transpose()?;
    state.with_project(|p| {
        let snap = p.snapshot(id, sid).ok_or_else(|| AppError::DocumentNotFound(snapshot_id.clone()))?;
        match other {
            Some(oid) => {
                let o = p.snapshot(id, oid).ok_or_else(|| AppError::DocumentNotFound(oid.to_string()))?;
                let (old, new) = if o.created_at < snap.created_at { (o, snap) } else { (snap, o) };
                Ok(crate::writing::diff::diff_docs(&old.content, &new.content))
            }
            None => {
                let doc = p.get(id).ok_or_else(|| AppError::DocumentNotFound(document_id.clone()))?;
                Ok(crate::writing::diff::diff_docs(&snap.content, &doc.content))
            }
        }
    })
}

// ---------------------------------------------------------------------------
// Spelling
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct SpellingDto {
    /// "es", "en", "es,en" or "off".
    pub language: String,
    pub dictionary: Vec<String>,
}

fn spelling_of(p: &crate::project::model::Project) -> SpellingDto {
    SpellingDto {
        language: p.manifest.config.spell_language.clone(),
        dictionary: p.dictionary.iter().cloned().collect(),
    }
}

#[tauri::command]
pub fn get_spelling(state: State<'_, AppState>) -> AppResult<SpellingDto> {
    state.with_project(|p| Ok(spelling_of(p)))
}

#[tauri::command]
pub fn set_spell_language(state: State<'_, AppState>, language: String) -> AppResult<SpellingDto> {
    let language = crate::writing::spelling::normalize_setting(&language);
    state.mutate_project(|p| {
        p.manifest.config.spell_language = language;
        p.touch();
        Ok(spelling_of(p))
    })
}

#[tauri::command]
pub fn add_to_dictionary(state: State<'_, AppState>, word: String) -> AppResult<SpellingDto> {
    let entry = crate::writing::spelling::personal_entry(&word)
        .ok_or_else(|| AppError::InvalidName(format!("cannot add {word:?} to the dictionary")))?;
    state.mutate_project(|p| {
        p.dictionary.insert(entry);
        p.touch();
        Ok(spelling_of(p))
    })
}

#[tauri::command]
pub fn remove_from_dictionary(state: State<'_, AppState>, word: String) -> AppResult<SpellingDto> {
    state.mutate_project(|p| {
        p.dictionary.remove(&word);
        p.touch();
        Ok(spelling_of(p))
    })
}

/// The misspelled words among `words`, using the project's languages and
/// personal dictionary.
#[tauri::command]
pub async fn spell_check(state: State<'_, AppState>, words: Vec<String>) -> AppResult<Vec<String>> {
    let (language, personal) = state.with_project(|p| Ok((p.manifest.config.spell_language.clone(), p.dictionary.clone())))?;
    // Loading a dictionary the first time takes a moment; keep it off the
    // main thread.
    tauri::async_runtime::spawn_blocking(move || crate::writing::spelling::misspelled(&language, &personal, &words))
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

#[tauri::command]
pub async fn spell_suggest(state: State<'_, AppState>, word: String) -> AppResult<Vec<String>> {
    let language = state.with_project(|p| Ok(p.manifest.config.spell_language.clone()))?;
    tauri::async_runtime::spawn_blocking(move || crate::writing::spelling::suggest(&language, &word, 8))
        .await
        .map_err(|e| AppError::Other(e.to_string()))
}

// ---------------------------------------------------------------------------
// Find and replace
// ---------------------------------------------------------------------------

use crate::writing::replace::{FindOptions, FindResult, ReplaceResult};

/// Every match of the search in the project (Trash excluded). With a
/// replacement, each match also shows what it would become.
#[tauri::command]
pub fn find_in_project(
    state: State<'_, AppState>,
    options: FindOptions,
    replacement: Option<String>,
) -> AppResult<FindResult> {
    state.with_project(|p| crate::writing::replace::find(p, &options, replacement.as_deref()).map_err(AppError::Other))
}

/// Replace the matches whose ids are listed in `ids` (every match when
/// `ids` is null). Each document whose text changes gets a snapshot first,
/// so the replacement can be undone.
#[tauri::command]
pub fn replace_in_project(
    state: State<'_, AppState>,
    options: FindOptions,
    replacement: String,
    ids: Option<Vec<String>>,
) -> AppResult<ReplaceResult> {
    let selected: Option<std::collections::HashSet<String>> = ids.map(|v| v.into_iter().collect());
    state.mutate_project(|p| {
        let found = crate::writing::replace::find(p, &options, None).map_err(AppError::Other)?;
        let mut to_snapshot: Vec<Uuid> = found
            .matches
            .iter()
            .filter(|m| m.field == "text")
            .filter(|m| selected.as_ref().map_or(true, |s| s.contains(&m.id)))
            .map(|m| m.document_id)
            .collect();
        to_snapshot.dedup();
        let label: String = options.query.chars().take(40).collect();
        for id in to_snapshot {
            p.take_snapshot(id, &format!("Before replacing \u{201c}{label}\u{201d}")).map_err(tree_err)?;
        }
        crate::writing::replace::replace(p, &options, &replacement, selected.as_ref()).map_err(AppError::Other)
    })
}

// ---------------------------------------------------------------------------
// Labels and statuses
// ---------------------------------------------------------------------------

use crate::organization::collections::{self as collections, Collection};
use crate::organization::labels::{self as labels, Rename};
use crate::organization::timeline::{self as timeline, TimelineEvent};
use crate::project::manifest::ColorDef;

#[derive(Debug, Clone, Serialize)]
pub struct OrganizationDto {
    pub labels: Vec<ColorDef>,
    pub statuses: Vec<ColorDef>,
}

fn organization_of(p: &crate::project::model::Project) -> OrganizationDto {
    OrganizationDto { labels: p.manifest.config.labels.clone(), statuses: p.manifest.config.statuses.clone() }
}

#[tauri::command]
pub fn get_organization(state: State<'_, AppState>) -> AppResult<OrganizationDto> {
    state.with_project(|p| Ok(organization_of(p)))
}

/// Store the label and status lists. `renames` carries the entries the user
/// renamed, so documents using the old name follow.
#[tauri::command]
pub fn set_organization(
    state: State<'_, AppState>,
    labels_list: Vec<ColorDef>,
    statuses: Vec<ColorDef>,
    renames: Vec<Rename>,
) -> AppResult<OrganizationDto> {
    state.mutate_project(|p| {
        labels::apply_renames(p, &renames);
        p.manifest.config.labels = labels::clean(labels_list);
        p.manifest.config.statuses = labels::clean(statuses);
        p.touch();
        Ok(organization_of(p))
    })
}

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> AppResult<Vec<Collection>> {
    state.with_project(|p| Ok(p.collections.clone()))
}

/// Create or update a collection (matched by id).
#[tauri::command]
pub fn save_collection(state: State<'_, AppState>, collection: Collection) -> AppResult<Vec<Collection>> {
    let mut c = collection;
    c.sanitize();
    state.mutate_project(|p| {
        match p.collections.iter_mut().find(|x| x.id == c.id) {
            Some(existing) => *existing = c,
            None => p.collections.push(c),
        }
        p.touch();
        Ok(p.collections.clone())
    })
}

#[tauri::command]
pub fn delete_collection(state: State<'_, AppState>, id: String) -> AppResult<Vec<Collection>> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| {
        p.collections.retain(|c| c.id != id);
        p.touch();
        Ok(p.collections.clone())
    })
}

/// Move a collection tab to another position.
#[tauri::command]
pub fn move_collection(state: State<'_, AppState>, id: String, index: usize) -> AppResult<Vec<Collection>> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| {
        if let Some(pos) = p.collections.iter().position(|c| c.id == id) {
            let c = p.collections.remove(pos);
            let at = index.min(p.collections.len());
            p.collections.insert(at, c);
            p.touch();
        }
        Ok(p.collections.clone())
    })
}

#[tauri::command]
pub fn add_to_collection(state: State<'_, AppState>, id: String, documents: Vec<String>) -> AppResult<Vec<Collection>> {
    let id = parse_uuid(&id)?;
    let docs: Vec<Uuid> = documents.iter().map(|d| parse_uuid(d)).collect::<AppResult<_>>()?;
    state.mutate_project(|p| {
        let c = p
            .collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::Other("collection not found".into()))?;
        for d in docs {
            if !c.items.contains(&d) {
                c.items.push(d);
            }
        }
        p.touch();
        Ok(p.collections.clone())
    })
}

#[tauri::command]
pub fn remove_from_collection(state: State<'_, AppState>, id: String, document: String) -> AppResult<Vec<Collection>> {
    let id = parse_uuid(&id)?;
    let doc = parse_uuid(&document)?;
    state.mutate_project(|p| {
        if let Some(c) = p.collections.iter_mut().find(|c| c.id == id) {
            c.items.retain(|i| *i != doc);
        }
        p.touch();
        Ok(p.collections.clone())
    })
}

/// The documents a collection shows right now.
#[tauri::command]
pub fn collection_items(state: State<'_, AppState>, id: String) -> AppResult<Vec<DocumentMetaDto>> {
    let id = parse_uuid(&id)?;
    state.with_project(|p| {
        let c = p
            .collections
            .iter()
            .find(|c| c.id == id)
            .ok_or_else(|| AppError::Other("collection not found".into()))?;
        Ok(collections::items(p, c))
    })
}

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

/// Links written in a document and the documents that link to it.
#[tauri::command]
pub fn get_links(state: State<'_, AppState>, id: String) -> AppResult<crate::organization::links::LinksDto> {
    let id = parse_uuid(&id)?;
    state.with_project(|p| Ok(crate::organization::links::links_of(p, id)))
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/// Every timeline event, in story order.
#[tauri::command]
pub fn get_timeline(state: State<'_, AppState>) -> AppResult<Vec<TimelineEvent>> {
    state.with_project(|p| {
        let mut v = p.timeline.clone();
        timeline::sort(&mut v);
        Ok(v)
    })
}

/// Create or update an event (matched by id). Returns the whole timeline.
#[tauri::command]
pub fn save_timeline_event(state: State<'_, AppState>, event: TimelineEvent) -> AppResult<Vec<TimelineEvent>> {
    let mut e = event;
    e.sanitize();
    state.mutate_project(|p| {
        match p.timeline.iter_mut().find(|x| x.id == e.id) {
            Some(existing) => *existing = e,
            None => p.timeline.push(e),
        }
        p.touch();
        let mut v = p.timeline.clone();
        timeline::sort(&mut v);
        Ok(v)
    })
}

#[tauri::command]
pub fn delete_timeline_event(state: State<'_, AppState>, id: String) -> AppResult<Vec<TimelineEvent>> {
    let id = parse_uuid(&id)?;
    state.mutate_project(|p| {
        p.timeline.retain(|e| e.id != id);
        p.touch();
        let mut v = p.timeline.clone();
        timeline::sort(&mut v);
        Ok(v)
    })
}

// ---------------------------------------------------------------------------
// Corkboard
// ---------------------------------------------------------------------------

/// Forget the freeform positions of a folder's cards (back to grid order).
#[tauri::command]
pub fn reset_card_positions(state: State<'_, AppState>, folder: String) -> AppResult<()> {
    let folder = parse_uuid(&folder)?;
    state.mutate_project(|p| {
        for d in p.documents.values_mut() {
            if d.parent == Some(folder) {
                d.card_pos = None;
            }
        }
        p.touch();
        Ok(())
    })
}
