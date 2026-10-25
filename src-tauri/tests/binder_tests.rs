//! Tests for Draft/Research/Trash tree operations and persistence.
//!
//! Mirrors the manual acceptance tests:
//! - Test A (Draft): create, write, switch, reopen.
//! - Test B (Research): notes + folders survive restart.
//! - Test C (Trash): trash → restore → purge, mutual exclusivity.
//! - Test E (Persistence): everything survives a save/reopen cycle.

use scribeforge_lib::project::document::{
    DocumentKind, ImageAttachment, Mark, ParaAttrs, RichDoc, Span,
};
use scribeforge_lib::project::model::{AssetData, Project};
use scribeforge_lib::templates::build_project_from_template;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh_project() -> Project {
    build_project_from_template("blank/blank", "Test".into(), None).unwrap()
}

// ---------------------------------------------------------------------------
// Test A: Draft CRUD
// ---------------------------------------------------------------------------

#[test]
fn create_write_and_reopen_document() {
    let dir = temp_dir("draft-crud");
    let path = dir.join("Draft.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc_id = p.create_child(draft, DocumentKind::Document, "Chapter 1").unwrap();

    // Write content.
    p.get_mut(doc_id).unwrap().content = RichDoc::from_paragraph("It was a dark and stormy night.");
    p.get_mut(doc_id).unwrap().touch();

    assert_eq!(p.manuscript_word_count(), 7);

    // Create a second document to force "switching".
    let doc2 = p.create_child(draft, DocumentKind::Document, "Chapter 2").unwrap();
    p.get_mut(doc2).unwrap().content = RichDoc::from_paragraph("Second chapter.");
    p.get_mut(doc2).unwrap().touch();

    // The first document's content is untouched by working on the second.
    assert!(p
        .get(doc_id)
        .unwrap()
        .content
        .plain_text()
        .contains("dark and stormy"));

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();

    // Reopen: content, order and ids survive.
    let reopened = scribeforge_lib::storage::read_project_from_path(&path).unwrap();
    let doc = reopened.get(doc_id).unwrap();
    assert!(doc.content.plain_text().contains("dark and stormy"));
    assert_eq!(doc.title, "Chapter 1");
    assert_eq!(reopened.manuscript_word_count(), 9);

    // Order persisted: Chapter 1 before Chapter 2.
    let kids: Vec<_> = reopened.children(Some(draft)).into_iter().map(|d| d.id).collect();
    assert_eq!(kids, vec![doc_id, doc2]);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rename_and_duplicate_documents() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc = p.create_child(draft, DocumentKind::Document, "Original").unwrap();

    p.rename(doc, "Renamed").unwrap();
    assert_eq!(p.get(doc).unwrap().title, "Renamed");

    let copy = p.duplicate(doc).unwrap();
    assert_eq!(p.get(copy).unwrap().title, "Renamed (copy)");
    // Distinct ids — never aliased.
    assert_ne!(doc, copy);

    // Sibling ordering: original at 0, copy right after at 1.
    let kids = p.children(Some(draft));
    assert_eq!(kids.len(), 2);
    assert_eq!(kids[0].id, doc);
    assert_eq!(kids[1].id, copy);
}

#[test]
fn folders_preserve_children_across_moves() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();

    let folder = p.create_child(draft, DocumentKind::Folder, "Part One").unwrap();
    let child = p
        .create_child(folder, DocumentKind::Document, "Scene 1")
        .unwrap();
    let subfolder = p
        .create_child(folder, DocumentKind::Folder, "Sub")
        .unwrap();
    let grandchild = p
        .create_child(subfolder, DocumentKind::Document, "Deep")
        .unwrap();

    // Move the folder to the end of draft — children must follow.
    p.move_node(folder, draft, 5).unwrap();
    assert_eq!(p.get(child).unwrap().parent, Some(folder));
    assert_eq!(p.get(subfolder).unwrap().parent, Some(folder));
    assert_eq!(p.get(grandchild).unwrap().parent, Some(subfolder));
}

