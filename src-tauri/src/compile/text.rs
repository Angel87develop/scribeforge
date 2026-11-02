//! Plain-text and Markdown writers.

use super::{span_link, span_style, spans_text, Compiled, Flow};
use crate::project::document::{Block, Span};

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

pub fn to_txt(c: &Compiled) -> String {
    let s = c.settings;
    let mut out = String::new();
    if s.title_page {
        out.push_str(&c.title);
        out.push('\n');
        if !c.author.is_empty() {
            out.push_str(&format!("by {}\n", c.author));
        }
        out.push_str("\n\n\n");
    }
    for f in c.flow() {
        match f {
            Flow::Section { title, show_title, new_page, .. } => {
                if new_page {
                    out.push_str("\n\n");
                }
                if show_title {
                    out.push_str(&title);
                    out.push_str("\n\n");
                }
            }
            Flow::Separator => {
                out.push_str(&s.separator);
                out.push_str("\n\n");
            }
            Flow::Block(b) => txt_block(b, &mut out),
        }
    }
    trim_end_newlines(&mut out);
    out.push('\n');
    out
}

fn txt_block(b: &Block, out: &mut String) {
    match b {
        Block::Paragraph { spans, .. } | Block::Heading { spans, .. } => {
            out.push_str(&spans_text(spans));
            out.push_str("\n\n");
        }
        Block::BlockQuote { spans, .. } => {
            out.push_str("    ");
            out.push_str(&spans_text(spans));
            out.push_str("\n\n");
        }
        Block::ListUnordered { items } => {
            for it in items {
                out.push_str("- ");
                out.push_str(&spans_text(&it.spans));
                out.push('\n');
            }
            out.push('\n');
        }
        Block::ListOrdered { items } => {
            for (i, it) in items.iter().enumerate() {
                out.push_str(&format!("{}. {}\n", i + 1, spans_text(&it.spans)));
            }
            out.push('\n');
        }
        Block::CodeBlock { text } => {
            out.push_str(text);
            out.push_str("\n\n");
        }
        Block::Divider => out.push_str("----\n\n"),
    }
}

fn trim_end_newlines(s: &mut String) {
    while s.ends_with('\n') {
        s.pop();
    }
}

// ---------------------------------------------------------------------------
// Markdown
// ---------------------------------------------------------------------------

pub fn to_markdown(c: &Compiled) -> String {
    let s = c.settings;
    let mut out = String::new();
    // With a title page the book title takes the top heading level.
    let offset: u8 = if s.title_page { 1 } else { 0 };
    if s.title_page {
        out.push_str(&format!("# {}\n\n", md_escape(&c.title)));
        if !c.author.is_empty() {
            out.push_str(&format!("*by {}*\n\n", md_escape(&c.author)));
        }
    }
    for f in c.flow() {
        match f {
            Flow::Section { title, show_title, level, .. } => {
                if show_title {
                    let lvl = (level + offset).min(6) as usize;
                    out.push_str(&format!("{} {}\n\n", "#".repeat(lvl), md_escape(&title)));
                }
            }
            Flow::Separator => {
                if s.separator.trim().is_empty() {
                    out.push_str("&nbsp;\n\n");
                } else {
                    out.push_str(&md_escape_line_start(&md_escape(&s.separator)));
                    out.push_str("\n\n");
                }
            }
            Flow::Block(b) => md_block(b, s.keep_formatting, &mut out),
        }
    }
    trim_end_newlines(&mut out);
    out.push('\n');
    out
}

fn md_block(b: &Block, keep: bool, out: &mut String) {
    match b {
        Block::Paragraph { spans, .. } => {
            out.push_str(&md_escape_line_start(&md_inline(spans, keep)));
            out.push_str("\n\n");
        }
        Block::Heading { level, spans, .. } => {
            let lvl = (*level).clamp(1, 6) as usize;
            out.push_str(&format!("{} {}\n\n", "#".repeat(lvl), md_inline(spans, keep)));
        }
        Block::BlockQuote { spans, .. } => {
            out.push_str("> ");
            out.push_str(&md_inline(spans, keep));
            out.push_str("\n\n");
        }
        Block::ListUnordered { items } => {
            for it in items {
                out.push_str("- ");
                out.push_str(&md_inline(&it.spans, keep));
                out.push('\n');
            }
            out.push('\n');
        }
        Block::ListOrdered { items } => {
            for (i, it) in items.iter().enumerate() {
                out.push_str(&format!("{}. {}\n", i + 1, md_inline(&it.spans, keep)));
            }
            out.push('\n');
        }
        Block::CodeBlock { text } => {
            out.push_str("```\n");
            out.push_str(text);
            if !text.ends_with('\n') {
                out.push('\n');
            }
            out.push_str("```\n\n");
        }
        Block::Divider => out.push_str("---\n\n"),
    }
}

fn md_inline(spans: &[Span], keep: bool) -> String {
    let mut out = String::new();
    for span in spans {
        if span.text.is_empty() {
            continue;
        }
        let st = span_style(span, keep);
        // Markers must hug the text: keep surrounding spaces outside them.
        let core = span.text.trim();
        if core.is_empty() {
            out.push_str(&span.text);
            continue;
        }
        let lead = &span.text[..span.text.len() - span.text.trim_start().len()];
        let trail = &span.text[span.text.trim_end().len()..];
        let mut t = if st.code {
            format!("`{}`", core.replace('`', "'"))
        } else {
            md_escape(core)
        };
        if st.strike {
            t = format!("~~{t}~~");
        }
        if st.italic {
            t = format!("*{t}*");
        }
        if st.bold {
            t = format!("**{t}**");
        }
        if let Some(href) = span_link(span) {
            t = format!("[{t}]({href})");
        }
        out.push_str(lead);
        out.push_str(&t);
        out.push_str(trail);
    }
    out
}

fn md_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        if matches!(ch, '\\' | '*' | '_' | '`' | '[' | ']' | '<' | '>' | '~') {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// Escape characters that would turn a plain line into a heading, list or
/// rule when they appear at its start.
fn md_escape_line_start(s: &str) -> String {
    let trimmed = s.trim_start();
    let first = trimmed.chars().next();
    let needs = match first {
        Some('#' | '+' | '-' | '=' | '|') => true,
        Some(c) if c.is_ascii_digit() => {
            let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
            trimmed[digits.len()..].starts_with(". ") || trimmed[digits.len()..].starts_with(") ")
        }
        _ => false,
    };
    if !needs {
        return s.to_string();
    }
    let lead = s.len() - trimmed.len();
    if first.is_some_and(|c| c.is_ascii_digit()) {
        let digits: String = trimmed.chars().take_while(|c| c.is_ascii_digit()).collect();
        format!("{}{}\\{}", &s[..lead], digits, &trimmed[digits.len()..])
    } else {
        format!("{}\\{}", &s[..lead], trimmed)
    }
}
