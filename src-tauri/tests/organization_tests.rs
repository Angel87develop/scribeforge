//! Integration tests for the organisation tools: collections and saved
//! searches, label and status renames, wiki links and backlinks, sheets,
//! the timeline and freeform card positions — including persistence in the
//! `.scri` file and clean-up when documents are purged.

use scribeforge_lib::organization::collections::{self, Collection, CollectionKind, CollectionQuery};
use scribeforge_lib::organization::labels::{self, Rename};
use scribeforge_lib::organization::links;
use scribeforge_lib::organization::timeline::TimelineEvent;
use scribeforge_lib::project::document::{CardPos, DocumentKind, RichDoc, Sheet, SheetField, SheetRelation};
use scribeforge_lib::project::manifest::ColorDef;
use scribeforge_lib::project::model::Project;
use scribeforge_lib::storage::{read_project_from_path, write_project_to_path};
use scribeforge_lib::templates::build_project_from_template;
use uuid::Uuid;

fn temp_dir(tag: &str) -> std::path::PathBuf {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("{}-{}", tag, std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fresh() -> Project {
    build_project_from_template("blank/blank", "Org".into(), None).unwrap()
}

fn add(p: &mut Project, root: DocumentKind, title: &str, text: &str, status: &str, label: &str) -> Uuid {
    let parent = p.root_id(root).unwrap();
    let kind = if root == DocumentKind::ResearchRoot { DocumentKind::Research } else { DocumentKind::Document };
    let id = p.create_child(parent, kind, title).unwrap();
    let d = p.get_mut(id).unwrap();
    d.content = RichDoc::from_paragraph(text);
    d.status = status.into();
    d.labels = if label.is_empty() { vec![] } else { vec![label.into(), "misterio".into()] };
    d.touch();
    id
}

fn search(q: CollectionQuery) -> Collection {
    Collection { id: Uuid::new_v4(), name: "S".into(), color: String::new(), kind: CollectionKind::Search, items: vec![], query: q }
}

#[test]
fn saved_searches_and_manual_collections() {
    let mut p = fresh();
    let a = add(&mut p, DocumentKind::DraftRoot, "Cap 1", "El faro de noche.", "First Draft", "Chapter");
    let b = add(&mut p, DocumentKind::DraftRoot, "Cap 2", "La playa.", "Revised", "Chapter");
    let c = add(&mut p, DocumentKind::DraftRoot, "Cap 3", "Otro faro.", "First Draft", "Scene");
    let ana = add(&mut p, DocumentKind::ResearchRoot, "Ana", "Farera.", "To Do", "Character");
    p.get_mut(ana).unwrap().sheet = Some(Sheet { kind: "character".into(), ..Default::default() });

    let ids = |v: Vec<scribeforge_lib::project::document::DocumentMetaDto>| v.into_iter().map(|m| m.id).collect::<Vec<_>>();

    let drafts = search(CollectionQuery { status: "first draft".into(), scope: "manuscript".into(), documents_only: true, ..Default::default() });
    assert_eq!(ids(collections::items(&p, &drafts)), vec![a, c]);

    let faro = search(CollectionQuery { text: "FARO".into(), scope: "all".into(), documents_only: true, ..Default::default() });
    assert_eq!(ids(collections::items(&p, &faro)), vec![a, c]);

    let chapters = search(CollectionQuery { label: "Chapter".into(), keyword: "miste".into(), scope: "all".into(), documents_only: true, ..Default::default() });
    assert_eq!(ids(collections::items(&p, &chapters)), vec![a, b]);

    let characters = search(CollectionQuery { sheet: "character".into(), scope: "all".into(), documents_only: true, ..Default::default() });
    assert_eq!(ids(collections::items(&p, &characters)), vec![ana]);

    // Manual collection keeps its own order; trashed and purged items vanish.
    let mut manual = Collection { id: Uuid::new_v4(), name: "Favs".into(), color: String::new(), kind: CollectionKind::Manual, items: vec![c, a, b], query: Default::default() };
    manual.sanitize();
    p.collections.push(manual.clone());
    assert_eq!(ids(collections::items(&p, &manual)), vec![c, a, b]);
    p.move_to_trash(a).unwrap();
    assert_eq!(ids(collections::items(&p, &p.collections[0])), vec![c, b]);
    p.purge_subtree(a).unwrap();
    assert_eq!(p.collections[0].items, vec![c, b]);
}

#[test]
fn renaming_labels_and_statuses_updates_documents() {
    let mut p = fresh();
    let a = add(&mut p, DocumentKind::DraftRoot, "A", "", "First Draft", "Chapter");
    let b = add(&mut p, DocumentKind::DraftRoot, "B", "", "Revised", "Scene");
    let n = labels::apply_renames(
        &mut p,
        &[
            Rename { kind: "label".into(), from: "Chapter".into(), to: "Capítulo".into() },
            Rename { kind: "status".into(), from: "First Draft".into(), to: "Borrador".into() },
        ],
    );
    // A, plus the three roots, whose default status is First Draft.
    assert_eq!(n, 4);
    assert_eq!(p.get(a).unwrap().labels[0], "Capítulo");
    assert_eq!(p.get(a).unwrap().labels[1], "misterio", "keywords untouched");
    assert_eq!(p.get(a).unwrap().status, "Borrador");
    assert_eq!(p.get(b).unwrap().labels[0], "Scene");

    let cleaned = labels::clean(vec![
        ColorDef { name: " Uno ".into(), color: "#AABBCC".into() },
        ColorDef { name: "uno".into(), color: "#000000".into() },
        ColorDef { name: "".into(), color: "#000000".into() },
        ColorDef { name: "Dos".into(), color: "red".into() },
    ]);
    assert_eq!(cleaned.len(), 2);
    assert_eq!(cleaned[0].name, "Uno");
    assert_eq!(cleaned[0].color, "#aabbcc");
    assert_eq!(cleaned[1].color, "#9a948a");
}

#[test]
fn wiki_links_and_backlinks() {
    let mut p = fresh();
    let ana = add(&mut p, DocumentKind::ResearchRoot, "Ana Ruiz", "La farera.", "", "");
    let faro = add(&mut p, DocumentKind::ResearchRoot, "El Faro", "Allí vive [[ana ruiz]].", "", "");
    let cap = add(&mut p, DocumentKind::DraftRoot, "Cap 1", "[[Ana Ruiz|Ana]] subió al [[El Faro]] y vio a [[Nadie]].", "", "");
    let luis = add(&mut p, DocumentKind::ResearchRoot, "Luis", "", "", "");
    p.get_mut(luis).unwrap().sheet = Some(Sheet {
        kind: "character".into(),
        fields: vec![],
        relations: vec![SheetRelation { target: ana, label: "hermano de".into() }],
    });

    let out = links::links_of(&p, cap).outgoing;
    assert_eq!(out.len(), 3);
    assert_eq!(out[0].target, Some(ana));
    assert_eq!(out[1].target, Some(faro));
    assert_eq!(out[2].title, "Nadie");
    assert_eq!(out[2].target, None);

    let back = links::links_of(&p, ana).backlinks;
    let from: Vec<(Uuid, &str)> = back.iter().map(|b| (b.id, b.via.as_str())).collect();
    assert!(from.contains(&(faro, "link")));
    assert!(from.contains(&(cap, "link")));
    assert!(from.contains(&(luis, "relation")));
    assert!(back.iter().any(|b| b.context.contains("[[Ana Ruiz|Ana]]")));

    // A trashed document is not a link target and gives no backlinks.
    p.move_to_trash(faro).unwrap();
    assert_eq!(links::resolve(&p, "El Faro"), None);
    assert!(!links::links_of(&p, ana).backlinks.iter().any(|b| b.id == faro));
}

#[test]
fn organisation_data_survives_save_and_reopen() {
    let dir = temp_dir("organization");
    let path = dir.join("Org.scri");
    let mut p = fresh();
    let scene = add(&mut p, DocumentKind::DraftRoot, "Escena", "Texto.", "First Draft", "Scene");
    let ana = add(&mut p, DocumentKind::ResearchRoot, "Ana", "", "", "Character");
    {
        let d = p.get_mut(ana).unwrap();
        d.sheet = Some(Sheet {
            kind: "character".into(),
            fields: vec![SheetField { label: "Edad".into(), value: "34".into() }],
            relations: vec![SheetRelation { target: scene, label: "aparece en".into() }],
        });
        d.card_pos = Some(CardPos { x: 120.0, y: 48.5 });
    }
    p.collections.push(search(CollectionQuery { status: "First Draft".into(), scope: "all".into(), documents_only: true, ..Default::default() }));
    let ev = TimelineEvent {
        id: Uuid::new_v4(),
        title: "La tormenta".into(),
        date: "Day 3".into(),
        time: "21:00".into(),
        description: "".into(),
        track: "Ana".into(),
        color: "#3c7cc0".into(),
        document: Some(scene),
        characters: vec![ana],
    };
    p.timeline.push(ev.clone());
    p.manifest.config.labels.push(ColorDef { name: "Flashback".into(), color: "#123456".into() });

    write_project_to_path(&p, &path).unwrap();
    let mut r = read_project_from_path(&path).unwrap();

    let d = r.get(ana).unwrap();
    assert_eq!(d.sheet.as_ref().unwrap().fields[0].value, "34");
    assert_eq!(d.sheet.as_ref().unwrap().relations[0].target, scene);
    assert_eq!(d.card_pos, Some(CardPos { x: 120.0, y: 48.5 }));
    assert_eq!(r.collections.len(), 1);
    assert_eq!(r.collections[0].query.status, "First Draft");
    assert_eq!(r.timeline, vec![ev]);
    assert!(r.manifest.config.labels.iter().any(|l| l.name == "Flashback"));
    assert_eq!(r.manifest.config.statuses.len(), 5);

    // Purging the scene and the character clears the timeline references.
    r.move_to_trash(scene).unwrap();
    r.purge_subtree(scene).unwrap();
    r.move_to_trash(ana).unwrap();
    r.purge_subtree(ana).unwrap();
    assert_eq!(r.timeline[0].document, None);
    assert!(r.timeline[0].characters.is_empty());

    std::fs::remove_dir_all(&dir).ok();
}