#[test]
fn move_rejects_cycles() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let outer = p.create_child(draft, DocumentKind::Folder, "Outer").unwrap();
    let inner = p.create_child(outer, DocumentKind::Folder, "Inner").unwrap();

    // Moving outer into inner would create a cycle.
    let result = p.move_node(outer, inner, 0);
    assert!(result.is_err());
    // Tree unchanged.
    assert_eq!(p.get(outer).unwrap().parent, Some(draft));
    assert_eq!(p.get(inner).unwrap().parent, Some(outer));
}

// ---------------------------------------------------------------------------
// Test B: Research
// ---------------------------------------------------------------------------

#[test]
fn research_notes_and_folders_persist() {
    let dir = temp_dir("research");
    let path = dir.join("Research.scri");
    let mut p = fresh_project();

    let research = p.root_id(DocumentKind::ResearchRoot).unwrap();
    let note = p.create_child(research, DocumentKind::Research, "Note 1").unwrap();
    p.get_mut(note).unwrap().content = RichDoc::from_paragraph("Research content here.");
    p.get_mut(note).unwrap().touch();

    let folder = p
        .create_child(research, DocumentKind::Folder, "Sources")
        .unwrap();
    p.move_node(note, folder, 0).unwrap();

    // Research notes are not counted as manuscript words.
    assert_eq!(p.manuscript_word_count(), 0);

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let reopened = scribeforge_lib::storage::read_project_from_path(&path).unwrap();

    let folder_id = reopened
        .documents
        .values()
        .find(|d| d.title == "Sources")
        .map(|d| d.id)
        .unwrap();
    let note_doc = reopened.get(note).unwrap();
    assert_eq!(note_doc.parent, Some(folder_id));
    assert!(note_doc.content.plain_text().contains("Research content"));
    assert!(reopened.in_research(note));

    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// Test C: Trash
// ---------------------------------------------------------------------------

#[test]
fn trash_restore_and_purge_cycle() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let trash = p.root_id(DocumentKind::TrashRoot).unwrap();

    let doc = p.create_child(draft, DocumentKind::Document, "Doomed").unwrap();
    p.get_mut(doc).unwrap().content = RichDoc::from_paragraph("valuable words");
    p.get_mut(doc).unwrap().touch();

    // Trash it.
    p.move_to_trash(doc).unwrap();
    assert!(p.in_trash(doc));
    // Mutually exclusive: no longer a child of draft.
    assert!(!p.children(Some(draft)).iter().any(|d| d.id == doc));
    // Now a child of trash.
    assert!(p.children(Some(trash)).iter().any(|d| d.id == doc));

    // Restore.
    let destination = p.restore_from_trash(doc).unwrap();
    assert_eq!(destination, draft, "restored to original parent");
    assert!(!p.in_trash(doc));
    assert!(p.children(Some(draft)).iter().any(|d| d.id == doc));
    // Content survived the round trip.
    assert!(p.get(doc).unwrap().content.plain_text().contains("valuable words"));

    // Trash again, then purge permanently.
    p.move_to_trash(doc).unwrap();
    p.purge_subtree(doc).unwrap();
    assert!(p.get(doc).is_none());
    assert!(!p.children(Some(trash)).iter().any(|d| d.id == doc));
}

#[test]
fn trashing_folder_trashes_descendants() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let trash = p.root_id(DocumentKind::TrashRoot).unwrap();

    let folder = p.create_child(draft, DocumentKind::Folder, "Part").unwrap();
    let child = p.create_child(folder, DocumentKind::Document, "Scene").unwrap();
    p.get_mut(child).unwrap().content = RichDoc::from_paragraph("scene text");
    p.get_mut(child).unwrap().touch();

    p.move_to_trash(folder).unwrap();

    // Both the folder and its descendants are in trash.
    assert!(p.in_trash(folder));
    assert!(p.in_trash(child));
    // Hierarchy preserved: child still parented to folder.
    assert_eq!(p.get(child).unwrap().parent, Some(folder));
    // Original parent remembered.
    assert_eq!(p.get(folder).unwrap().original_parent, Some(draft));

    // Restoring the folder brings the whole subtree back.
    p.restore_from_trash(folder).unwrap();
    assert!(!p.in_trash(folder));
    assert!(!p.in_trash(child));
    assert!(p.children(Some(draft)).iter().any(|d| d.id == folder));
    assert!(p.get(child).unwrap().content.plain_text().contains("scene text"));

    let _ = trash;
}

