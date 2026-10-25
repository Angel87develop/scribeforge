//! Tauri command surface exposed to the frontend.
//!
//! All commands return `AppResult<T>`; Tauri serialises `AppError` into a
//! string for the frontend.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, State};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};
use crate::project::document::{DocumentDto, DocumentKind, DocumentMetaDto, ImageAttachment, RichDoc};
use crate::project::model::{AssetData, TreeError};
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
        .add_filter("ScribeForge Project", &["scri"])
        .set_title("Open ScribeForge Project")
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
pub fn pick_save_file(title: Option<String>, file_name: Option<String>) -> AppResult<Option<String>> {
    let mut dialog = rfd::FileDialog::new()
        .add_filter("ScribeForge Project", &["scri"]);
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
            DocumentKind::Folder => "New Folder".to_string(),
            DocumentKind::Research => "New Note".to_string(),
            _ => "Untitled Document".to_string(),
        }
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
    state.mutate_project(|p| {
        let new_id = p.duplicate(id).map_err(tree_err)?;
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
        doc.touch();
        let dto: DocumentDto = (&*doc).into();
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
        .set_title("Save Image")
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"])
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

#[tauri::command]
pub fn quit_app(app: AppHandle) {
    log::info!("Quit requested");
    app.exit(0);
}
