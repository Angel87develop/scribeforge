//! Integration tests for the writing tools: goals and daily statistics,
//! snapshots (take, compare, restore), the personal dictionary, margin
//! comments, and project-wide find and replace — including that all of it
//! survives saving and reopening the `.scri` file.

use std::collections::HashSet;

use chrono::{Duration, NaiveDate, Utc};
use scribeforge_lib::project::document::{Block, Comment, DocumentKind, Mark, ParaAttrs, RichDoc, Span};
use scribeforge_lib::project::model::Project;
use scribeforge_lib::storage::{read_project_from_path, write_project_to_path};
use scribeforge_lib::templates::build_project_from_template;
use scribeforge_lib::writing::diff::ChunkKind;
use scribeforge_lib::writing::replace::{self, FindOptions};
use scribeforge_lib::writing::stats::{daily_target, WritingStats};
use uuid::Uuid;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh_project() -> Project {
    build_project_from_template("blank/blank", "Writing".into(), None).unwrap()
}

fn add_doc(p: &mut Project, title: &str, text: &str) -> Uuid {
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let id = p.create_child(draft, DocumentKind::Document, title).unwrap();
    let doc = p.get_mut(id).unwrap();
    doc.content = RichDoc::from_paragraph(text);
    doc.touch();
    id
}

fn options(query: &str) -> FindOptions {
    FindOptions {
        query: query.into(),
        regex: false,
        case_sensitive: false,
        whole_word: false,
        in_text: true,
        in_titles: false,
        in_synopsis: false,
        in_notes: false,
        documents: vec![],
    }
}

fn d(s: &str) -> NaiveDate {
    NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
}

#[test]
fn daily_stats_streaks_and_targets() {
    let mut s = WritingStats::default();
    s.record(d("2026-10-01"), 300);
    s.record(d("2026-10-02"), 200);
    s.record(d("2026-10-02"), -50);
    s.record(d("2026-10-03"), 100);
    s.record(d("2026-10-05"), 400);
    s.record(d("2026-10-06"), 10);

    assert_eq!(s.added_on(d("2026-10-02")), 200);
    assert_eq!(s.days[&d("2026-10-02")].removed, 50);
    assert_eq!(s.longest_streak(), 3);
    // Nothing written yet on the 7th: the streak from the 5th is still alive.
    assert_eq!(s.current_streak(d("2026-10-07")), 2);
    assert_eq!(s.current_streak(d("2026-10-08")), 0);

    let sum = s.summary(d("2026-10-06"));
    assert_eq!(sum.total_added, 1010);
    assert_eq!(sum.days_written, 5);
    assert_eq!(sum.best_day.unwrap().words, 400);
    assert_eq!(sum.last_7_days, 1010);

    // 10 000 words to go over 10 days (today included) → 1 000 a day.
    assert_eq!(daily_target(50_000, 40_000, d("2026-10-10"), d("2026-10-01")), (10, Some(1000)));
    // Rounded up.
    assert_eq!(daily_target(100, 0, d("2026-10-03"), d("2026-10-01")), (3, Some(34)));
    // Goal reached.
    assert_eq!(daily_target(100, 150, d("2026-10-03"), d("2026-10-01")), (3, Some(0)));
    // Deadline passed.
    assert_eq!(daily_target(100, 0, d("2026-09-30"), d("2026-10-01")).1, None);
}

#[test]
fn writing_is_recorded_outside_the_trash_only() {
    let mut p = fresh_project();
    let id = add_doc(&mut p, "One", "");
    p.record_writing(id, 120);
    p.record_writing(id, -20);
    assert_eq!(p.session.added, 120);
    assert_eq!(p.session.removed, 20);

    p.move_to_trash(id).unwrap();
    p.record_writing(id, 500);
    assert_eq!(p.session.added, 120, "trash edits do not count");

    let folder = p
        .create_child(p.root_id(DocumentKind::DraftRoot).unwrap(), DocumentKind::Folder, "F")
        .unwrap();
    p.record_writing(folder, 50);
    assert_eq!(p.session.added, 120, "folders have no text of their own");
}

#[test]
fn snapshots_compare_and_restore() {
    let mut p = fresh_project();
    let id = add_doc(&mut p, "Chapter", "The dog runs fast.");
    let first = p.take_snapshot(id, "First draft").unwrap();

    {
        let doc = p.get_mut(id).unwrap();
        doc.content = RichDoc::from_paragraph("The cat runs very fast.");
        doc.touch();
    }
    let snap = p.snapshot(id, first.id).unwrap();
    let diff = scribeforge_lib::writing::diff::diff_docs(&snap.content, &p.get(id).unwrap().content);
    let removed: String =
        diff.chunks.iter().filter(|c| c.kind == ChunkKind::Delete).map(|c| c.text.clone()).collect();
    let added: String =
        diff.chunks.iter().filter(|c| c.kind == ChunkKind::Insert).map(|c| c.text.clone()).collect();
    assert_eq!(removed.trim(), "dog");
    assert!(added.contains("cat") && added.contains("very"));

    p.restore_snapshot(id, first.id).unwrap();
    assert_eq!(p.get(id).unwrap().content.plain_text().trim(), "The dog runs fast.");
    assert_eq!(p.get(id).unwrap().word_count, 4);
    // The replaced text was kept as an automatic snapshot.
    let list = p.list_snapshots(id);
    assert_eq!(list.len(), 2);
    assert!(list[0].name.starts_with("Before restoring"));
    let auto = p.snapshot(id, list[0].id).unwrap();
    assert_eq!(auto.content.plain_text().trim(), "The cat runs very fast.");

    p.delete_snapshot(id, first.id).unwrap();
    assert_eq!(p.list_snapshots(id).len(), 1);

    // Purging the document drops its snapshots.
    p.move_to_trash(id).unwrap();
    p.purge_subtree(id).unwrap();
    assert!(p.snapshots.get(&id).is_none());
}