#[test]
fn restore_falls_back_when_original_parent_gone() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();

    let folder = p.create_child(draft, DocumentKind::Folder, "Temp").unwrap();
    let doc = p.create_child(folder, DocumentKind::Document, "Orphan").unwrap();

    // Trash the document first: it moves directly under the Trash root,
    // remembering `folder` as its original parent.
    p.move_to_trash(doc).unwrap();

    // Now trash the folder and purge it permanently. The doc survives because
    // it is a direct child of Trash, not of the purged folder.
    p.move_to_trash(folder).unwrap();
    p.purge_subtree(folder).unwrap();
    assert!(p.get(folder).is_none());

    // The doc's original parent is gone; restore must not lose it.
    let destination = p.restore_from_trash(doc).unwrap();
    assert_eq!(destination, draft, "fell back to Draft root");
    assert!(p.get(doc).is_some());
}

#[test]
fn roots_cannot_be_trashed_or_purged() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let research = p.root_id(DocumentKind::ResearchRoot).unwrap();
    let trash = p.root_id(DocumentKind::TrashRoot).unwrap();

    assert!(p.move_to_trash(draft).is_err());
    assert!(p.move_to_trash(research).is_err());
    assert!(p.move_to_trash(trash).is_err());
    assert!(p.purge_subtree(draft).is_err());
    assert!(p.purge_subtree(research).is_err());
    assert!(p.purge_subtree(trash).is_err());

    // All three roots still present.
    assert!(p.root_id(DocumentKind::DraftRoot).is_some());
    assert!(p.root_id(DocumentKind::ResearchRoot).is_some());
    assert!(p.root_id(DocumentKind::TrashRoot).is_some());
}

#[test]
fn empty_trash_purges_everything_inside() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let trash = p.root_id(DocumentKind::TrashRoot).unwrap();

    for name in ["A", "B", "C"] {
        let doc = p.create_child(draft, DocumentKind::Document, name).unwrap();
        p.move_to_trash(doc).unwrap();
    }
    assert_eq!(p.children(Some(trash)).len(), 3);

    let purged = p.empty_trash().unwrap();
    assert_eq!(purged, 3);
    assert_eq!(p.children(Some(trash)).len(), 0);
    // Roots survive.
    assert!(p.root_id(DocumentKind::TrashRoot).is_some());
}

// ---------------------------------------------------------------------------
// Test E: full persistence round trip
// ---------------------------------------------------------------------------

