//! Shared application state managed by Tauri.

use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::RwLock;

use crate::errors::{AppError, AppResult};
use crate::project::model::Project;
use crate::settings::Settings;
use crate::storage::write_project_to_path;

/// The currently open project plus its on-disk path.
#[derive(Default)]
pub struct OpenProject {
    pub project: Option<Project>,
    pub path: Option<PathBuf>,
    /// True when in-memory state differs from the last saved container.
    pub dirty: bool,
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
        let settings = Settings::load();
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

    /// Borrow the open project and its path immutably.
    pub fn with_project_and_path<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&Project, &PathBuf) -> AppResult<T>,
    {
        let guard = self.open_project.read();
        let open = guard.project.as_ref();
        let project = open.ok_or(AppError::NoProjectOpen)?;
        let path = guard.path.as_ref().ok_or(AppError::NoProjectOpen)?;
        f(project, path)
    }

    /// Run a mutation on the open project, marking it dirty on success.
    pub fn mutate_project<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Project) -> AppResult<T>,
    {
        let mut guard = self.open_project.write();
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

    /// Save unconditionally.
    pub fn save_now(&self) -> AppResult<()> {
        let (mut project, path) = {
            let guard = self.open_project.read();
            let project = guard.project.as_ref().ok_or(AppError::NoProjectOpen)?;
            let path = guard.path.as_ref().ok_or(AppError::NoProjectOpen)?;
            (project.clone(), path.clone())
        };
        project.manifest.touch();
        write_project_to_path(&project, &path)?;
        self.open_project.write().dirty = false;
        Ok(())
    }
}
