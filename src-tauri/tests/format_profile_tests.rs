//! Tests for writing format profiles: the eight built-in profiles, keeping
//! the user's changes apart from them, validation, persistence in the
//! settings file, and the compile settings a profile produces (justified
//! text, A5 pages, chapter title size, running header).

use std::io::{Cursor, Read};

use scribeforge_lib::compile::{compile, CompileFormat, CompileRequest, CompileSettings};
use scribeforge_lib::format_profiles::{
    builtin, builtin_profiles, FormatProfile, FormatSettings, COMPILE_PRESET_ID, DEFAULT_PROFILE,
};
use scribeforge_lib::project::document::{DocumentKind, RichDoc};
use scribeforge_lib::project::model::Project;
use scribeforge_lib::settings::Settings;
use scribeforge_lib::templates::build_project_from_template;

fn approx(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-3
}

#[test]
fn eight_builtin_profiles_with_their_values() {
    // id, font, size, alignment, line height, indent cm, after pt
    let expected = [
        ("classic", "Palatino Linotype", 12.0, "justify", 1.2, 1.27, 0.0),
        ("modern", "Georgia", 11.0, "justify", 1.15, 0.7, 0.0),
        ("light_novel", "Georgia", 11.5, "justify", 1.3, 0.8, 0.0),
        ("web", "Georgia", 12.0, "left", 1.3, 0.0, 6.0),
        ("manuscript", "Times New Roman", 12.0, "left", 2.0, 1.27, 0.0),
        ("epic_fantasy", "Palatino Linotype", 12.0, "justify", 1.25, 1.0, 0.0),
        ("pocket", "Garamond", 10.5, "justify", 1.1, 0.5, 0.0),
        ("cinematic", "Georgia", 11.5, "left", 1.25, 0.5, 2.0),
    ];
    let list = builtin_profiles();
    assert_eq!(list.len(), 8);
    for (b, (id, font, size, align, line, indent, after)) in list.iter().zip(expected) {
        let p = &b.profile;
        assert_eq!(b.id, id);
        assert!(!b.name.is_empty() && !b.description.is_empty());
        assert_eq!(p.font_family, font, "{id}");
        assert!(approx(p.font_size_pt, size), "{id}");
        assert_eq!(p.alignment, align, "{id}");
        assert!(approx(p.line_height, line), "{id}");
        assert!(approx(p.first_line_indent_cm, indent), "{id}");
        assert!(approx(p.space_before_pt, 0.0), "{id}");
        assert!(approx(p.space_after_pt, after), "{id}");
        assert!(p.no_indent_after_heading, "{id}");
    }

    let margin = |id: &str| builtin(id).unwrap().export.margin_cm;
    assert!(approx(margin("classic"), 2.5));
    assert!(approx(margin("modern"), 2.0));
    assert!(approx(margin("manuscript"), 2.54));
    assert!(approx(margin("pocket"), 1.8));
    assert_eq!(builtin("pocket").unwrap().export.page_size, "a5");
    assert_eq!(builtin("web").unwrap().export.chapter_start, "continuous");
    assert_eq!(builtin("classic").unwrap().export.chapter_start, "new_page");
    assert_eq!(builtin("epic_fantasy").unwrap().export.scene_separator, "* * *");
    let title = builtin("epic_fantasy").unwrap().export.chapter_title_size_pt;
    assert!((16.0..=20.0).contains(&title));
}

#[test]
fn builtin_profiles_are_already_valid() {
    for b in builtin_profiles() {
        let mut p = b.profile.clone();
        p.sanitize();
        assert_eq!(p, b.profile, "{} changes when sanitized", b.id);
    }
}

#[test]
fn changes_are_kept_per_profile_apart_from_the_originals() {
    let mut f = FormatSettings::default();
    assert_eq!(f.active_profile, DEFAULT_PROFILE);
    assert_eq!(f.active(), builtin("classic").unwrap());

    let mut modern = f.profile("modern").unwrap();
    modern.font_size_pt = 13.0;
    f.custom.insert("modern".into(), modern.clone());
    f.active_profile = "modern".into();
    f.sanitize();

    assert_eq!(f.active(), modern);
    // Other profiles and the built-in definition are untouched.
    assert_eq!(f.profile("classic").unwrap(), builtin("classic").unwrap());
    assert!(approx(builtin("modern").unwrap().font_size_pt, 11.0));

    // Restoring is dropping the entry.
    f.custom.remove("modern");
    assert_eq!(f.active(), builtin("modern").unwrap());
}