#[test]
fn full_project_state_survives_save_and_reopen() {
    let dir = temp_dir("persistence");
    let path = dir.join("Full.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let research = p.root_id(DocumentKind::ResearchRoot).unwrap();
    let trash = p.root_id(DocumentKind::TrashRoot).unwrap();

    // Draft: folder + documents.
    let part = p.create_child(draft, DocumentKind::Folder, "Part One").unwrap();
    let ch1 = p.create_child(part, DocumentKind::Document, "Chapter 1").unwrap();
    p.get_mut(ch1).unwrap().content = RichDoc::from_paragraph("one two three");
    p.get_mut(ch1).unwrap().synopsis = "Chapter one synopsis.".into();
    p.get_mut(ch1).unwrap().status = "Revised".into();
    p.get_mut(ch1).unwrap().labels = vec!["Key".into()];
    p.get_mut(ch1).unwrap().touch();

    // Research: note inside a folder.
    let rfolder = p.create_child(research, DocumentKind::Folder, "Sources").unwrap();
    let note = p.create_child(rfolder, DocumentKind::Research, "Reference").unwrap();
    p.get_mut(note).unwrap().notes = "author, title, year".into();
    p.get_mut(note).unwrap().touch();

    // Trash: one item.
    let doomed = p.create_child(draft, DocumentKind::Document, "Doomed").unwrap();
    p.move_to_trash(doomed).unwrap();

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let r = scribeforge_lib::storage::read_project_from_path(&path).unwrap();

    // Structure.
    let part2 = r.documents.values().find(|d| d.title == "Part One").map(|d| d.id).unwrap();
    assert_eq!(r.get(ch1).unwrap().parent, Some(part2));
    // Metadata persisted.
    let ch = r.get(ch1).unwrap();
    assert_eq!(ch.synopsis, "Chapter one synopsis.");
    assert_eq!(ch.status, "Revised");
    assert_eq!(ch.labels, vec!["Key".to_string()]);
    // Research persisted.
    assert!(r.get(note).unwrap().notes.contains("author"));
    assert!(r.in_research(note));
    // Trash persisted.
    assert!(r.in_trash(doomed));
    assert_eq!(r.get(doomed).unwrap().original_parent, Some(draft));
    // Word count only counts draft documents.
    assert_eq!(r.manuscript_word_count(), 3);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn trashed_document_not_double_counted() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();

    let a = p.create_child(draft, DocumentKind::Document, "A").unwrap();
    let b = p.create_child(draft, DocumentKind::Document, "B").unwrap();
    for id in [a, b] {
        p.get_mut(id).unwrap().content = RichDoc::from_paragraph("ten words here to make ten words here");
        p.get_mut(id).unwrap().touch();
    }
    // 2 docs × 8 words.
    assert_eq!(p.manuscript_word_count(), 16);

    // Trashing B removes its words from the manuscript count but the doc
    // still exists (in trash).
    p.move_to_trash(b).unwrap();
    assert_eq!(p.manuscript_word_count(), 8);
    assert!(p.get(b).is_some());
}

#[test]
fn in_trash_flag_is_accurate_for_nested_items() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();

    let folder = p.create_child(draft, DocumentKind::Folder, "F").unwrap();
    let doc = p.create_child(folder, DocumentKind::Document, "D").unwrap();
    assert!(!p.in_trash(doc));

    p.move_to_trash(folder).unwrap();
    assert!(p.in_trash(folder));
    assert!(p.in_trash(doc), "descendant of trashed folder must be flagged");
}

// ---------------------------------------------------------------------------
// Image attachments
// ---------------------------------------------------------------------------

/// A minimal valid 1x1 PNG (magic bytes + IHDR...) for testing round-trips.
fn tiny_png() -> Vec<u8> {
    let mut v = vec![0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A];
    v.extend_from_slice(b"IHDR and the rest of a real file would follow");
    v
}

fn attach_image(p: &mut Project, doc_id: uuid::Uuid, filename: &str) -> uuid::Uuid {
    let att = ImageAttachment::new(filename.to_string(), "image/png".to_string());
    let att_id = att.id;
    p.assets.insert(
        att_id,
        AssetData {
            bytes: tiny_png(),
            mime_type: "image/png".to_string(),
            filename: filename.to_string(),
        },
    );
    let doc = p.get_mut(doc_id).unwrap();
    doc.attachments.push(att);
    doc.touch();
    att_id
}

