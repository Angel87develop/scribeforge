//! Working on a project kept in a folder that a cloud client (OneDrive,
//! Google Drive, Dropbox, iCloud) synchronises between computers.
//!
//! ScribeForge never talks to the cloud service or to the user's account: it
//! only reads and writes files in the folder the user picked, and the cloud
//! client copies them. On top of that it adds:
//! - a small marker next to the project, `.<name>.scri.sync`, saying which
//!   computer has it open, when that computer was last seen, and the hash of
//!   the last version it saved. It holds a random device id and the name the
//!   user gave this computer — nothing else;
//! - a check before every save that the file on disk is still the one this
//!   computer last read or wrote, so a version that arrived from another
//!   computer is never overwritten blindly (see `merge` for combining them);
//! - detection of the copies a cloud client makes when two computers changed
//!   the same file ("MyNovel (conflicted copy).scri", "MyNovel-PC.scri").

pub mod merge;

use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::errors::{AppError, AppResult};

/// How often an open project tells other computers it is still open.
pub const HEARTBEAT_SECS: i64 = 60;
/// After this long without a heartbeat the other computer is assumed gone
/// (closed abruptly, out of battery…).
pub const STALE_SECS: i64 = 180;

// ---------------------------------------------------------------------------
// Marker file
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MarkerState {
    Open,
    Closed,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMarker {
    pub device_id: Uuid,
    #[serde(default)]
    pub device_name: String,
    pub state: MarkerState,
    pub heartbeat: DateTime<Utc>,
    /// SHA-256 of the last version this computer saved; empty if unknown.
    #[serde(default)]
    pub saved_hash: String,
}

impl SyncMarker {
    pub fn is_fresh(&self) -> bool {
        Utc::now() - self.heartbeat < Duration::seconds(STALE_SECS)
    }
}

pub fn marker_path(project: &Path) -> PathBuf {
    let name = project.file_name().and_then(|s| s.to_str()).unwrap_or("project.scri");
    project.with_file_name(format!(".{name}.sync"))
}

/// The marker, if there is a readable one.
pub fn read_marker(project: &Path) -> Option<SyncMarker> {
    let bytes = fs::read(marker_path(project)).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub fn write_marker(project: &Path, marker: &SyncMarker) -> AppResult<()> {
    fs::write(marker_path(project), serde_json::to_vec_pretty(marker)?)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// What is on disk
// ---------------------------------------------------------------------------

/// The project file as this computer last read or wrote it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DiskState {
    pub len: u64,
    pub modified: Option<SystemTime>,
    pub hash: String,
}

pub fn hash_file(path: &Path) -> AppResult<String> {
    let mut reader = BufReader::new(File::open(path)?);
    let mut hasher = Sha256::new();
    let mut buf = [0u8; 64 * 1024];
    loop {
        let n = reader.read(&mut buf)?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
    }
    Ok(hex::encode(hasher.finalize()))
}

pub fn disk_state(path: &Path) -> AppResult<DiskState> {
    let meta = fs::metadata(path)?;
    Ok(DiskState { len: meta.len(), modified: meta.modified().ok(), hash: hash_file(path)? })
}

/// The new state of the file when its content differs from `known`. Only
/// hashes the file when its size or modification time moved. A missing file
/// counts as unchanged: the next save simply writes it again.
pub fn changed_on_disk(path: &Path, known: &DiskState) -> AppResult<Option<DiskState>> {
    let Ok(meta) = fs::metadata(path) else {
        return Ok(None);
    };
    if meta.len() == known.len && meta.modified().ok() == known.modified {
        return Ok(None);
    }
    let now = disk_state(path)?;
    Ok((now.hash != known.hash).then_some(now))
}

// ---------------------------------------------------------------------------
// Before opening
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "status", rename_all = "snake_case")]
pub enum OpenCheck {
    Ok,
    /// Another computer has the project open and was seen recently.
    OpenElsewhere { device_name: String, last_seen: DateTime<Utc> },
    /// Another computer saved a version that has not arrived here yet.
    Syncing { device_name: String, saved_at: DateTime<Utc> },
}

