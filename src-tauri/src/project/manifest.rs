//! Project manifest: the authoritative metadata record stored at the root of
//! every `.scri` container.

use chrono::{DateTime, NaiveDate, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// Version of the `.scri` container format produced and understood by this
/// build of ScribeForge. Increment on incompatible structural changes; old
/// versions are migrated by the storage layer before use.
pub const FORMAT_VERSION: u32 = 1;

pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Manifest {
    /// Stable, unique identifier for the project. Generated once at creation
    /// time and never changed afterwards — it travels with the file.
    pub project_id: Uuid,

    /// Human-readable project name shown in the binder title and window.
    pub name: String,

    /// Optional author attribution stored at the project level.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,

    /// Container format version this file was written with.
    pub format_version: u32,

    /// ScribeForge application version that produced the file.
    pub app_version: String,

    pub created_at: DateTime<Utc>,
    pub modified_at: DateTime<Utc>,

    /// Identifier of the template the project was created from.
    #[serde(default)]
    pub template_id: String,

    /// Category of the originating template, retained for statistics and UI.
    #[serde(default)]
    pub template_category: String,

    /// Project-scoped configuration. Separate from global app preferences.
    #[serde(default)]
    pub config: ProjectConfig,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectConfig {
    #[serde(default = "default_true")]
    pub autosave: bool,
    #[serde(default = "default_autosave_interval")]
    pub autosave_interval_secs: u64,
    #[serde(default)]
    pub session_word_goal: u32,
    #[serde(default)]
    pub project_word_goal: u32,
    #[serde(default = "default_backups")]
    pub backup_count: u32,
    /// Date by which the manuscript should reach `project_word_goal`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<NaiveDate>,
    /// Spell-check languages: "es", "en", "es,en" or "off".
    #[serde(default = "default_spell_language")]
    pub spell_language: String,
    /// The labels offered for documents, each with its colour.
    #[serde(default = "default_labels")]
    pub labels: Vec<ColorDef>,
    /// The statuses offered for documents, in workflow order, with colours.
    #[serde(default = "default_statuses")]
    pub statuses: Vec<ColorDef>,
}

/// A named colour: a label or a status.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColorDef {
    pub name: String,
    /// CSS hex colour, `#rrggbb`.
    pub color: String,
}

impl ColorDef {
    fn new(name: &str, color: &str) -> Self {
        Self { name: name.to_string(), color: color.to_string() }
    }
}

pub fn default_labels() -> Vec<ColorDef> {
    vec![
        ColorDef::new("Concept", "#8e6fbf"),
        ColorDef::new("Chapter", "#c7773b"),
        ColorDef::new("Scene", "#3f8f6b"),
        ColorDef::new("Idea", "#d0a62a"),
        ColorDef::new("Character", "#c2475a"),
        ColorDef::new("Location", "#3c7cc0"),
    ]
}

pub fn default_statuses() -> Vec<ColorDef> {
    vec![
        ColorDef::new("To Do", "#9a948a"),
        ColorDef::new("First Draft", "#d08a3c"),
        ColorDef::new("Revised", "#4f8fc0"),
        ColorDef::new("Final Draft", "#7a5fb0"),
        ColorDef::new("Done", "#4a8a4a"),
    ]
}

impl Default for ProjectConfig {
    fn default() -> Self {
        Self {
            autosave: true,
            autosave_interval_secs: 30,
            session_word_goal: 0,
            project_word_goal: 0,
            backup_count: 5,
            deadline: None,
            spell_language: default_spell_language(),
            labels: default_labels(),
            statuses: default_statuses(),
        }
    }
}

fn default_true() -> bool {
    true
}
fn default_autosave_interval() -> u64 {
    30
}
fn default_backups() -> u32 {
    5
}
fn default_spell_language() -> String {
    "es".to_string()
}

impl Manifest {
    /// Create a fresh manifest for a newly instantiated project.
    pub fn new(name: String, author: Option<String>, template_id: String, template_category: String) -> Self {
        let now = Utc::now();
        Self {
            project_id: Uuid::new_v4(),
            name,
            author,
            format_version: FORMAT_VERSION,
            app_version: APP_VERSION.to_string(),
            created_at: now,
            modified_at: now,
            template_id,
            template_category,
            config: ProjectConfig::default(),
        }
    }

    /// Bump the modification timestamp to "now".
    pub fn touch(&mut self) {
        self.modified_at = Utc::now();
    }
}
