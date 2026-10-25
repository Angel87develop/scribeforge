//! Reading and writing the `.scri` ZIP container.

use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, BufWriter, Read, Seek, Write};
use std::path::{Path, PathBuf};

use chrono::Utc;
use uuid::Uuid;
use zip::result::ZipError;
use zip::write::SimpleFileOptions;
use zip::{ZipArchive, ZipWriter};

use super::paths::assert_safe_entry_name;
use crate::errors::{AppError, AppResult};
use crate::project::document::Document;
use crate::project::manifest::{Manifest, FORMAT_VERSION};
use crate::project::model::Project;

const MANIFEST_PATH: &str = "manifest.json";
const DOCUMENT_INDEX_PATH: &str = "documents/index.json";
const DOCUMENTS_DIR: &str = "documents";
const METADATA_DIR: &str = "metadata";
const METADATA_PROJECT_PATH: &str = "metadata/project.json";
const ASSETS_DIR: &str = "assets";

#[derive(serde::Serialize, serde::Deserialize, Default)]
struct DocumentIndex {
    /// Ordered ids; useful as a fallback if folder structure has to be rebuilt.
    #[serde(default)]
    pub ids: Vec<Uuid>,
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

/// Write `project` to `path` safely.
///
/// Steps:
/// 1. Serialise the project to a fresh in-memory representation.
/// 2. Write a `.scri.tmp` archive next to the target.
/// 3. Re-open the temp archive and verify it parses back.
/// 4. Atomically replace the target (with Windows fallback).
/// 5. Prune old backups according to the project config.
pub fn write_project_to_path(project: &Project, path: &Path) -> AppResult<()> {
    let target = path.to_path_buf();
    let parent = target
        .parent()
        .ok_or_else(|| AppError::PathNotAllowed("target has no parent directory".into()))?;

    fs::create_dir_all(parent)?;

    // Existing file is preserved as a one-shot backup if the write fails.
    let backup_of_original = if target.exists() {
        let bak = parent.join(format!(
            "{}.scri.bak",
            target
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("project")
        ));
        Some((target.clone(), bak))
    } else {
        None
    };

    let temp_path = parent.join(format!(
        ".{}.scri.tmp",
        target.file_name().and_then(|s| s.to_str()).unwrap_or("project")
    ));

    // Remove any stale temp file from a previous failed run.
    let _ = fs::remove_file(&temp_path);

    write_archive(project, &temp_path)?;

    // Verify by reading back.
    {
        let file = File::open(&temp_path)?;
        let mut zip = ZipArchive::new(BufReader::new(file))?;
        verify_archive(&mut zip)?;
        // Re-read the manifest to confirm round-trip.
        let manifest = read_manifest(&mut zip)?;
        if manifest.format_version != FORMAT_VERSION && manifest.format_version > FORMAT_VERSION {
            // A future version we cannot understand — refuse to overwrite.
            return Err(AppError::InvalidProject(format!(
                "file uses format version {} which is newer than supported {}",
                manifest.format_version, FORMAT_VERSION
            )));
        }
    }

    // Atomic-ish replace. On Windows `fs::rename` over an existing file fails,
    // so we move the original aside first, then rename the temp, then clean up.
    if target.exists() {
        // Try direct rename (works on most filesystems when target is not locked).
        if fs::rename(&temp_path, &target).is_err() {
            let stale = parent.join(format!(
                "{}.scri.old",
                target.file_name().and_then(|s| s.to_str()).unwrap_or("project")
            ));
            let _ = fs::remove_file(&stale);
            fs::rename(&target, &stale)?;
            fs::rename(&temp_path, &target)?;
            let _ = fs::remove_file(&stale);
        }
    } else {
        fs::rename(&temp_path, &target)?;
    }

    // Best-effort backup rotation.
    if let Some(backup_count) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        project.manifest.config.backup_count
    }))
    .ok()
    {
        let _ = rotate_backups(&target, backup_count.max(1) as usize);
    }

    // Original was successfully replaced; the one-shot backup is no longer needed.
    if let Some((_, bak)) = backup_of_original {
        let _ = fs::remove_file(&bak);
    }

    Ok(())
}

