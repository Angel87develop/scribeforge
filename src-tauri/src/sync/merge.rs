//! Combining two versions of the same project, document by document.
//!
//! "Local" is the project open on this computer; "remote" is the version
//! that arrived on disk from another computer (or a conflict copy made by the
//! cloud client). "Base" is what both started from: the fingerprints of the
//! version this computer last read or wrote. With a base, a document that
//! changed on one side only is taken from that side without asking; only a
//! document changed on both sides needs the user's choice. Without a base
//! (a conflict copy of unknown origin) nothing is ever deleted: documents
//! present on one side only are kept, and differing documents are offered
//! for a choice with the newer one preselected.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::project::document::{Document, DocumentKind};
use crate::project::model::Project;
use crate::writing::snapshots::Snapshot;

type Fp = u64;

fn fp<T: Serialize + ?Sized>(value: &T) -> Fp {
    let bytes = serde_json::to_vec(value).unwrap_or_default();
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

/// Fingerprints of the parts of a project that can change independently.
/// Only compared within one run of the app, so a process-local hash is fine.
#[derive(Debug, Clone, Default)]
pub struct Fingerprints {
    docs: HashMap<Uuid, Fp>,
    meta: Fp,
    collections: Fp,
    timeline: Fp,
}

/// Name, author and settings: the manifest without its timestamps, which
/// change on every save.
fn meta_fp(p: &Project) -> Fp {
    fp(&(&p.manifest.name, &p.manifest.author, &p.manifest.config))
}

pub fn fingerprints(p: &Project) -> Fingerprints {
    Fingerprints {
        docs: p.documents.iter().map(|(id, d)| (*id, fp(d))).collect(),
        meta: meta_fp(p),
        collections: fp(&p.collections),
        timeline: fp(&p.timeline),
    }
}

/// Which side a document changed on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Change {
    LocalOnly,
    RemoteOnly,
    Both,
}

/// What to keep for a document changed on both sides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Side {
    Local,
    Remote,
    /// Keep this computer's version and store the other one as a snapshot.
    Both,
}

#[derive(Debug, Clone, Serialize)]
pub struct MergeItem {
    pub id: Uuid,
    pub title: String,
    pub change: Change,
    /// Preselected choice for `Change::Both`: the newer version.
    pub suggested: Side,
    /// The document no longer exists on this computer / on the other one.
    pub local_deleted: bool,
    pub remote_deleted: bool,
    /// Both versions have text, so they can be compared.
    pub comparable: bool,
}

/// Documents that differ between `local` and `remote`, ordered by title.
pub fn plan(local: &Project, remote: &Project, base: Option<&Fingerprints>) -> Vec<MergeItem> {
    let ids: HashSet<Uuid> = local.documents.keys().chain(remote.documents.keys()).copied().collect();
    let mut items = Vec::new();
    for id in ids {
        let l = local.documents.get(&id);
        let r = remote.documents.get(&id);
        let lf = l.map(fp);
        let rf = r.map(fp);
        if lf == rf {
            continue;
        }
        let change = match base {
            Some(b) => {
                let bf = b.docs.get(&id).copied();
                match (lf != bf, rf != bf) {
                    (true, false) => Change::LocalOnly,
                    (false, true) => Change::RemoteOnly,
                    _ => Change::Both,
                }
            }
            // No common origin: a one-sided document is an addition, never a
            // deletion.
            None => match (l, r) {
                (Some(_), None) => Change::LocalOnly,
                (None, Some(_)) => Change::RemoteOnly,
                _ => Change::Both,
            },
        };
        let suggested = match (l, r) {
            (Some(_), None) => Side::Local,
            (None, Some(_)) => Side::Remote,
            (Some(a), Some(b)) if b.modified_at > a.modified_at => Side::Remote,
            _ => Side::Local,
        };
        let title = r.or(l).map(|d| d.title.clone()).unwrap_or_default();
        items.push(MergeItem {
            id,
            title,
            change,
            suggested,
            local_deleted: l.is_none(),
            remote_deleted: r.is_none(),
            comparable: l.zip(r).is_some_and(|(a, b)| !is_container(a) && !is_container(b)),
        });
    }
    items.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    items
}