pub fn check_open(path: &Path, device_id: Uuid, warn_open_elsewhere: bool) -> AppResult<OpenCheck> {
    let Some(m) = read_marker(path) else {
        return Ok(OpenCheck::Ok);
    };
    if m.device_id == device_id {
        return Ok(OpenCheck::Ok);
    }
    if m.state == MarkerState::Open && m.is_fresh() {
        return Ok(if warn_open_elsewhere {
            OpenCheck::OpenElsewhere { device_name: m.device_name, last_seen: m.heartbeat }
        } else {
            OpenCheck::Ok
        });
    }
    if !m.saved_hash.is_empty() && hash_file(path)? != m.saved_hash {
        return Ok(OpenCheck::Syncing { device_name: m.device_name, saved_at: m.heartbeat });
    }
    Ok(OpenCheck::Ok)
}

// ---------------------------------------------------------------------------
// Cloud folders
// ---------------------------------------------------------------------------

/// The cloud client whose folder holds `path`, judged from the path alone:
/// "onedrive", "google_drive", "dropbox" or "icloud".
pub fn cloud_provider(path: &Path) -> Option<&'static str> {
    for var in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
        if let Some(root) = std::env::var_os(var) {
            if !root.is_empty() && path.starts_with(&root) {
                return Some("onedrive");
            }
        }
    }
    for component in path.components() {
        let name = component.as_os_str().to_string_lossy().to_lowercase();
        if name.starts_with("onedrive") {
            return Some("onedrive");
        }
        if name.starts_with("googledrive-")
            || matches!(
                name.as_str(),
                "google drive" | "my drive" | "mi unidad" | "shared drives" | "unidades compartidas"
            )
        {
            return Some("google_drive");
        }
        if name == "dropbox" || name.starts_with("dropbox (") {
            return Some("dropbox");
        }
        if matches!(name.as_str(), "icloud drive" | "iclouddrive" | "mobile documents") {
            return Some("icloud");
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Conflict copies
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct ConflictCopy {
    pub path: String,
    pub file_name: String,
    pub modified_at: Option<DateTime<Utc>>,
}

/// Other `.scri` files next to `path` that belong to the same project.
///
/// Cloud clients name their copies after the original ("MyNovel (conflicted
/// copy …)", "MyNovel-LAPTOP", "MyNovel (1)"), so only files starting with
/// the project's file name are opened — opening every file in a streamed
/// Google Drive folder would download them all.
pub fn find_conflict_copies(path: &Path, project_id: Uuid) -> Vec<ConflictCopy> {
    let (Some(dir), Some(stem)) = (path.parent(), path.file_stem().and_then(|s| s.to_str())) else {
        return Vec::new();
    };
    let stem = stem.to_lowercase();
    // Compared without case: Windows paths may differ only in case.
    let own_name = path.file_name().map(|n| n.to_string_lossy().to_lowercase());
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut copies: Vec<ConflictCopy> = entries
        .filter_map(|e| e.ok())
        .take(500)
        .map(|e| e.path())
        .filter(|p| p.file_name().map(|n| n.to_string_lossy().to_lowercase()) != own_name)
        .filter(|p| p.extension().and_then(|e| e.to_str()) == Some("scri"))
        .filter(|p| {
            p.file_stem()
                .and_then(|s| s.to_str())
                .is_some_and(|s| s.to_lowercase().starts_with(&stem))
        })
        .filter(|p| crate::storage::archive::read_project_id(p).ok() == Some(project_id))
        .map(|p| ConflictCopy {
            file_name: p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
            modified_at: fs::metadata(&p).and_then(|m| m.modified()).ok().map(DateTime::<Utc>::from),
            path: p.to_string_lossy().to_string(),
        })
        .collect();
    copies.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));
    copies
}

// ---------------------------------------------------------------------------
// Local backups
// ---------------------------------------------------------------------------