#[test]
fn sanitize_drops_unknown_and_unchanged_entries_and_clamps_values() {
    let mut f = FormatSettings { active_profile: "nope".into(), ..Default::default() };
    f.custom.insert("ghost".into(), FormatProfile::default());
    f.custom.insert("web".into(), builtin("web").unwrap());
    let mut wild = builtin("pocket").unwrap();
    wild.font_family = "  \"Evil\"; } font  ".into();
    wild.font_size_pt = 400.0;
    wild.line_height = f32::NAN;
    wild.alignment = "center".into();
    wild.first_line_indent_cm = -3.0;
    wild.export.page_size = "folio".into();
    wild.export.margin_cm = 0.0;
    wild.export.chapter_start = "sometimes".into();
    wild.export.scene_separator = "~\n~".into();
    wild.export.chapter_title_size_pt = 3.0;
    f.custom.insert("pocket".into(), wild);
    f.sanitize();

    assert_eq!(f.active_profile, DEFAULT_PROFILE);
    assert!(!f.custom.contains_key("ghost"));
    assert!(!f.custom.contains_key("web"), "an unchanged copy is not a customisation");
    let p = &f.custom["pocket"];
    assert_eq!(p.font_family, "Evil  font");
    assert!(approx(p.font_size_pt, 48.0));
    assert!(approx(p.line_height, 1.2));
    assert_eq!(p.alignment, "left");
    assert!(approx(p.first_line_indent_cm, 0.0));
    assert_eq!(p.export.page_size, "a4");
    assert!(approx(p.export.margin_cm, 0.7));
    assert_eq!(p.export.chapter_start, "new_page");
    assert_eq!(p.export.scene_separator, "~ ~");
    assert!(approx(p.export.chapter_title_size_pt, 0.0));
}

