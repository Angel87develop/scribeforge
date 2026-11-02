//! Project-wide find and replace, with optional regular expressions.
//!
//! Text is searched per "unit": each paragraph, heading, quote, list item
//! and code block of a document, plus (optionally) its title, synopsis and
//! notes. A match never crosses two units. Inside a unit the spans are
//! joined, so a match can cover several differently formatted spans; the
//! replacement takes the formatting of the span where the match starts.
//!
//! Every match gets a stable id (`document:field:block:item:offset`), so the
//! interface can preview all matches and replace only the ones the user kept
//! ticked. Replacing re-runs the search and applies the selected matches
//! from the end of each unit backwards, so earlier offsets stay valid.

use std::collections::HashSet;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::project::document::{Block, Document, Span};
use crate::project::model::Project;

/// Stop collecting matches past this many (the preview would be unusable).
pub const MAX_MATCHES: usize = 5000;
const CONTEXT_CHARS: usize = 40;

fn default_true() -> bool {
    true
}

#[derive(Debug, Clone, Deserialize)]
pub struct FindOptions {
    pub query: String,
    #[serde(default)]
    pub regex: bool,
    #[serde(default)]
    pub case_sensitive: bool,
    #[serde(default)]
    pub whole_word: bool,
    #[serde(default = "default_true")]
    pub in_text: bool,
    #[serde(default)]
    pub in_titles: bool,
    #[serde(default)]
    pub in_synopsis: bool,
    #[serde(default)]
    pub in_notes: bool,
    /// Limit the search to these documents; empty searches the project.
    #[serde(default)]
    pub documents: Vec<Uuid>,
}

#[derive(Debug, Clone, Serialize)]
pub struct FindMatch {
    pub id: String,
    pub document_id: Uuid,
    pub document_title: String,
    /// "text", "title", "synopsis" or "notes".
    pub field: String,
    pub before: String,
    pub matched: String,
    /// What the match would become, when a replacement was given.
    pub replacement: Option<String>,
    pub after: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FindResult {
    pub matches: Vec<FindMatch>,
    pub documents: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct ReplaceResult {
    pub replaced: usize,
    pub documents: Vec<Uuid>,
}

/// Build the search pattern. Plain queries are escaped; "whole word" wraps
/// the pattern in Unicode word boundaries.
pub fn build_regex(opts: &FindOptions) -> Result<Regex, String> {
    if opts.query.is_empty() {
        return Err("the search text is empty".into());
    }
    let core = if opts.regex { opts.query.clone() } else { regex::escape(&opts.query) };
    let pattern = if opts.whole_word { format!(r"\b(?:{core})\b") } else { core };
    RegexBuilder::new(&pattern)
        .case_insensitive(!opts.case_sensitive)
        .size_limit(1 << 20)
        .build()
        .map_err(|e| format!("invalid regular expression: {e}"))
}

/// Replacement text for one match: `$1` / `${name}` expand in regex mode,
/// everything is literal otherwise.
fn replacement_for(re: &Regex, opts: &FindOptions, unit: &str, start: usize, replacement: &str) -> String {
    if !opts.regex {
        return replacement.to_string();
    }
    match re.captures_at(unit, start) {
        Some(caps) => {
            let mut out = String::new();
            caps.expand(replacement, &mut out);
            out
        }
        None => replacement.to_string(),
    }
}

/// Where a unit lives inside a document.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Field {
    Text { block: usize, item: usize },
    Title,
    Synopsis,
    Notes,
}

impl Field {
    fn name(&self) -> &'static str {
        match self {
            Field::Text { .. } => "text",
            Field::Title => "title",
            Field::Synopsis => "synopsis",
            Field::Notes => "notes",
        }
    }
    fn id_part(&self) -> String {
        match self {
            Field::Text { block, item } => format!("text:{block}:{item}"),
            other => format!("{}:0:0", other.name()),
        }
    }
}

fn spans_text(spans: &[Span]) -> String {
    spans.iter().map(|s| s.text.as_str()).collect()
}

/// Every searchable unit of a document, with its text.
fn units(doc: &Document, opts: &FindOptions) -> Vec<(Field, String)> {
    let mut out = Vec::new();
    if opts.in_titles {
        out.push((Field::Title, doc.title.clone()));
    }
    if opts.in_text {
        for (b, block) in doc.content.blocks.iter().enumerate() {
            match block {
                Block::Paragraph { spans, .. } | Block::Heading { spans, .. } | Block::BlockQuote { spans, .. } => {
                    out.push((Field::Text { block: b, item: 0 }, spans_text(spans)));
                }
                Block::ListOrdered { items } | Block::ListUnordered { items } => {
                    for (i, item) in items.iter().enumerate() {
                        out.push((Field::Text { block: b, item: i }, spans_text(&item.spans)));
                    }
                }
                Block::CodeBlock { text } => out.push((Field::Text { block: b, item: 0 }, text.clone())),
                Block::Divider => {}
            }
        }
    }
    if opts.in_synopsis {
        out.push((Field::Synopsis, doc.synopsis.clone()));
    }
    if opts.in_notes {
        out.push((Field::Notes, doc.notes.clone()));
    }
    out
}