fn write_archive(project: &Project, path: &Path) -> AppResult<()> {
    let file = File::create(path)?;
    let mut zip = ZipWriter::new(BufWriter::new(file));
    let opts = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // manifest.json
    let manifest_json = serde_json::to_vec_pretty(&project.manifest)?;
    zip.start_file(MANIFEST_PATH, opts)?;
    zip.write_all(&manifest_json)?;

    // documents/<uuid>.json — one file per document
    let mut ids_in_order: Vec<(Option<Uuid>, i32, Uuid)> = project
        .documents
        .values()
        .map(|d| (d.parent, d.order, d.id))
        .collect();
    ids_in_order.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    let ids: Vec<Uuid> = ids_in_order.iter().map(|(_, _, id)| *id).collect();

    for id in &ids {
        let doc = project
            .documents
            .get(id)
            .ok_or_else(|| AppError::DocumentNotFound(id.to_string()))?;
        let json = serde_json::to_vec_pretty(doc)?;
        let entry = format!("{DOCUMENTS_DIR}/{id}.json");
        zip.start_file(&entry, opts)?;
        zip.write_all(&json)?;
    }

    // documents/index.json
    let index = DocumentIndex { ids: ids.clone() };
    let index_json = serde_json::to_vec_pretty(&index)?;
    zip.start_file(DOCUMENT_INDEX_PATH, opts)?;
    zip.write_all(&index_json)?;

    // metadata/project.json — mirror of project config for tooling that does
    // not want to parse the full manifest.
    let meta_json = serde_json::to_vec_pretty(&project.manifest.config)?;
    zip.start_file(METADATA_PROJECT_PATH, opts)?;
    zip.write_all(&meta_json)?;

    // assets/<uuid>.<ext> — one binary file per image attachment.
    // Iterate all documents' attachments and write the bytes from project.assets.
    let mut written_assets = std::collections::HashSet::new();
    for doc in project.documents.values() {
        for att in &doc.attachments {
            if written_assets.contains(&att.id) {
                continue;
            }
            if let Some(asset) = project.assets.get(&att.id) {
                let ext = extension_for_mime(&asset.mime_type);
                let entry = format!("{ASSETS_DIR}/{}.{ext}", att.id);
                // Use stored (no-compression) for already-compressed image formats
                // (PNG, JPEG, WebP) to avoid wasting CPU on incompressible data.
                let asset_opts = SimpleFileOptions::default()
                    .compression_method(zip::CompressionMethod::Stored)
                    .unix_permissions(0o644);
                zip.start_file(&entry, asset_opts)?;
                zip.write_all(&asset.bytes)?;
                written_assets.insert(att.id);
            }
        }
    }

    zip.finish()?;
    Ok(())
}

/// Map a MIME type to a file extension for the assets/ directory.
fn extension_for_mime(mime: &str) -> &'static str {
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

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

pub fn read_project_from_path(path: &Path) -> AppResult<Project> {
    let file = File::open(path)?;
    let mut zip = ZipArchive::new(BufReader::new(file))?;
    verify_archive(&mut zip)?;

    let mut manifest = read_manifest(&mut zip)?;
    let mut documents: HashMap<Uuid, Document> = HashMap::new();

    // Prefer the index for ordering stability, but fall back to scanning the
    // documents/ directory if the index is missing (defensive).
    let index_ids: Vec<Uuid> = match read_json_entry(&mut zip, DOCUMENT_INDEX_PATH) {
        Ok(idx) => serde_json::from_value::<DocumentIndex>(idx)?.ids,
        Err(_) => Vec::new(),
    };

    if !index_ids.is_empty() {
        for id in &index_ids {
            let entry = format!("{DOCUMENTS_DIR}/{id}.json");
            let value = read_json_entry(&mut zip, &entry)?;
            let doc: Document = serde_json::from_value(value)?;
            documents.insert(doc.id, doc);
        }
    } else {
        for i in 0..zip.len() {
            let entry = zip.by_index(i)?;
            let name = entry.name().to_string();
            drop(entry);
            if name.starts_with(DOCUMENTS_DIR) && name.ends_with(".json") && name != DOCUMENT_INDEX_PATH {
                let value = read_json_entry(&mut zip, &name)?;
                let doc: Document = serde_json::from_value(value)?;
                documents.insert(doc.id, doc);
            }
        }
    }

    // Migration: if the file is from an older format version, run migrations.
    if manifest.format_version < FORMAT_VERSION {
        migrate(&mut manifest, &mut documents)?;
    }
    // Refuse to open files from the future.
    if manifest.format_version > FORMAT_VERSION {
        return Err(AppError::InvalidProject(format!(
            "this file uses format version {}, but this build of ScribeForge only supports up to {}",
            manifest.format_version, FORMAT_VERSION
        )));
    }

    // Read image assets from assets/ directory.
    let mut assets: HashMap<Uuid, crate::project::model::AssetData> = HashMap::new();
    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        if name.starts_with(ASSETS_DIR) && !name.ends_with('/') {
            // Filename is assets/<uuid>.<ext>
            let file_name = name.strip_prefix(ASSETS_DIR).unwrap().trim_start_matches('/');
            let uuid_str = match file_name.split_once('.') {
                Some((uid, _ext)) => uid,
                None => continue,
            };
            if let Ok(uid) = Uuid::parse_str(uuid_str) {
                let mut bytes = Vec::with_capacity(entry.size() as usize);
                let mut entry = entry;
                entry.read_to_end(&mut bytes)?;
                let ext = file_name.rsplit('.').next().unwrap_or("bin");
                let mime = mime_for_extension(ext);
                let original_filename = file_name.to_string();
                assets.insert(
                    uid,
                    crate::project::model::AssetData {
                        bytes,
                        mime_type: mime.to_string(),
                        filename: original_filename,
                    },
                );
            }
        }
    }

    Ok(Project { manifest, documents, assets })
}