#[test]
fn format_settings_survive_a_restart_and_old_files_still_load() {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("format-profiles-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("settings.json");

    let mut s = Settings::default();
    s.format.active_profile = "light_novel".into();
    let mut p = builtin("light_novel").unwrap();
    p.export.scene_separator = "◇".into();
    s.format.custom.insert("light_novel".into(), p.clone());
    s.sanitize();
    s.save_to(&path).unwrap();

    let loaded = Settings::load_from(&path).unwrap();
    assert_eq!(loaded.format, s.format);
    assert_eq!(loaded.format.active(), p);

    // A settings file from before profiles existed.
    std::fs::write(&path, br#"{"editor":{"font_family":"Georgia","font_size":16}}"#).unwrap();
    let old = Settings::load_from(&path).unwrap();
    assert_eq!(old.format, FormatSettings::default());
    assert_eq!(old.editor.font_size, 16);
}

#[test]
fn profile_becomes_compile_settings_in_inches() {
    let s = builtin("pocket").unwrap().compile_settings("es");
    assert_eq!(s.preset, COMPILE_PRESET_ID);
    assert_eq!(s.font_family, "Garamond");
    assert!(approx(s.font_size, 10.5));
    assert!(approx(s.line_spacing, 1.1));
    assert!(approx(s.first_line_indent, 0.5 / 2.54));
    assert!(approx(s.margin, 1.8 / 2.54));
    assert_eq!(s.page_size, "a5");
    assert_eq!(s.alignment, "justify");
    assert!(s.page_break_before_chapters);
    assert_eq!(s.language, "es");

    let web = builtin("web").unwrap().compile_settings("es");
    assert!(!web.page_break_before_chapters);
    assert!(approx(web.paragraph_spacing, 6.0));
    assert_eq!(web.alignment, "left");
    assert!(web.separator.is_empty(), "blank line between scenes");

    let manuscript = builtin("manuscript").unwrap().compile_settings("es");
    assert!(approx(manuscript.margin, 1.0));
    assert!(approx(manuscript.line_spacing, 2.0));
}

// ---------------------------------------------------------------------------
// Compiling with profile settings
// ---------------------------------------------------------------------------

fn project() -> Project {
    let mut p = build_project_from_template("blank/blank", "Libro".into(), Some("Ana Pérez".into())).unwrap();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let chapter = p.create_child(draft, DocumentKind::Folder, "Capitulo uno").unwrap();
    let scene = p.create_child(chapter, DocumentKind::Document, "Escena").unwrap();
    let text = "Una frase bastante larga para ocupar varias lineas del parrafo justificado. ".repeat(12);
    p.get_mut(scene).unwrap().content = RichDoc::from_paragraph(&text);
    p.get_mut(scene).unwrap().touch();
    p
}

fn compile_with(format: CompileFormat, settings: CompileSettings) -> Vec<u8> {
    let req = CompileRequest { format, settings, include: Vec::new(), title: None, author: None };
    compile(&project(), &req).unwrap()
}

fn zip_text(bytes: &[u8], name: &str) -> String {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut f = zip.by_name(name).unwrap();
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    s
}

fn profile_settings(id: &str) -> CompileSettings {
    let mut p = builtin(id).unwrap();
    p.export.header_text = "Ana Perez - Libro".into();
    p.compile_settings("es")
}

#[test]
fn pdf_uses_profile_page_justification_header_and_title_size() {
    let bytes = compile_with(CompileFormat::Pdf, profile_settings("epic_fantasy"));
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("/MediaBox [0 0 595.28 841.89]"), "A4");
    assert!(text.contains(" Tw "), "justified lines set word spacing");
    assert!(text.contains("0 Tw "), "word spacing is reset");
    assert!(text.contains("(Ana Perez - Libro)"), "running header");
    assert!(text.contains("/F2 18.00 Tf"), "18 pt bold chapter title");

    let pocket = compile_with(CompileFormat::Pdf, profile_settings("pocket"));
    assert!(String::from_utf8_lossy(&pocket).contains("/MediaBox [0 0 419.53 595.28]"), "A5");

    let left = compile_with(CompileFormat::Pdf, profile_settings("cinematic"));
    assert!(!String::from_utf8_lossy(&left).contains(" Tw "), "left-aligned text is not stretched");
}

#[test]
fn docx_uses_profile_page_justification_header_and_title_size() {
    let bytes = compile_with(CompileFormat::Docx, profile_settings("epic_fantasy"));
    let styles = zip_text(&bytes, "word/styles.xml");
    assert!(styles.contains("<w:jc w:val=\"both\"/>"), "justified Normal style");
    assert!(styles.contains("w:line=\"300\""), "1.25 line spacing");
    let doc = zip_text(&bytes, "word/document.xml");
    assert!(doc.contains("<w:sz w:val=\"36\"/>"), "18 pt chapter title");
    assert!(doc.contains("w:w=\"11906\" w:h=\"16838\""), "A4");
    let header = zip_text(&bytes, "word/header1.xml");
    assert!(header.contains("Ana Perez - Libro"));
    assert!(!header.contains("PAGE"), "page numbers go in the footer");
    assert!(zip_text(&bytes, "word/footer1.xml").contains("PAGE"));

    let pocket = compile_with(CompileFormat::Docx, profile_settings("pocket"));
    assert!(zip_text(&pocket, "word/document.xml").contains("w:w=\"8391\" w:h=\"11906\""), "A5");
}

#[test]
fn html_uses_profile_alignment_and_spacing() {
    let mut s = profile_settings("web");
    s.paragraph_spacing_before = 3.0;
    let html = String::from_utf8(compile_with(CompileFormat::Html, s)).unwrap();
    assert!(html.contains("p { margin: 3pt 0 6pt;"));
    assert!(!html.contains("text-align: justify"));
    assert!(!html.contains("page-break\""), "web chapters are continuous");

    let html = String::from_utf8(compile_with(CompileFormat::Html, profile_settings("epic_fantasy"))).unwrap();
    assert!(html.contains("text-align: justify"));
    assert!(html.contains("font-size: 18pt"));
}

#[test]
fn compile_sanitizes_new_fields() {
    let s = CompileSettings {
        alignment: "diagonal".into(),
        page_size: "a5".into(),
        chapter_title_size: 2.0,
        paragraph_spacing_before: -4.0,
        header_text: "  una\nlinea  ".into(),
        ..CompileSettings::default()
    }
    .sanitized();
    assert_eq!(s.alignment, "left");
    assert_eq!(s.page_size, "a5");
    assert!(approx(s.chapter_title_size, 0.0));
    assert!(approx(s.paragraph_spacing_before, 0.0));
    assert_eq!(s.header_text, "una linea");
}

#[test]
fn interface_language_is_english_or_spanish() {
    let mut s = Settings::default();
    assert_eq!(s.general.language, "en");
    s.general.language = "es".into();
    s.sanitize();
    assert_eq!(s.general.language, "es");
    s.general.language = "klingon".into();
    s.sanitize();
    assert_eq!(s.general.language, "en");
}
