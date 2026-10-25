//! Central error type for the ScribeForge backend.
//!
//! `AppError` is serialisable so it can be returned directly from Tauri
//! commands and reach the frontend as a human-readable string without panicking
//! the runtime.

use thiserror::Error;

pub type AppResult<T> = Result<T, AppError>;

#[derive(Debug, Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serde(#[from] serde_json::Error),

    #[error("Archive error: {0}")]
    Zip(#[from] zip::result::ZipError),

    #[error("project not open")]
    NoProjectOpen,

    #[error("template not found: {0}")]
    TemplateNotFound(String),

    #[error("invalid project file: {0}")]
    InvalidProject(String),

    #[error("document not found: {0}")]
    DocumentNotFound(String),

    #[error("operation cancelled")]
    Cancelled,

    #[error("invalid name: {0}")]
    InvalidName(String),

    #[error("path not allowed: {0}")]
    PathNotAllowed(String),

    #[error("{0}")]
    Other(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}

impl From<&str> for AppError {
    fn from(s: &str) -> Self {
        AppError::Other(s.to_string())
    }
}

impl From<String> for AppError {
    fn from(s: String) -> Self {
        AppError::Other(s)
    }
}