#[test]
fn writing_data_survives_save_and_reopen() {
    let dir = temp_dir("writing-data");
    let path = dir.join("Writing.scri");

    let mut p = fresh_project();
    let id = add_doc(&mut p, "Scene", "Hola mundo cruel.");
    let comment_id = Uuid::new_v4();
    {
        let doc = p.get_mut(id).unwrap();
        doc.word_goal = 1500;
        doc.content = RichDoc {
            blocks: vec![Block::Paragraph {
                attrs: ParaAttrs::default(),
                spans: vec![
                    Span { text: "Hola ".into(), marks: vec![] },
                    Span { text: "mundo".into(), marks: vec![Mark::Comment { id: comment_id }] },
                    Span { text: " cruel.".into(), marks: vec![] },
                ],
            }],
        };
        doc.comments.push(Comment {
            id: comment_id,
            text: "¿Otro adjetivo?".into(),
            resolved: false,
            created_at: Utc::now(),
            modified_at: Utc::now(),
        });
        doc.touch();
    }
    p.take_snapshot(id, "Antes").unwrap();
    p.dictionary.insert("Eldoria".into());
    p.stats.record(scribeforge_lib::writing::stats::today(), 250);
    p.stats.record(scribeforge_lib::writing::stats::today() - Duration::days(1), 100);
    p.manifest.config.project_word_goal = 80_000;
    p.manifest.config.session_word_goal = 1_000;
    p.manifest.config.deadline = Some(d("2027-03-01"));
    p.manifest.config.spell_language = "es,en".into();

    write_project_to_path(&p, &path).unwrap();
    let r = read_project_from_path(&path).unwrap();

    let doc = r.get(id).unwrap();
    assert_eq!(doc.word_goal, 1500);
    assert_eq!(doc.comments.len(), 1);
    assert_eq!(doc.comments[0].text, "¿Otro adjetivo?");
    match &doc.content.blocks[0] {
        Block::Paragraph { spans, .. } => assert_eq!(spans[1].marks, vec![Mark::Comment { id: comment_id }]),
        other => panic!("unexpected block {other:?}"),
    }
    assert_eq!(r.list_snapshots(id).len(), 1);
    assert_eq!(r.list_snapshots(id)[0].name, "Antes");
    assert!(r.dictionary.contains("Eldoria"));
    assert_eq!(r.stats.days.len(), 2);
    assert_eq!(r.stats.current_streak(scribeforge_lib::writing::stats::today()), 2);
    assert_eq!(r.manifest.config.project_word_goal, 80_000);
    assert_eq!(r.manifest.config.deadline, Some(d("2027-03-01")));
    assert_eq!(r.manifest.config.spell_language, "es,en");
    // The session is not saved: it starts again on open.
    assert_eq!(r.session.added, 0);

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn projects_without_writing_data_still_open() {
    // A project saved before these features existed has none of the new
    // entries or fields; it must open with empty defaults.
    let dir = temp_dir("writing-old");
    let path = dir.join("Old.scri");
    let p = fresh_project();
    write_project_to_path(&p, &path).unwrap();
    let r = read_project_from_path(&path).unwrap();
    assert!(r.snapshots.is_empty() && r.dictionary.is_empty() && r.stats.days.is_empty());
    assert_eq!(r.manifest.config.spell_language, "es");
    assert_eq!(r.manifest.config.deadline, None);
    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn find_and_replace_across_the_project() {
    let mut p = fresh_project();
    let a = add_doc(&mut p, "A", "El gato negro. Otro gato.");
    let b = add_doc(&mut p, "B gato", "Un Gato pardo.");
    let trashed = add_doc(&mut p, "C", "gato en la papelera");
    p.move_to_trash(trashed).unwrap();

    let found = replace::find(&p, &options("gato"), Some("perro")).unwrap();
    assert_eq!(found.matches.len(), 3, "trash is excluded, titles are not searched");
    assert_eq!(found.documents, 2);
    assert!(found.matches.iter().all(|m| m.replacement.as_deref() == Some("perro")));

    // Replace everything except the second match of document A.
    let skip = found.matches.iter().filter(|m| m.document_id == a).nth(1).unwrap().id.clone();
    let keep: HashSet<String> = found.matches.iter().map(|m| m.id.clone()).filter(|i| *i != skip).collect();
    let res = replace::replace(&mut p, &options("gato"), "perro", Some(&keep)).unwrap();
    assert_eq!(res.replaced, 2);
    assert_eq!(p.get(a).unwrap().content.plain_text().trim(), "El perro negro. Otro gato.");
    assert_eq!(p.get(b).unwrap().content.plain_text().trim(), "Un perro pardo.");
    assert_eq!(p.get(b).unwrap().title, "B gato");
    assert!(p.get(trashed).unwrap().content.plain_text().contains("gato"));

    // Regex with capture groups, also in titles.
    let mut o = options(r"(\w+) gato");
    o.regex = true;
    o.in_titles = true;
    let res = replace::replace(&mut p, &o, "gato $1", None).unwrap();
    assert_eq!(res.replaced, 2);
    assert_eq!(p.get(a).unwrap().content.plain_text().trim(), "El perro negro. gato Otro.");
    assert_eq!(p.get(b).unwrap().title, "gato B");

    // A literal "$1" stays literal outside regex mode.
    replace::replace(&mut p, &options("pardo"), "$1", None).unwrap();
    assert_eq!(p.get(b).unwrap().content.plain_text().trim(), "Un perro $1.");
}
