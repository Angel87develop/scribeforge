//! Writing format profiles: named sets of typographic settings for novels,
//! in the spirit of Scrivener's formatting presets.
//!
//! A profile has two halves that are kept apart on purpose:
//! - the editor format (font, size, alignment, line spacing, indents and
//!   paragraph spacing), which changes how text looks while writing; and
//! - `ExportFormat` (page size, margins, chapter starts, scene separators,
//!   chapter title size, page numbers, running header), which only feeds the
//!   compile step through the "writing_format" compile preset.
//!
//! The eight built-in profiles are defined here and never written to disk.
//! Their names and descriptions are in English; the interface translates
//! them like any other text.
//! What the user changes is stored per profile in `FormatSettings::custom`,
//! so editing one profile never touches another, and restoring a profile
//! simply drops its entry.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::compile::CompileSettings;

/// Profile used on first start and when the stored id is unknown.
pub const DEFAULT_PROFILE: &str = "classic";

/// Compile preset id whose settings come from the active profile.
pub const COMPILE_PRESET_ID: &str = "writing_format";

/// One profile's values. All fields have defaults (the classic novel), so a
/// partial JSON object is accepted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct FormatProfile {
    /// Body font. The editor falls back to similar fonts when it is missing.
    pub font_family: String,
    /// Body size, in points.
    pub font_size_pt: f32,
    /// "left" or "justify".
    pub alignment: String,
    /// Line spacing as a word-processor multiple (1.0 single, 2.0 double).
    pub line_height: f32,
    /// First-line indent of body paragraphs, in centimetres.
    pub first_line_indent_cm: f32,
    /// Space before each paragraph, in points.
    pub space_before_pt: f32,
    /// Space after each paragraph, in points.
    pub space_after_pt: f32,
    /// The paragraph after a heading or scene break is not indented.
    pub no_indent_after_heading: bool,
    /// Values that only affect the exported book.
    pub export: ExportFormat,
}

/// The part of a profile used only when compiling paged or ebook output.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct ExportFormat {
    /// "a4", "a5" or "letter".
    pub page_size: String,
    /// Top, outer and bottom margins, in centimetres.
    pub margin_cm: f32,
    /// Inner (binding) margin, in centimetres.
    pub inner_margin_cm: f32,
    /// "new_page" or "continuous" (title followed by the text).
    pub chapter_start: String,
    /// Text between scenes. Empty means a blank line.
    pub scene_separator: String,
    /// Chapter title size, in points. 0 derives it from the body size.
    pub chapter_title_size_pt: f32,
    /// Page numbers on PDF and DOCX.
    pub page_numbers: bool,
    /// Running header on PDF and DOCX. Empty means none.
    pub header_text: String,
}

impl Default for FormatProfile {
    fn default() -> Self {
        classic()
    }
}

impl Default for ExportFormat {
    fn default() -> Self {
        classic().export
    }
}

// ---------------------------------------------------------------------------
// Built-in profiles
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize)]
pub struct BuiltinProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub profile: FormatProfile,
}

#[allow(clippy::too_many_arguments)]
fn profile(
    font: &str,
    size: f32,
    alignment: &str,
    line_height: f32,
    indent_cm: f32,
    after_pt: f32,
    export: ExportFormat,
) -> FormatProfile {
    FormatProfile {
        font_family: font.into(),
        font_size_pt: size,
        alignment: alignment.into(),
        line_height,
        first_line_indent_cm: indent_cm,
        space_before_pt: 0.0,
        space_after_pt: after_pt,
        no_indent_after_heading: true,
        export,
    }
}

fn export(page_size: &str, margin_cm: f32, chapter_start: &str, separator: &str) -> ExportFormat {
    ExportFormat {
        page_size: page_size.into(),
        margin_cm,
        inner_margin_cm: margin_cm,
        chapter_start: chapter_start.into(),
        scene_separator: separator.into(),
        chapter_title_size_pt: 0.0,
        page_numbers: true,
        header_text: String::new(),
    }
}

fn classic() -> FormatProfile {
    profile("Palatino Linotype", 12.0, "justify", 1.2, 1.27, 0.0, export("a4", 2.5, "new_page", "* * *"))
}