fn is_container(d: &Document) -> bool {
    matches!(
        d.kind,
        DocumentKind::Folder | DocumentKind::DraftRoot | DocumentKind::ResearchRoot | DocumentKind::TrashRoot
    )
}

/// Build the combined project. `choices` decides documents changed on both
/// sides (missing entries use the suggestion); with `Side::Both` the other
/// computer's text is kept as a snapshot named `snapshot_label`.
pub fn apply(
    local: &Project,
    remote: &Project,
    base: Option<&Fingerprints>,
    choices: &HashMap<Uuid, Side>,
    snapshot_label: &str,
) -> Project {
    let mut out = local.clone();

    for item in plan(local, remote, base) {
        let side = match item.change {
            Change::LocalOnly => Side::Local,
            Change::RemoteOnly => Side::Remote,
            Change::Both => choices.get(&item.id).copied().unwrap_or(item.suggested),
        };
        let theirs = remote.documents.get(&item.id);
        match side {
            Side::Local => {}
            Side::Remote => match theirs {
                Some(d) => {
                    out.documents.insert(item.id, d.clone());
                }
                None => {
                    out.documents.remove(&item.id);
                }
            },
            Side::Both => match (out.documents.contains_key(&item.id), theirs) {
                (true, Some(d)) if !is_container(d) => {
                    let snap = Snapshot::new(item.id, snapshot_label, &d.title, &d.content);
                    out.snapshots.entry(item.id).or_default().push(snap);
                }
                (false, Some(d)) => {
                    out.documents.insert(item.id, d.clone());
                }
                _ => {}
            },
        }
    }

    // Snapshots are only ever added, so both sides' lists are combined.
    for (doc, list) in &remote.snapshots {
        let mine = out.snapshots.entry(*doc).or_default();
        let known: HashSet<Uuid> = mine.iter().map(|s| s.id).collect();
        mine.extend(list.iter().filter(|s| !known.contains(&s.id)).cloned());
        mine.sort_by(|a, b| a.created_at.cmp(&b.created_at));
    }

    // Image bytes for attachments that came with the other computer's
    // documents.
    for (id, asset) in &remote.assets {
        out.assets.entry(*id).or_insert_with(|| asset.clone());
    }

    for word in &remote.dictionary {
        out.dictionary.insert(word.clone());
    }

    // Words written per day: each computer counted its own writing.
    for (day, theirs) in &remote.stats.days {
        let mine = out.stats.days.entry(*day).or_default();
        mine.added = mine.added.max(theirs.added);
        mine.removed = mine.removed.max(theirs.removed);
    }

    // Name and settings, collections and timeline: taken from the other
    // computer when only it changed them.
    if let Some(b) = base {
        if meta_fp(remote) != b.meta && meta_fp(local) == b.meta {
            out.manifest.name = remote.manifest.name.clone();
            out.manifest.author = remote.manifest.author.clone();
            out.manifest.config = remote.manifest.config.clone();
        }
        if fp(&remote.collections) != b.collections && fp(&local.collections) == b.collections {
            out.collections = remote.collections.clone();
        }
        if fp(&remote.timeline) != b.timeline && fp(&local.timeline) == b.timeline {
            out.timeline = remote.timeline.clone();
        }
    }

    repair_tree(&mut out);
    out
}

/// Put documents whose parent is gone (or that ended up in a loop because
/// each computer moved one into the other) back under the Manuscript, then
/// make sibling order contiguous again.
fn repair_tree(p: &mut Project) {
    let draft = p.root_id(DocumentKind::DraftRoot);
    let ids: Vec<Uuid> = p.documents.keys().copied().collect();
    let limit = ids.len();

    for id in &ids {
        let is_root = p.is_root(*id);
        let doc = &p.documents[id];
        let broken = if is_root {
            doc.parent.is_some()
        } else {
            match doc.parent {
                None => true,
                Some(parent) => !p.documents.contains_key(&parent) || in_loop(p, *id, limit),
            }
        };
        if broken {
            let fallback = if is_root { None } else { draft };
            if let Some(d) = p.documents.get_mut(id) {
                d.parent = fallback;
                d.order = i32::MAX;
            }
        }
    }

    let parents: HashSet<Option<Uuid>> = p.documents.values().map(|d| d.parent).collect();
    for parent in parents {
        p.renumber_siblings(parent);
    }
}