/// Reverse map: file extension → MIME type.
fn mime_for_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "svg" => "image/svg+xml",
        _ => "application/octet-stream",
    }
}

/// Verify that an opened archive contains the expected mandatory entries and
/// that no entry has a path-traversal / drive-letter name.
pub fn verify_archive<R: Read + Seek>(zip: &mut ZipArchive<R>) -> AppResult<()> {
    let mut has_manifest = false;
    let mut has_documents_dir = false;

    for i in 0..zip.len() {
        let entry = zip.by_index(i)?;
        let name = entry.name().to_string();
        assert_safe_entry_name(&name)?;
        if name == MANIFEST_PATH {
            has_manifest = true;
        }
        if name.starts_with(DOCUMENTS_DIR) {
            has_documents_dir = true;
        }
    }

    if !has_manifest {
        return Err(AppError::InvalidProject("missing manifest.json".into()));
    }
    if !has_documents_dir {
        // A project with zero documents still has the three root folders, so
        // the directory should always be present.
        return Err(AppError::InvalidProject("missing documents/ directory".into()));
    }
    Ok(())
}

fn read_manifest<R: Read + Seek>(zip: &mut ZipArchive<R>) -> AppResult<Manifest> {
    let value = read_json_entry(zip, MANIFEST_PATH)?;
    let manifest: Manifest = serde_json::from_value(value)?;
    if manifest.format_version == 0 {
        return Err(AppError::InvalidProject("manifest has format_version 0".into()));
    }
    Ok(manifest)
}

fn read_json_entry<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> AppResult<serde_json::Value> {
    let mut entry = zip
        .by_name(name)
        .map_err(|e| match e {
            ZipError::FileNotFound => {
                AppError::InvalidProject(format!("missing entry: {name}"))
            }
            other => AppError::from(other),
        })?;
    let mut buf = Vec::with_capacity(entry.size() as usize);
    entry.read_to_end(&mut buf)?;
    Ok(serde_json::from_slice(&buf)?)
}

/// Placeholder migration hook. Currently a no-op since `FORMAT_VERSION == 1`,
/// but the signature is in place so future versions can transform old data.
fn migrate(manifest: &mut Manifest, _documents: &mut HashMap<Uuid, Document>) -> AppResult<()> {
    log::info!(
        "Migrating project {} from format {} to {}",
        manifest.project_id,
        manifest.format_version,
        FORMAT_VERSION
    );
    manifest.format_version = FORMAT_VERSION;
    manifest.app_version = crate::project::manifest::APP_VERSION.to_string();
    manifest.modified_at = Utc::now();
    Ok(())
}

// ---------------------------------------------------------------------------
// Backups
// ---------------------------------------------------------------------------

fn rotate_backups(target: &Path, keep: usize) -> AppResult<()> {
    let parent = match target.parent() {
        Some(p) => p,
        None => return Ok(()),
    };
    let stem = target
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("project");
    let backups_dir = parent.join(format!("{stem}.backups"));
    fs::create_dir_all(&backups_dir)?;

    // Copy the current file into the backups dir with a timestamp.
    let stamp = Utc::now().format("%Y%m%d-%H%M%S");
    let bak = backups_dir.join(format!("{stem}-{stamp}.scri"));
    fs::copy(target, &bak)?;

    // Keep only the `keep` newest.
    let mut entries: Vec<(PathBuf, std::time::SystemTime)> = fs::read_dir(&backups_dir)?
        .filter_map(|e| e.ok())
        .filter_map(|e| {
            let p = e.path();
            let mtime = e.metadata().ok()?.modified().ok()?;
            Some((p, mtime))
        })
        .collect();
    entries.sort_by(|a, b| b.1.cmp(&a.1));
    for (path, _) in entries.into_iter().skip(keep) {
        let _ = fs::remove_file(path);
    }
    Ok(())
}