pub fn builtin_profiles() -> Vec<BuiltinProfile> {
    let entry = |id: &str, name: &str, description: &str, profile: FormatProfile| BuiltinProfile {
        id: id.into(),
        name: name.into(),
        description: description.into(),
        profile,
    };
    vec![
        entry(
            "classic",
            "Classic Novel",
            "For traditional novels, fantasy, adventure and drama. Justified Palatino with a generous indent.",
            classic(),
        ),
        entry(
            "modern",
            "Modern Novel",
            "For contemporary commercial fiction. Compact, justified Georgia with a short indent.",
            profile("Georgia", 11.0, "justify", 1.15, 0.7, 0.0, export("a4", 2.0, "new_page", "* * *")),
        ),
        entry(
            "light_novel",
            "Japanese Light Novel",
            "For anime-style stories, isekai, young-adult fantasy, romance and adventure. Airy line spacing and scenes separated by a blank line.",
            profile("Georgia", 11.5, "justify", 1.3, 0.8, 0.0, export("a4", 2.0, "new_page", "")),
        ),
        entry(
            "web",
            "Web Novel",
            "For online platforms and reading on a phone. Left-aligned, no indent and space between paragraphs.",
            {
                let mut e = export("a4", 2.0, "continuous", "");
                e.page_numbers = false;
                profile("Georgia", 12.0, "left", 1.3, 0.0, 6.0, e)
            },
        ),
        entry(
            "manuscript",
            "Professional Manuscript",
            "For submissions to publishers and writing contests. Double-spaced Times New Roman with one-inch margins.",
            profile("Times New Roman", 12.0, "left", 2.0, 1.27, 0.0, export("a4", 2.54, "new_page", "#")),
        ),
        entry(
            "epic_fantasy",
            "Epic Fantasy",
            "For long sagas and invented worlds. Justified Palatino, large chapter titles and an ornamental separator.",
            {
                let mut e = export("a4", 2.5, "new_page", "* * *");
                e.chapter_title_size_pt = 18.0;
                profile("Palatino Linotype", 12.0, "justify", 1.25, 1.0, 0.0, e)
            },
        ),
        entry(
            "pocket",
            "Pocket Novel",
            "For a compact A5 print edition. Small Garamond, with margins you can adjust for the binding.",
            profile("Garamond", 10.5, "justify", 1.1, 0.5, 0.0, export("a5", 1.8, "new_page", "* * *")),
        ),
        entry(
            "cinematic",
            "Cinematic Novel",
            "For action, suspense and science fiction. Left-aligned, brisk paragraphs with a little space between them.",
            profile("Georgia", 11.5, "left", 1.25, 0.5, 2.0, export("a4", 2.5, "new_page", "")),
        ),
    ]
}

/// The original values of a built-in profile.
pub fn builtin(id: &str) -> Option<FormatProfile> {
    builtin_profiles().into_iter().find(|p| p.id == id).map(|p| p.profile)
}

pub fn builtin_name(id: &str) -> Option<String> {
    builtin_profiles().into_iter().find(|p| p.id == id).map(|p| p.name)
}

// ---------------------------------------------------------------------------
// Validation and conversion
// ---------------------------------------------------------------------------

fn clamp(v: f32, lo: f32, hi: f32, default: f32) -> f32 {
    if v.is_finite() {
        v.clamp(lo, hi)
    } else {
        default
    }
}

/// One line of text, without characters that could break CSS or XML.
fn one_line(s: &str, max: usize) -> String {
    s.replace(['\r', '\n', '\t'], " ").trim().chars().take(max).collect()
}

