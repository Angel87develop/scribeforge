//! Path utilities for the `.scri` format.

use std::path::{Path, PathBuf};

use crate::errors::{AppError, AppResult};

/// Force a path to end with the `.scri` extension, preserving the user's
/// chosen file name stem.
pub fn ensure_scri_extension(path: &Path) -> PathBuf {
    let mut buf = path.to_path_buf();
    if buf.extension().and_then(|e| e.to_str()) != Some("scri") {
        buf.set_extension("scri");
    }
    buf
}

/// Reject path-traversal and absolute paths inside an extracted archive. Any
/// entry whose normalised name starts with `/`, `\\`, `..`, or a Windows drive
/// letter is refused.
pub fn assert_safe_entry_name(name: &str) -> AppResult<()> {
    if name.is_empty() {
        return Err(AppError::InvalidProject("empty archive entry name".into()));
    }
    let normalised = name.replace('\\', "/");
    if normalised.starts_with('/') {
        return Err(AppError::PathNotAllowed(format!("absolute entry: {name}")));
    }
    if normalised.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && normalised.as_bytes().get(1) == Some(&b':')
    {
        return Err(AppError::PathNotAllowed(format!("drive-letter entry: {name}")));
    }
    for component in normalised.split('/') {
        if component == ".." {
            return Err(AppError::PathNotAllowed(format!("traversal entry: {name}")));
        }
    }
    Ok(())
}
