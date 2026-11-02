//! Global application settings and recent-projects history.
//!
//! Stored as JSON under the OS per-app config directory (e.g.
//! `%APPDATA%\com.scribeforge.app\settings.json` on Windows). Distinct from
//! per-project configuration embedded inside `.scri` files.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::errors::{AppError, AppResult};
use crate::format_profiles::FormatSettings;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub editor: EditorSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub saving: SavingSettings,
    #[serde(default)]
    pub composition: CompositionSettings,
    /// Writing format profile and the user's changes to the profiles.
    #[serde(default)]
    pub format: FormatSettings,
    #[serde(default)]
    pub recent_projects: Vec<RecentProject>,
    /// Default location for new projects. Empty string means "use Documents".
    #[serde(default)]
    pub default_project_dir: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            general: GeneralSettings::default(),
            editor: EditorSettings::default(),
            appearance: AppearanceSettings::default(),
            saving: SavingSettings::default(),
            composition: CompositionSettings::default(),
            format: FormatSettings::default(),
            recent_projects: Vec::new(),
            default_project_dir: String::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    /// Interface language: "en" or "es".
    #[serde(default = "default_language")]
    pub language: String,
    #[serde(default = "default_theme")]
    pub theme: String, // "light" | "dark" | "system"
    #[serde(default = "default_true")]
    pub open_last_project_on_start: bool,
    #[serde(default = "default_true")]
    pub confirm_deletions: bool,
    #[serde(default = "default_recent_max")]
    pub recent_max: usize,
}

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            language: default_language(),
            theme: default_theme(),
            open_last_project_on_start: true,
            confirm_deletions: true,
            recent_max: default_recent_max(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditorSettings {
    /// Font, size and line spacing used before format profiles existed. The
    /// editor now takes them from the active profile; they are kept so older
    /// settings files load unchanged.
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: u32,
    #[serde(default = "default_line_height")]
    pub line_height: f32,
    #[serde(default = "default_text_width")]
    pub text_width_px: u32,
    #[serde(default)]
    pub show_ruler: bool,
    /// Keep the line being written centred vertically in the editor.
    #[serde(default)]
    pub typewriter_mode: bool,
    /// What a typed `"` becomes: "angular" (« »), "curly" (“ ”) or "off".
    #[serde(default = "default_smart_quotes")]
    pub smart_quotes: String,
    /// Three dots become an ellipsis (…).
    #[serde(default = "default_true")]
    pub smart_ellipsis: bool,
    /// A hyphen and a space at the start of a paragraph become a dialogue
    /// dash (—).
    #[serde(default = "default_true")]
    pub dialogue_dash: bool,
}

impl Default for EditorSettings {
    fn default() -> Self {
        Self {
            font_family: default_font(),
            font_size: default_font_size(),
            line_height: default_line_height(),
            text_width_px: default_text_width(),
            show_ruler: false,
            typewriter_mode: false,
            smart_quotes: default_smart_quotes(),
            smart_ellipsis: true,
            dialogue_dash: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_true")]
    pub show_toolbar: bool,
    #[serde(default = "default_true")]
    pub show_binder: bool,
    #[serde(default = "default_true")]
    pub show_inspector: bool,
    #[serde(default = "default_density")]
    pub density: String, // "comfortable" | "compact"
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            show_toolbar: true,
            show_binder: true,
            show_inspector: true,
            density: default_density(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavingSettings {
    #[serde(default = "default_true")]
    pub autosave: bool,
    #[serde(default = "default_autosave_interval")]
    pub autosave_interval_secs: u64,
    #[serde(default = "default_backups")]
    pub backup_count: u32,
    #[serde(default = "default_true")]
    pub backup_on_close: bool,
}

impl Default for SavingSettings {
    fn default() -> Self {
        Self {
            autosave: true,
            autosave_interval_secs: 30,
            backup_count: 5,
            backup_on_close: true,
        }
    }
}

/// Composition mode (distraction-free full screen) appearance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompositionSettings {
    /// Backdrop colour behind the page (CSS hex).
    #[serde(default = "default_comp_background")]
    pub background: String,
    /// Page colour (CSS hex).
    #[serde(default = "default_comp_page")]
    pub page_color: String,
    /// Text colour (CSS hex).
    #[serde(default = "default_comp_text")]
    pub text_color: String,
    /// Width of the text column, in CSS px.
    #[serde(default = "default_comp_width")]
    pub page_width_px: u32,
    /// Text size, in CSS px.
    #[serde(default = "default_comp_font_size")]
    pub font_size: u32,
    /// Opacity of the page over the backdrop, 0.0 to 1.0.
    #[serde(default = "default_comp_opacity")]
    pub page_opacity: f32,
}

impl Default for CompositionSettings {
    fn default() -> Self {
        Self {
            background: default_comp_background(),
            page_color: default_comp_page(),
            text_color: default_comp_text(),
            page_width_px: default_comp_width(),
            font_size: default_comp_font_size(),
            page_opacity: default_comp_opacity(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: PathBuf,
    pub name: String,
    pub last_opened: DateTime<Utc>,
}

impl RecentProject {
    pub fn is_available(&self) -> bool {
        self.path.exists()
    }
}

// Default value helpers (used by serde defaults above).
fn default_language() -> String {
    "en".to_string()
}
fn default_theme() -> String {
    "light".to_string()
}
fn default_true() -> bool {
    true
}
fn default_recent_max() -> usize {
    10
}
fn default_font() -> String {
    "Georgia".to_string()
}
fn default_font_size() -> u32 {
    14
}
fn default_line_height() -> f32 {
    1.6
}
fn default_text_width() -> u32 {
    720
}
fn default_smart_quotes() -> String {
    "angular".to_string()
}
fn default_density() -> String {
    "comfortable".to_string()
}
fn default_autosave_interval() -> u64 {
    30
}
fn default_backups() -> u32 {
    5
}
fn default_comp_background() -> String {
    "#2b2620".to_string()
}
fn default_comp_page() -> String {
    "#f7f3ea".to_string()
}
fn default_comp_text() -> String {
    "#2b2620".to_string()
}
fn default_comp_width() -> u32 {
    720
}
fn default_comp_font_size() -> u32 {
    18
}
fn default_comp_opacity() -> f32 {
    1.0
}

fn is_hex_color(s: &str) -> bool {
    let h = s.strip_prefix('#').unwrap_or("");
    matches!(h.len(), 3 | 6) && h.chars().all(|c| c.is_ascii_hexdigit())
}

impl Settings {
    /// Resolve the on-disk settings file path for the current OS.
    pub fn config_file_path() -> AppResult<PathBuf> {
        let dir = dirs::config_dir()
            .ok_or_else(|| AppError::Other("no OS config directory available".into()))?;
        Ok(dir.join("com.scribeforge.app").join("settings.json"))
    }

    pub fn load() -> Self {
        match Self::config_file_path().and_then(|p| Self::load_from(&p)) {
            Ok(s) => s,
            Err(e) => {
                log::warn!("Falling back to default settings: {e}");
                Settings::default()
            }
        }
    }

    pub fn load_from(path: &Path) -> AppResult<Self> {
        let bytes = fs::read(path)?;
        let mut s: Settings = serde_json::from_slice(&bytes)?;
        // Drop recent entries pointing nowhere is the user's choice; we keep
        // them so the UI can flag them as missing. But we cap the list.
        s.general.recent_max = s.general.recent_max.clamp(1, 50);
        if s.recent_projects.len() > s.general.recent_max {
            s.recent_projects.truncate(s.general.recent_max);
        }
        Ok(s)
    }

    pub fn save(&self) -> AppResult<()> {
        let path = Self::config_file_path()?;
        self.save_to(&path)
    }

    pub fn save_to(&self, path: &Path) -> AppResult<()> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let bytes = serde_json::to_vec_pretty(self)?;
        // Safe save: write temp then rename.
        let tmp = path.with_extension("json.tmp");
        fs::write(&tmp, &bytes)?;
        fs::rename(&tmp, path)?;
        Ok(())
    }

    /// Add or refresh a project in the recent list, capped at `recent_max`.
    pub fn record_recent(&mut self, path: PathBuf, name: String) {
        let now = Utc::now();
        if let Some(existing) = self
            .recent_projects
            .iter_mut()
            .find(|r| r.path == path)
        {
            existing.name = name;
            existing.last_opened = now;
            return;
        }
        self.recent_projects.insert(0, RecentProject { path, name, last_opened: now });
        let cap = self.general.recent_max.max(1);
        if self.recent_projects.len() > cap {
            self.recent_projects.truncate(cap);
        }
    }

    /// Clamp user-editable values to safe ranges and replace invalid ones
    /// with defaults. Called before preferences are stored.
    pub fn sanitize(&mut self) {
        let g = &mut self.general;
        if !matches!(g.language.as_str(), "en" | "es") {
            g.language = default_language();
        }
        if !matches!(g.theme.as_str(), "light" | "dark" | "system") {
            g.theme = default_theme();
        }
        g.recent_max = g.recent_max.clamp(1, 50);

        let e = &mut self.editor;
        if e.font_family.trim().is_empty() {
            e.font_family = default_font();
        }
        e.font_family = e.font_family.replace(['"', ';', '{', '}'], "").trim().to_string();
        e.font_size = e.font_size.clamp(8, 48);
        if !e.line_height.is_finite() {
            e.line_height = default_line_height();
        }
        e.line_height = e.line_height.clamp(1.0, 3.0);
        e.text_width_px = e.text_width_px.clamp(400, 1600);
        if !matches!(e.smart_quotes.as_str(), "angular" | "curly" | "off") {
            e.smart_quotes = default_smart_quotes();
        }

        let sv = &mut self.saving;
        sv.autosave_interval_secs = sv.autosave_interval_secs.clamp(5, 3600);
        sv.backup_count = sv.backup_count.clamp(1, 50);

        let c = &mut self.composition;
        if !is_hex_color(&c.background) {
            c.background = default_comp_background();
        }
        if !is_hex_color(&c.page_color) {
            c.page_color = default_comp_page();
        }
        if !is_hex_color(&c.text_color) {
            c.text_color = default_comp_text();
        }
        c.page_width_px = c.page_width_px.clamp(400, 1600);
        c.font_size = c.font_size.clamp(10, 40);
        if !c.page_opacity.is_finite() {
            c.page_opacity = default_comp_opacity();
        }
        c.page_opacity = c.page_opacity.clamp(0.0, 1.0);

        self.format.sanitize();
    }

    pub fn remove_recent(&mut self, path: &Path) {
        self.recent_projects.retain(|r| r.path != path);
    }
}
