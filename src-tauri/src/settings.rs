//! Global application settings and recent-projects history.
//!
//! Stored as JSON under the OS per-app config directory (e.g.
//! `%APPDATA%\com.scribeforge.app\settings.json` on Windows). Distinct from
//! per-project configuration embedded inside `.scri` files.

use std::fs;
use std::path::{Path, PathBuf};

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use uuid::Uuid;

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
    /// Working on the same project from several computers.
    #[serde(default)]
    pub sync: SyncSettings,
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
            sync: SyncSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    /// Interface language: "en" or "es".
    #[serde(default = "default_language")]
    pub language: String,
    /// "light" | "dark" | "system", or "auto": colours taken from the
    /// wallpaper (see `WallpaperSettings`).
    #[serde(default = "default_theme")]
    pub theme: String,
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
    #[serde(default)]
    pub wallpaper: WallpaperSettings,
}

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            show_toolbar: true,
            show_binder: true,
            show_inspector: true,
            density: default_density(),
            wallpaper: WallpaperSettings::default(),
        }
    }
}

/// Image shown behind the interface, with the panels see-through over it.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WallpaperSettings {
    /// File name inside `Settings::wallpaper_dir()`; empty means no wallpaper.
    #[serde(default)]
    pub file: String,
    /// How much of the image shows through the theme colour, 0.0 to 1.0.
    #[serde(default = "default_wallpaper_visibility")]
    pub visibility: f32,
    /// Opacity of the panels over the image, 0.3 to 1.0.
    #[serde(default = "default_wallpaper_panel_opacity")]
    pub panel_opacity: f32,
    /// Blur applied to the image, in CSS px.
    #[serde(default)]
    pub blur_px: u32,
}

impl Default for WallpaperSettings {
    fn default() -> Self {
        Self {
            file: String::new(),
            visibility: default_wallpaper_visibility(),
            panel_opacity: default_wallpaper_panel_opacity(),
            blur_px: 0,
        }
    }
}

/// A wallpaper file name as stored by `set_wallpaper`: no folders, only
/// `wallpaper-<hex>.<jpg|png|webp>`.
pub fn is_wallpaper_file_name(name: &str) -> bool {
    let Some((stem, ext)) = name.rsplit_once('.') else {
        return false;
    };
    let Some(id) = stem.strip_prefix("wallpaper-") else {
        return false;
    };
    matches!(ext, "jpg" | "png" | "webp") && !id.is_empty() && id.chars().all(|c| c.is_ascii_hexdigit())
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

/// How this computer identifies itself to the others that open the same
/// project from a synced folder (see `sync`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncSettings {
    /// Random id generated on first run; not derived from the hardware or
    /// any account. Never changed by the preferences.
    #[serde(default = "Uuid::nil")]
    pub device_id: Uuid,
    /// Name shown on other computers ("open on Laptop"). Empty shows a
    /// generic "another computer".
    #[serde(default)]
    pub device_name: String,
    #[serde(default = "default_true")]
    pub warn_open_elsewhere: bool,
    /// Reload the project when a newer version arrives and nothing here is
    /// unsaved.
    #[serde(default = "default_true")]
    pub auto_reload: bool,
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            device_id: Uuid::nil(),
            device_name: String::new(),
            warn_open_elsewhere: true,
            auto_reload: true,
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
    /// The same project can live at a different path on each computer, or
    /// move; the id keeps one entry per project.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project_id: Option<Uuid>,
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
fn default_wallpaper_visibility() -> f32 {
    0.8
}
fn default_wallpaper_panel_opacity() -> f32 {
    0.82
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

    /// Folder holding the wallpaper image, next to the settings file.
    pub fn wallpaper_dir() -> AppResult<PathBuf> {
        let file = Self::config_file_path()?;
        let dir = file.parent().ok_or_else(|| AppError::Other("no settings folder".into()))?;
        Ok(dir.join("wallpapers"))
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
    /// An entry for the same project at another path is moved to `path`.
    pub fn record_recent(&mut self, path: PathBuf, name: String, project_id: Option<Uuid>) {
        let now = Utc::now();
        self.recent_projects.retain(|r| {
            r.path == path || project_id.is_none() || r.project_id != project_id
        });
        if let Some(existing) = self
            .recent_projects
            .iter_mut()
            .find(|r| r.path == path)
        {
            existing.name = name;
            existing.project_id = project_id;
            existing.last_opened = now;
            return;
        }
        self.recent_projects.insert(0, RecentProject { path, project_id, name, last_opened: now });
        let cap = self.general.recent_max.max(1);
        if self.recent_projects.len() > cap {
            self.recent_projects.truncate(cap);
        }
    }

    /// Give this computer its random sync id the first time. Returns true
    /// when the settings changed and should be saved.
    pub fn ensure_device_id(&mut self) -> bool {
        if !self.sync.device_id.is_nil() {
            return false;
        }
        self.sync.device_id = Uuid::new_v4();
        true
    }

    /// Clamp user-editable values to safe ranges and replace invalid ones
    /// with defaults. Called before preferences are stored.
    pub fn sanitize(&mut self) {
        let g = &mut self.general;
        if !matches!(g.language.as_str(), "en" | "es") {
            g.language = default_language();
        }
        if !matches!(g.theme.as_str(), "light" | "dark" | "system" | "auto") {
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

        if !self.default_project_dir.is_empty() && !Path::new(&self.default_project_dir).is_absolute() {
            self.default_project_dir.clear();
        }
        let y = &mut self.sync;
        y.device_name = y.device_name.trim().chars().filter(|c| !c.is_control()).take(60).collect();

        let sv = &mut self.saving;
        sv.autosave_interval_secs = sv.autosave_interval_secs.clamp(5, 3600);
        sv.backup_count = sv.backup_count.clamp(1, 50);

        let w = &mut self.appearance.wallpaper;
        if !w.file.is_empty() && !is_wallpaper_file_name(&w.file) {
            w.file.clear();
        }
        if !w.visibility.is_finite() {
            w.visibility = default_wallpaper_visibility();
        }
        w.visibility = w.visibility.clamp(0.0, 1.0);
        if !w.panel_opacity.is_finite() {
            w.panel_opacity = default_wallpaper_panel_opacity();
        }
        w.panel_opacity = w.panel_opacity.clamp(0.3, 1.0);
        w.blur_px = w.blur_px.min(40);

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
