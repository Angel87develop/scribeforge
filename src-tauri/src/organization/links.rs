//! Wiki-style links between documents: `[[Title]]` or `[[Title|shown text]]`
//! typed anywhere in a document's text. A link points to the document with
//! that title (ignoring case and surrounding spaces; the Trash is skipped).
//! Backlinks are the documents whose text links to a given document; sheet
//! relationships ("sister of…") are reported alongside them.

use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;
use uuid::Uuid;

use crate::project::document::Document;
use crate::project::model::Project;

fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"\[\[([^\[\]|\n]+)(?:\|([^\[\]\n]*))?\]\]").expect("valid link regex"))
}

/// The link targets written in a text, in order of appearance, without
/// duplicates.
pub fn link_targets(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for c in link_re().captures_iter(text) {
        let t = c[1].trim().to_string();
        if !t.is_empty() && !out.iter().any(|o| o.eq_ignore_ascii_case(&t)) {
            out.push(t);
        }
    }
    out
}

fn norm(s: &str) -> String {
    s.trim().to_lowercase()
}

/// The document a link title points to.
pub fn resolve(project: &Project, title: &str) -> Option<Uuid> {
    let t = norm(title);
    let mut candidates: Vec<&Document> = project
        .documents
        .values()
        .filter(|d| norm(&d.title) == t && !project.in_trash(d.id) && !project.is_root(d.id))
        .collect();
    // Stable choice when two documents share a title: the oldest.
    candidates.sort_by_key(|d| d.created_at);
    candidates.first().map(|d| d.id)
}

#[derive(Debug, Clone, Serialize)]
pub struct OutgoingLink {
    pub title: String,
    /// None when no document has that title.
    pub target: Option<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct Backlink {
    pub id: Uuid,
    pub title: String,
    /// "link" (from the text) or "relation" (from a sheet).
    pub via: String,
    /// The sentence around the link, or the relationship's label.
    pub context: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct LinksDto {
    pub outgoing: Vec<OutgoingLink>,
    pub backlinks: Vec<Backlink>,
}

fn context_around(text: &str, start: usize, end: usize) -> String {
    let before: Vec<char> = text[..start].chars().collect();
    let after: Vec<char> = text[end..].chars().collect();
    let from = before.len().saturating_sub(50);
    let to = after.len().min(50);
    let mut s = String::new();
    if from > 0 {
        s.push('…');
    }
    s.extend(&before[from..]);
    s.push_str(&text[start..end]);
    s.extend(&after[..to]);
    if to < after.len() {
        s.push('…');
    }
    s.replace('\n', " ")
}

pub fn links_of(project: &Project, id: Uuid) -> LinksDto {
    let Some(doc) = project.get(id) else {
        return LinksDto { outgoing: Vec::new(), backlinks: Vec::new() };
    };
    let outgoing = link_targets(&doc.content.plain_text())
        .into_iter()
        .map(|title| OutgoingLink { target: resolve(project, &title), title })
        .collect();

    let me = norm(&doc.title);
    let mut backlinks = Vec::new();
    for meta in project.binder_listing() {
        if meta.in_trash || meta.id == id {
            continue;
        }
        let Some(other) = project.get(meta.id) else { continue };
        let text = other.content.plain_text();
        if let Some(c) = link_re().captures_iter(&text).find(|c| norm(&c[1]) == me) {
            let m = c.get(0).expect("whole match");
            backlinks.push(Backlink {
                id: other.id,
                title: other.title.clone(),
                via: "link".into(),
                context: context_around(&text, m.start(), m.end()),
            });
        }
        if let Some(sheet) = &other.sheet {
            for r in sheet.relations.iter().filter(|r| r.target == id) {
                backlinks.push(Backlink {
                    id: other.id,
                    title: other.title.clone(),
                    via: "relation".into(),
                    context: r.label.clone(),
                });
            }
        }
    }
    LinksDto { outgoing, backlinks }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_links_with_aliases() {
        let t = "Vio a [[Ana]] y a [[ana]] en [[El Faro|el faro viejo]]. [[ ]] y [no] [[Roto";
        assert_eq!(link_targets(t), vec!["Ana".to_string(), "El Faro".to_string()]);
    }
}