impl FormatProfile {
    /// Clamp every value to a range the editor and the writers can handle,
    /// replacing invalid choices with the classic profile's.
    pub fn sanitize(&mut self) {
        let d = classic();
        self.font_family = one_line(&self.font_family.replace(['"', '\'', ';', '{', '}', '<', '>'], ""), 80);
        if self.font_family.is_empty() {
            self.font_family = d.font_family.clone();
        }
        self.font_size_pt = clamp(self.font_size_pt, 6.0, 48.0, d.font_size_pt);
        if !matches!(self.alignment.as_str(), "left" | "justify") {
            self.alignment = "left".into();
        }
        self.line_height = clamp(self.line_height, 0.8, 3.0, d.line_height);
        self.first_line_indent_cm = clamp(self.first_line_indent_cm, 0.0, 5.0, 0.0);
        self.space_before_pt = clamp(self.space_before_pt, 0.0, 72.0, 0.0);
        self.space_after_pt = clamp(self.space_after_pt, 0.0, 72.0, 0.0);

        let e = &mut self.export;
        if !matches!(e.page_size.as_str(), "a4" | "a5" | "letter") {
            e.page_size = d.export.page_size.clone();
        }
        // The compile writers accept 0.25 to 3 inches.
        e.margin_cm = clamp(e.margin_cm, 0.7, 7.5, d.export.margin_cm);
        e.inner_margin_cm = clamp(e.inner_margin_cm, 0.7, 7.5, e.margin_cm);
        if !matches!(e.chapter_start.as_str(), "new_page" | "continuous") {
            e.chapter_start = "new_page".into();
        }
        e.scene_separator = one_line(&e.scene_separator, 40);
        e.chapter_title_size_pt = if e.chapter_title_size_pt.is_finite() && e.chapter_title_size_pt >= 6.0 {
            e.chapter_title_size_pt.min(72.0)
        } else {
            0.0
        };
        e.header_text = one_line(&e.header_text, 200);
    }

    /// Compile settings carrying this profile's values. Titles, title page
    /// and inline formatting follow the usual novel conventions.
    pub fn compile_settings(&self, language: &str) -> CompileSettings {
        let e = &self.export;
        let inches = |cm: f32| cm / 2.54;
        CompileSettings {
            preset: COMPILE_PRESET_ID.into(),
            font_family: self.font_family.clone(),
            font_size: self.font_size_pt,
            line_spacing: self.line_height,
            first_line_indent: inches(self.first_line_indent_cm),
            paragraph_spacing: self.space_after_pt,
            paragraph_spacing_before: self.space_before_pt,
            alignment: self.alignment.clone(),
            folder_titles: true,
            document_titles: false,
            uppercase_titles: false,
            chapter_title_size: e.chapter_title_size_pt,
            separator: e.scene_separator.clone(),
            page_break_before_chapters: e.chapter_start == "new_page",
            title_page: true,
            keep_formatting: true,
            page_size: e.page_size.clone(),
            margin: inches(e.margin_cm),
            margin_left: inches(e.inner_margin_cm),
            page_numbers: e.page_numbers,
            header_text: e.header_text.clone(),
            language: language.into(),
        }
        .sanitized()
    }
}

/// The selected profile plus the user's changes to any profile.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(default)]
pub struct FormatSettings {
    /// Id of the built-in profile in use.
    pub active_profile: String,
    /// Customised profiles by id. Profiles without changes are absent.
    pub custom: BTreeMap<String, FormatProfile>,
}

impl Default for FormatSettings {
    fn default() -> Self {
        Self { active_profile: DEFAULT_PROFILE.into(), custom: BTreeMap::new() }
    }
}

impl FormatSettings {
    /// A profile with the user's changes, if it exists.
    pub fn profile(&self, id: &str) -> Option<FormatProfile> {
        self.custom.get(id).cloned().or_else(|| builtin(id))
    }

    /// The active profile with the user's changes.
    pub fn active(&self) -> FormatProfile {
        self.profile(&self.active_profile).unwrap_or_default()
    }

    /// Reset an unknown active id, drop changes to unknown profiles, clamp
    /// the rest and forget changes that match the original values.
    pub fn sanitize(&mut self) {
        if builtin(&self.active_profile).is_none() {
            self.active_profile = DEFAULT_PROFILE.into();
        }
        let custom = std::mem::take(&mut self.custom);
        for (id, mut p) in custom {
            let Some(original) = builtin(&id) else { continue };
            p.sanitize();
            if p != original {
                self.custom.insert(id, p);
            }
        }
    }
}