/// Backups live on this computer, outside the synced folder, so the cloud
/// does not carry several full copies of every project.
pub fn local_backups_dir(project_id: Uuid) -> AppResult<PathBuf> {
    let base = dirs::data_local_dir()
        .ok_or_else(|| AppError::Other("no local data directory available".into()))?;
    Ok(base.join("com.scribeforge.app").join("backups").join(project_id.to_string()))
}

#[derive(Debug, Clone, Serialize)]
pub struct BackupDto {
    pub path: String,
    pub file_name: String,
    pub created_at: Option<DateTime<Utc>>,
    pub size: u64,
}

/// Backups of a project, newest first.
pub fn list_backups(project_id: Uuid) -> AppResult<Vec<BackupDto>> {
    let dir = local_backups_dir(project_id)?;
    let Ok(entries) = fs::read_dir(&dir) else {
        return Ok(Vec::new());
    };
    let mut out: Vec<BackupDto> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.path().extension().and_then(|x| x.to_str()) == Some("scri"))
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            Some(BackupDto {
                path: e.path().to_string_lossy().to_string(),
                file_name: e.file_name().to_string_lossy().to_string(),
                created_at: meta.modified().ok().map(DateTime::<Utc>::from),
                size: meta.len(),
            })
        })
        .collect();
    out.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_cloud_folders() {
        assert_eq!(cloud_provider(Path::new("G:/Mi unidad/Novelas/a.scri")), Some("google_drive"));
        assert_eq!(
            cloud_provider(Path::new("/Users/x/Library/CloudStorage/GoogleDrive-x@y.com/My Drive/a.scri")),
            Some("google_drive")
        );
        assert_eq!(cloud_provider(Path::new("C:/Users/x/OneDrive - Acme/a.scri")), Some("onedrive"));
        assert_eq!(cloud_provider(Path::new("C:/Users/x/Dropbox/a.scri")), Some("dropbox"));
        assert_eq!(cloud_provider(Path::new("D:/Proyectos/a.scri")), None);
    }

    #[test]
    fn notices_a_file_saved_elsewhere() {
        let dir = std::env::temp_dir().join(format!("sf-sync-{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let file = dir.join("Novel.scri");
        fs::write(&file, b"first").unwrap();
        let known = disk_state(&file).unwrap();
        assert!(changed_on_disk(&file, &known).unwrap().is_none());

        fs::write(&file, b"second, from the laptop").unwrap();
        assert!(changed_on_disk(&file, &known).unwrap().is_some());

        // Another computer's marker that says it saved what is on disk.
        let own = Uuid::new_v4();
        let other = SyncMarker {
            device_id: Uuid::new_v4(),
            device_name: "Laptop".into(),
            state: MarkerState::Closed,
            heartbeat: Utc::now(),
            saved_hash: hash_file(&file).unwrap(),
        };
        write_marker(&file, &other).unwrap();
        assert!(matches!(check_open(&file, own, true).unwrap(), OpenCheck::Ok));

        // It saved a version that has not arrived yet.
        write_marker(&file, &SyncMarker { saved_hash: "something else".into(), ..other.clone() }).unwrap();
        assert!(matches!(check_open(&file, own, true).unwrap(), OpenCheck::Syncing { .. }));

        // Still open there.
        write_marker(&file, &SyncMarker { state: MarkerState::Open, ..other.clone() }).unwrap();
        assert!(matches!(check_open(&file, own, true).unwrap(), OpenCheck::OpenElsewhere { .. }));
        assert!(matches!(check_open(&file, own, false).unwrap(), OpenCheck::Ok));

        // Open there but silent for too long: assumed gone.
        let stale = Utc::now() - Duration::seconds(STALE_SECS + 5);
        write_marker(&file, &SyncMarker { state: MarkerState::Open, heartbeat: stale, ..other }).unwrap();
        assert!(matches!(check_open(&file, own, true).unwrap(), OpenCheck::Ok));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn marker_sits_next_to_the_project() {
        let p = marker_path(Path::new("/x/My Novel.scri"));
        assert_eq!(p, Path::new("/x/.My Novel.scri.sync"));
    }
}