fn in_loop(p: &Project, id: Uuid, limit: usize) -> bool {
    let mut current = p.documents.get(&id).and_then(|d| d.parent);
    for _ in 0..=limit {
        match current {
            None => return false,
            Some(c) if c == id => return true,
            Some(c) => current = p.documents.get(&c).and_then(|d| d.parent),
        }
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::document::RichDoc;
    use crate::project::manifest::Manifest;

    fn project() -> (Project, Uuid) {
        let manifest = Manifest::new("Novel".into(), None, "blank".into(), "fiction".into());
        let mut p = Project::new(manifest);
        let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
        let ch = p.create_child(draft, DocumentKind::Document, "Chapter 1").unwrap();
        (p, ch)
    }

    fn edit(p: &mut Project, id: Uuid, text: &str) {
        let d = p.get_mut(id).unwrap();
        d.content = RichDoc::from_paragraph(text);
        d.touch();
    }

    #[test]
    fn one_sided_changes_merge_without_asking() {
        let (base_p, ch) = project();
        let base = fingerprints(&base_p);
        let mut local = base_p.clone();
        let mut remote = base_p.clone();
        let draft = local.root_id(DocumentKind::DraftRoot).unwrap();
        let mine = local.create_child(draft, DocumentKind::Document, "Mine").unwrap();
        edit(&mut remote, ch, "written elsewhere");

        let items = plan(&local, &remote, Some(&base));
        assert!(items.iter().all(|i| i.change != Change::Both));

        let merged = apply(&local, &remote, Some(&base), &HashMap::new(), "other");
        assert!(merged.documents.contains_key(&mine));
        assert_eq!(merged.documents[&ch].content.plain_text().trim(), "written elsewhere");
    }

    #[test]
    fn both_sides_keep_other_as_snapshot() {
        let (base_p, ch) = project();
        let base = fingerprints(&base_p);
        let mut local = base_p.clone();
        let mut remote = base_p.clone();
        edit(&mut local, ch, "here");
        edit(&mut remote, ch, "there");

        let items = plan(&local, &remote, Some(&base));
        let item = items.iter().find(|i| i.id == ch).unwrap();
        assert_eq!(item.change, Change::Both);

        let choices = HashMap::from([(ch, Side::Both)]);
        let merged = apply(&local, &remote, Some(&base), &choices, "From laptop");
        assert_eq!(merged.documents[&ch].content.plain_text().trim(), "here");
        let snaps = &merged.snapshots[&ch];
        assert_eq!(snaps.len(), 1);
        assert_eq!(snaps[0].name, "From laptop");
        assert_eq!(snaps[0].content.plain_text().trim(), "there");
    }

    #[test]
    fn remote_deletion_applies_only_with_a_base() {
        let (base_p, ch) = project();
        let base = fingerprints(&base_p);
        let local = base_p.clone();
        let mut remote = base_p.clone();
        remote.documents.remove(&ch);

        let merged = apply(&local, &remote, Some(&base), &HashMap::new(), "x");
        assert!(!merged.documents.contains_key(&ch));

        // A conflict copy without a known base never deletes.
        let merged = apply(&local, &remote, None, &HashMap::new(), "x");
        assert!(merged.documents.contains_key(&ch));
    }

    #[test]
    fn orphans_return_to_the_manuscript() {
        let (base_p, ch) = project();
        let base = fingerprints(&base_p);
        let draft = base_p.root_id(DocumentKind::DraftRoot).unwrap();
        let mut local = base_p.clone();
        let folder = local.create_child(draft, DocumentKind::Folder, "Part").unwrap();
        local.move_node(ch, folder, 0).unwrap();
        // The other computer never had the folder, and edited the chapter;
        // keeping its version of the chapter would point at a missing
        // parent only if the folder were dropped — drop it to test repair.
        let mut remote = base_p.clone();
        edit(&mut remote, ch, "edited");
        let mut merged = apply(&local, &remote, Some(&base), &HashMap::from([(ch, Side::Local)]), "x");
        merged.documents.remove(&folder);
        repair_tree(&mut merged);
        assert_eq!(merged.documents[&ch].parent, Some(draft));
    }
}
