//! Shared application state managed by Tauri.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use chrono::{DateTime, Utc};
use parking_lot::RwLock;

use crate::errors::{AppError, AppResult};
use crate::project::model::Project;
use crate::settings::Settings;
use crate::storage::write_project_to_path;
use crate::sync::merge::{self, Fingerprints};
use crate::sync::{self, DiskState, MarkerState, SyncMarker};

/// The currently open project plus its on-disk path.
#[derive(Default)]
pub struct OpenProject {
    pub project: Option<Project>,
    pub path: Option<PathBuf>,
    /// True when in-memory state differs from the last saved container.
    pub dirty: bool,
    /// Opened while another computer had it open; nothing is saved.
    pub read_only: bool,
    /// The file as this computer last read or wrote it. A save is refused
    /// when the file no longer matches (another computer saved it).
    pub disk: Option<DiskState>,
    /// Fingerprints of that same version: the common origin when combining
    /// with a version from another computer.
    pub base: Fingerprints,
    pub last_heartbeat: Option<DateTime<Utc>>,
    /// A version from another computer (or a conflict copy, with its path)
    /// read for the conflict dialog, kept until the user resolves it.
    pub pending_remote: Option<PendingRemote>,
}

pub struct PendingRemote {
    pub project: Project,
    pub copy_path: Option<PathBuf>,
    pub disk: Option<DiskState>,
}

impl OpenProject {
    /// Take a freshly read or written project as the one open here.
    pub fn set_loaded(&mut self, project: Project, path: PathBuf, disk: Option<DiskState>, read_only: bool) {
        self.base = merge::fingerprints(&project);
        self.project = Some(project);
        self.path = Some(path);
        self.dirty = false;
        self.read_only = read_only;
        self.disk = disk;
        self.last_heartbeat = None;
        self.pending_remote = None;
    }
}

/// Global state shared across all Tauri commands.
#[derive(Clone)]
pub struct AppState {
    pub settings: Arc<RwLock<Settings>>,
    pub open_project: Arc<RwLock<OpenProject>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            settings: Arc::new(RwLock::new(Settings::default())),
            open_project: Arc::new(RwLock::new(OpenProject::default())),
        }
    }
}

impl AppState {
    pub fn init() -> AppResult<Self> {
        let mut settings = Settings::load();
        if settings.ensure_device_id() {
            if let Err(e) = settings.save() {
                log::warn!("Could not store the device id: {e}");
            }
        }
        Ok(Self {
            settings: Arc::new(RwLock::new(settings)),
            open_project: Arc::new(RwLock::new(OpenProject::default())),
        })
    }