fn context_before(s: &str, end: usize) -> String {
    let head = &s[..end];
    let chars: Vec<char> = head.chars().collect();
    let from = chars.len().saturating_sub(CONTEXT_CHARS);
    let prefix = if from > 0 { "…" } else { "" };
    format!("{prefix}{}", chars[from..].iter().collect::<String>()).replace('\n', " ")
}

fn context_after(s: &str, start: usize) -> String {
    let tail = &s[start..];
    let mut out: String = tail.chars().take(CONTEXT_CHARS).collect();
    if tail.chars().count() > CONTEXT_CHARS {
        out.push('…');
    }
    out.replace('\n', " ")
}

/// Documents that take part in a search, in binder order, Trash excluded.
fn searchable_docs<'a>(project: &'a Project, opts: &FindOptions) -> Vec<&'a Document> {
    let only: HashSet<Uuid> = opts.documents.iter().copied().collect();
    project
        .binder_listing()
        .into_iter()
        .filter(|m| !m.in_trash)
        .filter(|m| only.is_empty() || only.contains(&m.id))
        .filter_map(|m| project.get(m.id))
        .collect()
}

pub fn find(project: &Project, opts: &FindOptions, replacement: Option<&str>) -> Result<FindResult, String> {
    let re = build_regex(opts)?;
    let mut matches = Vec::new();
    let mut docs_hit = HashSet::new();
    let mut truncated = false;

    'docs: for doc in searchable_docs(project, opts) {
        for (field, text) in units(doc, opts) {
            for m in re.find_iter(&text) {
                if m.start() == m.end() {
                    continue;
                }
                if matches.len() >= MAX_MATCHES {
                    truncated = true;
                    break 'docs;
                }
                docs_hit.insert(doc.id);
                matches.push(FindMatch {
                    id: format!("{}:{}:{}", doc.id, field.id_part(), m.start()),
                    document_id: doc.id,
                    document_title: doc.title.clone(),
                    field: field.name().to_string(),
                    before: context_before(&text, m.start()),
                    matched: m.as_str().to_string(),
                    replacement: replacement.map(|r| replacement_for(&re, opts, &text, m.start(), r)),
                    after: context_after(&text, m.end()),
                });
            }
        }
    }
    Ok(FindResult { documents: docs_hit.len(), matches, truncated })
}

/// Replace the byte range `start..end` of the joined span text with `with`,
/// keeping the formatting of the span where the range starts.
pub fn splice_spans(spans: &mut Vec<Span>, start: usize, end: usize, with: &str) {
    let mut out: Vec<Span> = Vec::with_capacity(spans.len() + 1);
    let mut offset = 0usize;
    let mut inserted = false;
    spans.retain(|s| !s.text.is_empty());
    for span in spans.drain(..) {
        let s0 = offset;
        let s1 = offset + span.text.len();
        offset = s1;
        // Entirely before or after the replaced range: keep as is.
        if s1 <= start || s0 >= end {
            out.push(span);
            continue;
        }
        let before = if start > s0 { &span.text[..start - s0] } else { "" };
        let after = if end < s1 { &span.text[end - s0..] } else { "" };
        if !before.is_empty() {
            out.push(Span { text: before.to_string(), marks: span.marks.clone() });
        }
        if !inserted {
            out.push(Span { text: with.to_string(), marks: span.marks.clone() });
            inserted = true;
        }
        if !after.is_empty() {
            out.push(Span { text: after.to_string(), marks: span.marks.clone() });
        }
    }
    if !inserted {
        out.push(Span { text: with.to_string(), marks: Vec::new() });
    }
    out.retain(|s| !s.text.is_empty());
    *spans = out;
}

fn replace_range(s: &mut String, start: usize, end: usize, with: &str) {
    s.replace_range(start..end, with);
}

