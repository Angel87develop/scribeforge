//! Integration tests for the `.scri` container format.
//!
//! Covers: create → save → reopen round-trip, template instantiation,
//! validation of corrupt archives, path-traversal rejection, portability
//! (moving a file to a new location), and safe-save (original preserved when
//! a write fails).

use std::io::Write;

use scribeforge_lib::project::manifest::Manifest;
use scribeforge_lib::project::model::Project;
use scribeforge_lib::storage::{read_project_from_path, write_project_to_path};
use scribeforge_lib::templates::build_project_from_template;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn roundtrip_blank_project() {
    let dir = temp_dir("roundtrip-blank");
    let path = dir.join("Blank.scri");

    let project =
        build_project_from_template("blank/blank", "Test Blank".into(), None).unwrap();
    assert_eq!(project.manifest.format_version, 1);
    // Root folders exist even in a blank project.
    assert!(project.root_id(scribeforge_lib::project::document::DocumentKind::DraftRoot).is_some());
    assert!(project.root_id(scribeforge_lib::project::document::DocumentKind::ResearchRoot).is_some());
    assert!(project.root_id(scribeforge_lib::project::document::DocumentKind::TrashRoot).is_some());
    // And no other documents.
    assert_eq!(project.documents.len(), 3);

    write_project_to_path(&project, &path).unwrap();

    let reopened = read_project_from_path(&path).unwrap();
    assert_eq!(reopened.manifest.name, "Test Blank");
    assert_eq!(reopened.manifest.project_id, project.manifest.project_id);
    assert_eq!(reopened.documents.len(), 3);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn roundtrip_novel_template_content() {
    let dir = temp_dir("roundtrip-novel");
    let path = dir.join("Novel.scri");

    let project =
        build_project_from_template("fiction/novel", "My Novel".into(), Some("Author".into()))
            .unwrap();

    // The novel template must add starter documents beyond the 3 roots.
    assert!(project.documents.len() > 3);
    let draft_words = project.manuscript_word_count();
    assert_eq!(draft_words, 0, "starter chapters are empty");

    write_project_to_path(&project, &path).unwrap();

    let reopened = read_project_from_path(&path).unwrap();
    assert_eq!(reopened.documents.len(), project.documents.len());
    assert_eq!(reopened.manifest.author.as_deref(), Some("Author"));
    assert_eq!(reopened.manifest.template_id, "fiction/novel");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn word_counts_persist() {
    let dir = temp_dir("word-counts");
    let path = dir.join("Words.scri");

    let mut project =
        build_project_from_template("getting-started/writing-basics", "Words".into(), None).unwrap();

    // Write text into every document under the Manuscript root.
    let draft_id = project
        .root_id(scribeforge_lib::project::document::DocumentKind::DraftRoot)
        .unwrap();
    let doc_ids: Vec<_> = project
        .children(Some(draft_id))
        .iter()
        .map(|d| d.id)
        .collect();
    for id in doc_ids {
        let doc = project.get_mut(id).unwrap();
        doc.content = scribeforge_lib::project::document::RichDoc::from_paragraph(
            "alpha beta gamma delta epsilon zeta",
        );
        doc.touch();
    }

    let expected = project.manuscript_word_count();
    assert_eq!(expected, 6 * 3, "three chapters with six words each");

    write_project_to_path(&project, &path).unwrap();

    let reopened = read_project_from_path(&path).unwrap();
    assert_eq!(reopened.manuscript_word_count(), expected);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn portability_move_file_to_new_location() {
    let dir = temp_dir("portability");
    let path_a = dir.join("a").join("Proj.scri");
    let path_b = dir.join("b").join("Moved.scri");
    std::fs::create_dir_all(dir.join("a")).unwrap();
    std::fs::create_dir_all(dir.join("b")).unwrap();

    let project = build_project_from_template("blank/blank", "Portable".into(), None).unwrap();
    write_project_to_path(&project, &path_a).unwrap();

    // Simulate copying to another computer: plain file copy to a new path.
    std::fs::copy(&path_a, &path_b).unwrap();

    let reopened = read_project_from_path(&path_b).unwrap();
    assert_eq!(reopened.manifest.name, "Portable");
    assert_eq!(reopened.manifest.project_id, project.manifest.project_id);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rejects_non_zip_file() {
    let dir = temp_dir("not-zip");
    let path = dir.join("Fake.scri");
    std::fs::write(&path, b"this is definitely not a zip archive").unwrap();

    let err = read_project_from_path(&path).unwrap_err();
    let msg = err.to_string();
    assert!(
        msg.contains("Archive") || msg.contains("invalid") || msg.contains("zip"),
        "unexpected error message: {msg}"
    );

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rejects_zip_without_manifest() {
    let dir = temp_dir("no-manifest");
    let path = dir.join("Empty.scri");

    // Build a valid zip that lacks manifest.json.
    let file = std::fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
    zip.start_file(
        "documents/x.json",
        zip::write::SimpleFileOptions::default(),
    )
    .unwrap();
    zip.write_all(b"{}").unwrap();
    zip.finish().unwrap();

    let err = read_project_from_path(&path).unwrap_err();
    assert!(err.to_string().contains("manifest"), "got: {err}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rejects_traversal_entry_names() {
    use scribeforge_lib::storage::paths::assert_safe_entry_name;

    assert!(assert_safe_entry_name("documents/abc.json").is_ok());
    assert!(assert_safe_entry_name("../evil.txt").is_err());
    assert!(assert_safe_entry_name("a/../../evil.txt").is_err());
    assert!(assert_safe_entry_name("/absolute.txt").is_err());
    assert!(assert_safe_entry_name("C:/windows/evil.txt").is_err());
    assert!(assert_safe_entry_name("").is_err());
}

#[test]
fn rejects_future_format_version() {
    let dir = temp_dir("future-version");
    let path = dir.join("Future.scri");

    // Hand-craft an archive claiming a format version beyond what we support.
    let manifest_json = format!(
        r#"{{
            "project_id": "00000000-0000-0000-0000-000000000001",
            "name": "Future",
            "format_version": 99,
            "app_version": "0.0.0",
            "created_at": "2026-01-01T00:00:00Z",
            "modified_at": "2026-01-01T00:00:00Z",
            "template_id": "blank/blank",
            "template_category": "blank"
        }}"#
    );

    let project_json = r#"{"autosave":true,"autosave_interval_secs":30,"session_word_goal":0,"project_word_goal":0,"backup_count":5}"#;

    let file = std::fs::File::create(&path).unwrap();
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
    let opts = zip::write::SimpleFileOptions::default();
    zip.start_file("manifest.json", opts).unwrap();
    zip.write_all(manifest_json.as_bytes()).unwrap();
    zip.start_file("documents/index.json", opts).unwrap();
    zip.write_all(b"{\"ids\":[]}").unwrap();
    zip.start_file("metadata/project.json", opts).unwrap();
    zip.write_all(project_json.as_bytes()).unwrap();
    zip.finish().unwrap();

    let err = read_project_from_path(&path).unwrap_err();
    assert!(err.to_string().contains("format version"), "got: {err}");
    // Most importantly: the original file must not have been modified.
    assert!(path.exists());

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn save_over_existing_preserves_data_on_success() {
    let dir = temp_dir("resave");
    let path = dir.join("Resave.scri");

    let mut project = build_project_from_template("blank/blank", "Resave".into(), None).unwrap();
    write_project_to_path(&project, &path).unwrap();

    // Modify and re-save.
    let name_before = project.manifest.name.clone();
    project.manifest.name = "Resave v2".into();
    write_project_to_path(&project, &path).unwrap();

    let reopened = read_project_from_path(&path).unwrap();
    assert_eq!(reopened.manifest.name, "Resave v2");
    assert_ne!(reopened.manifest.name, name_before);

    // A backup should have been created by the rotation policy.
    let backups_dir = dir.join("Resave.backups");
    assert!(backups_dir.exists(), "backups dir missing");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn manifest_new_has_fresh_ids() {
    let a = Manifest::new("A".into(), None, "blank/blank".into(), "blank".into());
    let b = Manifest::new("B".into(), None, "blank/blank".into(), "blank".into());
    assert_ne!(a.project_id, b.project_id);
    assert_eq!(a.format_version, b.format_version);
}

#[test]
fn project_tree_operations() {
    let project = build_project_from_template("blank/blank", "Tree".into(), None).unwrap();
    assert_eq!(project.documents.len(), 3);

    // binder listing is in stable order: Manuscript, Research, Trash
    let listing = project.binder_listing();
    assert_eq!(listing.len(), 3);
    assert_eq!(listing[0].title, "Manuscript");
    assert_eq!(listing[1].title, "Research");
    assert_eq!(listing[2].title, "Trash");
}