#[test]
fn image_attachments_persist_through_save_and_reopen() {
    let dir = temp_dir("attachments");
    let path = dir.join("Images.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc = p.create_child(draft, DocumentKind::Document, "With Image").unwrap();
    let att_id = attach_image(&mut p, doc, "cover.png");

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let r = scribeforge_lib::storage::read_project_from_path(&path).unwrap();

    // Attachment metadata survived.
    let reopened_doc = r.get(doc).unwrap();
    assert_eq!(reopened_doc.attachments.len(), 1);
    assert_eq!(reopened_doc.attachments[0].id, att_id);
    assert_eq!(reopened_doc.attachments[0].filename, "cover.png");
    assert_eq!(reopened_doc.attachments[0].mime_type, "image/png");

    // Asset bytes survived and match the original.
    let asset = r.assets.get(&att_id).expect("asset bytes must exist");
    assert_eq!(asset.bytes, tiny_png());
    assert_eq!(asset.mime_type, "image/png");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn resized_attachment_dimensions_persist() {
    let dir = temp_dir("attachment-resize");
    let path = dir.join("Resize.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc = p.create_child(draft, DocumentKind::Document, "Doc").unwrap();
    let att_id = attach_image(&mut p, doc, "img.png");

    // Simulate a user resize.
    let d = p.get_mut(doc).unwrap();
    d.attachments[0].display_width = 500;
    d.attachments[0].display_height = 375;
    d.touch();

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let r = scribeforge_lib::storage::read_project_from_path(&path).unwrap();
    let att = &r.get(doc).unwrap().attachments[0];
    assert_eq!(att.id, att_id);
    assert_eq!(att.display_width, 500);
    assert_eq!(att.display_height, 375);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn deleting_document_removes_its_assets() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc = p.create_child(draft, DocumentKind::Document, "Doomed").unwrap();
    let att = attach_image(&mut p, doc, "x.png");

    assert!(p.assets.contains_key(&att));

    // Soft-delete keeps assets (restorable).
    p.move_to_trash(doc).unwrap();
    assert!(p.assets.contains_key(&att), "trash must keep assets restorable");

    // Permanent purge removes them.
    p.purge_subtree(doc).unwrap();
    assert!(!p.assets.contains_key(&att), "purge must remove asset bytes");

    // Restore path keeps them.
    let doc2 = p.create_child(draft, DocumentKind::Document, "Keep").unwrap();
    let att2 = attach_image(&mut p, doc2, "y.png");
    p.move_to_trash(doc2).unwrap();
    p.restore_from_trash(doc2).unwrap();
    assert!(p.assets.contains_key(&att2), "restore must keep assets");
}

#[test]
fn duplicating_document_copies_assets_with_new_ids() {
    let mut p = fresh_project();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc = p.create_child(draft, DocumentKind::Document, "Original").unwrap();
    let att_id = attach_image(&mut p, doc, "photo.png");

    let copy = p.duplicate(doc).unwrap();

    // Both documents reference an attachment, but with different ids.
    let orig_att_id = p.get(doc).unwrap().attachments[0].id;
    let copy_att_id = p.get(copy).unwrap().attachments[0].id;
    assert_eq!(orig_att_id, att_id);
    assert_ne!(copy_att_id, att_id, "duplicated attachment must get a fresh id");
    assert_eq!(p.get(copy).unwrap().attachments[0].filename, "photo.png");

    // Both assets exist independently.
    assert!(p.assets.contains_key(&att_id));
    assert!(p.assets.contains_key(&copy_att_id));

    // Removing the original's attachment does not affect the copy's.
    p.get_mut(doc).unwrap().attachments.clear();
    p.assets.remove(&att_id);
    assert!(p.assets.contains_key(&copy_att_id));
    assert_eq!(p.get(copy).unwrap().attachments.len(), 1);
}

#[test]
fn attachments_move_with_folder_moves() {
    let dir = temp_dir("attachment-move");
    let path = dir.join("Move.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let folder = p.create_child(draft, DocumentKind::Folder, "Part").unwrap();
    let doc = p.create_child(folder, DocumentKind::Document, "Scene").unwrap();
    let att = attach_image(&mut p, doc, "scene.png");

    // Move the folder to a new position; the attachment stays bound to the doc.
    p.move_node(folder, draft, 5).unwrap();
    assert_eq!(p.get(doc).unwrap().parent, Some(folder));
    assert_eq!(p.get(doc).unwrap().attachments.len(), 1);

    // Trash the folder — attachment metadata and bytes survive for restore.
    p.move_to_trash(folder).unwrap();
    assert!(p.assets.contains_key(&att));
    assert_eq!(p.get(doc).unwrap().attachments[0].id, att);

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let r = scribeforge_lib::storage::read_project_from_path(&path).unwrap();
    assert!(r.in_trash(folder));
    assert!(r.assets.contains_key(&att), "trashed doc's assets must persist");

    std::fs::remove_dir_all(&dir).ok();
}

// ---------------------------------------------------------------------------
// Rich formatting (Tiptap marks & paragraph attrs) — Test A of the acceptance
// criteria: every format survives a save/reopen cycle.
// ---------------------------------------------------------------------------

#[test]
fn rich_formatting_persists_through_save_and_reopen() {
    let dir = temp_dir("rich-formatting");
    let path = dir.join("Rich.scri");
    let mut p = fresh_project();

    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let doc_id = p.create_child(draft, DocumentKind::Document, "Formatted").unwrap();

    // Build a paragraph with every new mark type + paragraph attributes.
    let styled = RichDoc {
        blocks: vec![
            scribeforge_lib::project::document::Block::Paragraph {
                attrs: ParaAttrs {
                    style: Some("verse".to_string()),
                    align: Some("center".to_string()),
                    line_height: Some(1.5),
                    space_before: Some(6.0),
                    space_after: Some(12.0),
                    indent_left: Some(20.0),
                    indent_right: Some(0.0),
                    indent_first: Some(10.0),
                },
                spans: vec![
                    Span {
                        text: "colored ".to_string(),
                        marks: vec![
                            Mark::Bold,
                            Mark::Color { hex: "#c00000".to_string() },
                            Mark::FontSize { pt: 14.0 },
                            Mark::FontFamily { family: "Georgia".to_string() },
                        ],
                    },
                    Span {
                        text: "highlighted".to_string(),
                        marks: vec![
                            Mark::Highlight { hex: "#ffff00".to_string() },
                            Mark::CodeSpan,
                        ],
                    },
                    Span {
                        text: " plain".to_string(),
                        marks: vec![],
                    },
                ],
            },
        ],
    };
    let doc = p.get_mut(doc_id).unwrap();
    doc.content = styled.clone();
    doc.touch();

    scribeforge_lib::storage::write_project_to_path(&p, &path).unwrap();
    let r = scribeforge_lib::storage::read_project_from_path(&path).unwrap();

    let reopened = r.get(doc_id).unwrap();
    match &reopened.content.blocks[0] {
        scribeforge_lib::project::document::Block::Paragraph { attrs, spans } => {
            assert_eq!(attrs.style.as_deref(), Some("verse"));
            assert_eq!(attrs.align.as_deref(), Some("center"));
            assert_eq!(attrs.line_height, Some(1.5));
            assert_eq!(attrs.space_before, Some(6.0));
            assert_eq!(attrs.space_after, Some(12.0));
            assert_eq!(attrs.indent_left, Some(20.0));
            assert_eq!(attrs.indent_first, Some(10.0));

            assert_eq!(spans.len(), 3);
            // First span: bold + color + font size + font family.
            assert!(spans[0].marks.contains(&Mark::Bold));
            assert!(spans[0]
                .marks
                .contains(&Mark::Color { hex: "#c00000".to_string() }));
            assert!(spans[0].marks.contains(&Mark::FontSize { pt: 14.0 }));
            assert!(spans[0]
                .marks
                .contains(&Mark::FontFamily { family: "Georgia".to_string() }));
            // Second span: highlight + code.
            assert!(spans[1]
                .marks
                .contains(&Mark::Highlight { hex: "#ffff00".to_string() }));
            assert!(spans[1].marks.contains(&Mark::CodeSpan));
            // Third span: unmarked.
            assert!(spans[2].marks.is_empty());
        }
        other => panic!("expected paragraph, got {other:?}"),
    }

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn old_scri_files_without_para_attrs_still_open() {
    // A document JSON without the new `attrs` field (old format) must
    // deserialize with default (empty) ParaAttrs — backward compatibility.
    let doc_json = serde_json::json!({
        "id": "00000000-0000-0000-0000-0000000000aa",
        "title": "Legacy",
        "kind": "document",
        "order": 0,
        "spans": [],
        "created_at": "2026-01-01T00:00:00Z",
        "modified_at": "2026-01-01T00:00:00Z",
        "content": {
            "blocks": [
                { "type": "paragraph", "spans": [{ "text": "old text" }] }
            ]
        }
    });
    let doc: scribeforge_lib::project::document::Document =
        serde_json::from_value(doc_json).expect("old-format document must parse");
    match &doc.content.blocks[0] {
        scribeforge_lib::project::document::Block::Paragraph { attrs, spans } => {
            assert_eq!(*attrs, ParaAttrs::default(), "missing attrs must default");
            assert_eq!(spans[0].text, "old text");
        }
        other => panic!("expected paragraph, got {other:?}"),
    }
}