/// Apply the replacement to the matches whose ids are in `selected` (all
/// matches when `None`). Returns how many were replaced and in which
/// documents. Titles that would become empty are left alone.
pub fn replace(
    project: &mut Project,
    opts: &FindOptions,
    replacement: &str,
    selected: Option<&HashSet<String>>,
) -> Result<ReplaceResult, String> {
    let re = build_regex(opts)?;
    let ids: Vec<Uuid> = searchable_docs(project, opts).iter().map(|d| d.id).collect();
    let mut replaced = 0usize;
    let mut touched = Vec::new();

    for doc_id in ids {
        let Some(doc) = project.get_mut(doc_id) else { continue };
        let mut doc_changed = false;
        for (field, text) in units(doc, opts) {
            // Matches to apply in this unit, last first.
            let mut todo: Vec<(usize, usize, String)> = re
                .find_iter(&text)
                .filter(|m| m.start() != m.end())
                .filter(|m| {
                    selected.map_or(true, |sel| {
                        sel.contains(&format!("{}:{}:{}", doc_id, field.id_part(), m.start()))
                    })
                })
                .map(|m| (m.start(), m.end(), replacement_for(&re, opts, &text, m.start(), replacement)))
                .collect();
            if todo.is_empty() {
                continue;
            }
            todo.reverse();
            match field {
                Field::Title => {
                    let mut t = doc.title.clone();
                    for (s, e, r) in &todo {
                        replace_range(&mut t, *s, *e, r);
                    }
                    let t = t.trim().to_string();
                    if t.is_empty() {
                        continue;
                    }
                    doc.title = t;
                }
                Field::Synopsis => {
                    for (s, e, r) in &todo {
                        replace_range(&mut doc.synopsis, *s, *e, r);
                    }
                }
                Field::Notes => {
                    for (s, e, r) in &todo {
                        replace_range(&mut doc.notes, *s, *e, r);
                    }
                }
                Field::Text { block, item } => match &mut doc.content.blocks[block] {
                    Block::Paragraph { spans, .. } | Block::Heading { spans, .. } | Block::BlockQuote { spans, .. } => {
                        for (s, e, r) in &todo {
                            splice_spans(spans, *s, *e, r);
                        }
                    }
                    Block::ListOrdered { items } | Block::ListUnordered { items } => {
                        for (s, e, r) in &todo {
                            splice_spans(&mut items[item].spans, *s, *e, r);
                        }
                    }
                    Block::CodeBlock { text } => {
                        for (s, e, r) in &todo {
                            replace_range(text, *s, *e, r);
                        }
                    }
                    Block::Divider => continue,
                },
            }
            replaced += todo.len();
            doc_changed = true;
        }
        if doc_changed {
            doc.touch();
            touched.push(doc_id);
        }
    }
    if replaced > 0 {
        project.touch();
    }
    Ok(ReplaceResult { replaced, documents: touched })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::project::document::Mark;

    fn span(text: &str, marks: Vec<Mark>) -> Span {
        Span { text: text.into(), marks }
    }

    #[test]
    fn splice_across_spans_keeps_start_formatting() {
        let mut spans = vec![span("Hola ", vec![]), span("mundo", vec![Mark::Bold]), span(" cruel", vec![])];
        // "mundo cr" -> "planeta"
        splice_spans(&mut spans, 5, 13, "planeta");
        assert_eq!(spans_text(&spans), "Hola planetauel");
        assert_eq!(spans[1].text, "planeta");
        assert_eq!(spans[1].marks, vec![Mark::Bold]);
    }

    #[test]
    fn splice_inside_one_span_and_at_edges() {
        let mut spans = vec![span("abcdef", vec![Mark::Italic])];
        splice_spans(&mut spans, 2, 4, "XY");
        assert_eq!(spans_text(&spans), "abXYef");
        assert!(spans.iter().all(|s| s.marks == vec![Mark::Italic]));

        let mut spans = vec![span("ab", vec![]), span("cd", vec![Mark::Bold])];
        splice_spans(&mut spans, 2, 3, "Z");
        assert_eq!(spans_text(&spans), "abZd");
        assert_eq!(spans.iter().find(|s| s.text == "Z").unwrap().marks, vec![Mark::Bold]);
    }

    #[test]
    fn regex_options() {
        let mut o = FindOptions {
            query: "gato".into(),
            regex: false,
            case_sensitive: false,
            whole_word: true,
            in_text: true,
            in_titles: false,
            in_synopsis: false,
            in_notes: false,
            documents: vec![],
        };
        let re = build_regex(&o).unwrap();
        assert!(re.is_match("El Gato duerme"));
        assert!(!re.is_match("gatos"));
        o.query = "(".into();
        assert!(build_regex(&o).is_ok(), "plain text is escaped");
        o.regex = true;
        assert!(build_regex(&o).is_err());
    }
}