    /// Borrow the open project mutably; error if none is open.
    pub fn with_project_mut<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Project) -> AppResult<T>,
    {
        let mut guard = self.open_project.write();
        if guard.read_only {
            return Err(AppError::ReadOnly);
        }
        let open = guard.project.as_mut();
        let project = open.ok_or(AppError::NoProjectOpen)?;
        f(project)
    }

    /// Borrow the open project immutably; error if none is open.
    pub fn with_project<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&Project) -> AppResult<T>,
    {
        let guard = self.open_project.read();
        let open = guard.project.as_ref();
        let project = open.ok_or(AppError::NoProjectOpen)?;
        f(project)
    }

    /// Run a mutation on the open project, marking it dirty on success.
    pub fn mutate_project<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Project) -> AppResult<T>,
    {
        let mut guard = self.open_project.write();
        if guard.read_only {
            return Err(AppError::ReadOnly);
        }
        let open = guard.project.as_mut();
        let project = open.ok_or(AppError::NoProjectOpen)?;
        let result = f(project)?;
        guard.dirty = true;
        Ok(result)
    }

    /// Save the project if it has unsaved changes. Returns true if a write
    /// happened.
    pub fn save_if_dirty(&self) -> AppResult<bool> {
        let needs_save = self.open_project.read().dirty;
        if !needs_save {
            return Ok(false);
        }
        self.save_now()?;
        Ok(true)
    }

    /// Save unconditionally. Refused while read-only, and with
    /// `ExternalChange` when another computer saved the file since this one
    /// last read or wrote it.
    pub fn save_now(&self) -> AppResult<()> {
        let (mut project, path, known) = {
            let guard = self.open_project.read();
            if guard.read_only {
                return Err(AppError::ReadOnly);
            }
            let project = guard.project.as_ref().ok_or(AppError::NoProjectOpen)?;
            let path = guard.path.as_ref().ok_or(AppError::NoProjectOpen)?;
            (project.clone(), path.clone(), guard.disk.clone())
        };
        if let Some(known) = &known {
            if sync::changed_on_disk(&path, known)?.is_some() {
                return Err(AppError::ExternalChange);
            }
        }
        project.manifest.touch();
        // The global preferences decide how many backups are kept.
        project.manifest.config.backup_count = self.settings.read().saving.backup_count.max(1);
        write_project_to_path(&project, &path)?;
        let disk = sync::disk_state(&path)?;
        let hash = disk.hash.clone();
        {
            let mut guard = self.open_project.write();
            guard.dirty = false;
            guard.disk = Some(disk);
            guard.base = merge::fingerprints(&project);
        }
        self.write_marker(&path, MarkerState::Open, &hash);
        Ok(())
    }

    /// Tell other computers this one has `path` open (or has closed it) and
    /// which version it last saved. Best effort: a read-only or unwritable
    /// folder must not stop the user from working.
    pub fn write_marker(&self, path: &Path, state: MarkerState, saved_hash: &str) {
        let (device_id, device_name) = {
            let s = self.settings.read();
            (s.sync.device_id, s.sync.device_name.clone())
        };
        let now = Utc::now();
        let marker = SyncMarker { device_id, device_name, state, heartbeat: now, saved_hash: saved_hash.to_string() };
        match sync::write_marker(path, &marker) {
            Ok(()) => self.open_project.write().last_heartbeat = Some(now),
            Err(e) => log::warn!("Could not write the sync marker: {e}"),
        }
    }

    /// Mark the open project as closed on this computer, without saving.
    pub fn release_marker(&self) {
        let (path, read_only, hash) = {
            let guard = self.open_project.read();
            let Some(path) = guard.path.clone() else { return };
            (path, guard.read_only, guard.disk.as_ref().map(|d| d.hash.clone()).unwrap_or_default())
        };
        if !read_only {
            self.write_marker(&path, MarkerState::Closed, &hash);
        }
    }

    /// Save pending changes and mark the open project as closed on this
    /// computer. Used when the project is closed.
    pub fn release_project(&self) -> AppResult<()> {
        if self.open_project.read().read_only {
            return Ok(());
        }
        self.save_if_dirty()?;
        self.release_marker();
        Ok(())
    }

    /// Release the project when the app exits, where nobody can be asked:
    /// if another computer saved it meanwhile, the unsaved changes go to a
    /// copy next to it, which is offered for combining on the next open.
    pub fn release_on_exit(&self) {
        match self.release_project() {
            Ok(()) => {}
            Err(AppError::ExternalChange) => {
                match self.save_conflict_copy() {
                    Ok(copy) => log::warn!("Unsaved changes kept in {}", copy.display()),
                    Err(e) => log::error!("Could not keep the unsaved changes: {e}"),
                }
                self.release_marker();
            }
            Err(e) => log::error!("Could not save the project on exit: {e}"),
        }
    }

    fn save_conflict_copy(&self) -> AppResult<PathBuf> {
        let (project, path) = {
            let guard = self.open_project.read();
            let project = guard.project.clone().ok_or(AppError::NoProjectOpen)?;
            let path = guard.path.clone().ok_or(AppError::NoProjectOpen)?;
            (project, path)
        };
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("project");
        let (device, spanish) = {
            let s = self.settings.read();
            (s.sync.device_name.clone(), s.general.language == "es")
        };
        let label = match (device.is_empty(), spanish) {
            (false, _) => device,
            (true, true) => "sin sincronizar".to_string(),
            (true, false) => "unsynced".to_string(),
        };
        let label: String = label.chars().filter(|c| !r#"/\:*?"<>|"#.contains(*c)).collect();
        let stamp = Utc::now().format("%Y-%m-%d %H%M");
        let copy = path.with_file_name(format!("{stem} ({label} {stamp}).scri"));
        write_project_to_path(&project, &copy)?;
        Ok(copy)
    }
}
