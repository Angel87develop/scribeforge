//! A small RTF reader that turns the RTF Scrivener stores for each document
//! into ScribeForge rich text.
//!
//! Kept: paragraphs, bold, italic, underline, strikethrough, alignment,
//! bulleted and numbered lists, web links, tabs and every character
//! (`\uN` Unicode escapes and `\'hh` Windows-1252 bytes). Footnotes are kept
//! as bracketed text where they were. Dropped on purpose: fonts, sizes,
//! colours, indents and spacing (the writing format profile sets those),
//! pictures, headers and footers, and anything else in an unknown `\*`
//! group.

use crate::project::document::{Block, ListItem, Mark, ParaAttrs, RichDoc, Span};

/// Groups whose content is not text.
const SKIPPED: &[&str] = &[
    "fonttbl", "colortbl", "stylesheet", "info", "pict", "object", "header", "headerl", "headerr", "headerf",
    "footer", "footerl", "footerr", "footerf", "listtable", "listoverridetable", "rsidtbl", "generator", "xe", "tc",
    "themedata", "colorschememapping", "latentstyles", "datastore", "pgdsctbl", "expandedcolortbl", "filetbl",
    "revtbl", "userprops", "nonshppict", "shp", "shpinst", "bkmkstart", "bkmkend", "pn", "fldtype", "xmlnstbl",
];

#[derive(Clone, Copy, PartialEq)]
enum Dest {
    Text,
    Skip,
    /// The bullet or number drawn before a list item.
    ListText,
    /// Field instruction, e.g. `HYPERLINK "https://…"`.
    FieldInstruction,
    Footnote,
}

#[derive(Clone)]
struct Group {
    dest: Dest,
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    /// Fallback characters after a `\uN`.
    uc: usize,
    align: Option<&'static str>,
    /// Inside a list paragraph (`\ls`).
    list: bool,
    link: Option<String>,
    /// Link of the field being read, set when its instruction ends.
    field_link: Option<String>,
}

impl Default for Group {
    fn default() -> Self {
        Self {
            dest: Dest::Text,
            bold: false,
            italic: false,
            underline: false,
            strike: false,
            uc: 1,
            align: None,
            list: false,
            link: None,
            field_link: None,
        }
    }
}

impl Group {
    fn marks(&self) -> Vec<Mark> {
        let mut marks = Vec::new();
        if self.bold {
            marks.push(Mark::Bold);
        }
        if self.italic {
            marks.push(Mark::Italic);
        }
        if self.underline {
            marks.push(Mark::Underline);
        }
        if self.strike {
            marks.push(Mark::Strikethrough);
        }
        if let Some(href) = &self.link {
            marks.push(Mark::Link { href: href.clone() });
        }
        marks
    }
}

/// Collects spans into paragraphs and list items into lists.
#[derive(Default)]
struct Builder {
    blocks: Vec<Block>,
    spans: Vec<Span>,
    /// Open list: ordered?, items.
    list: Option<(bool, Vec<ListItem>)>,
    /// Bullet or number text of the current paragraph.
    list_text: String,
    field_instruction: String,
    footnote: String,
}

impl Builder {
    fn push_text(&mut self, text: &str, marks: Vec<Mark>) {
        if text.is_empty() {
            return;
        }
        match self.spans.last_mut() {
            Some(last) if last.marks == marks => last.text.push_str(text),
            _ => self.spans.push(Span { text: text.to_string(), marks }),
        }
    }

    fn end_paragraph(&mut self, group: &Group) {
        let spans = std::mem::take(&mut self.spans);
        let list_text = std::mem::take(&mut self.list_text);
        if group.list || !list_text.trim().is_empty() {
            let marker = list_text.trim();
            let ordered = marker.chars().next().is_some_and(|c| c.is_ascii_alphanumeric());
            match &mut self.list {
                Some((o, items)) if *o == ordered => items.push(ListItem { spans }),
                _ => {
                    self.close_list();
                    self.list = Some((ordered, vec![ListItem { spans }]));
                }
            }
            return;
        }
        self.close_list();
        let attrs = ParaAttrs { align: group.align.map(str::to_string), ..ParaAttrs::default() };
        self.blocks.push(Block::Paragraph { attrs, spans });
    }

    fn close_list(&mut self) {
        if let Some((ordered, items)) = self.list.take() {
            self.blocks.push(if ordered { Block::ListOrdered { items } } else { Block::ListUnordered { items } });
        }
    }

    fn finish(mut self, group: &Group) -> RichDoc {
        if !self.spans.is_empty() || !self.list_text.is_empty() {
            self.end_paragraph(group);
        }
        self.close_list();
        // Trailing empty paragraphs are only the end of the file.
        while matches!(self.blocks.last(), Some(Block::Paragraph { spans, .. }) if spans.iter().all(|s| s.text.trim().is_empty())) {
            self.blocks.pop();
        }
        RichDoc { blocks: self.blocks }
    }
}

/// Windows-1252 characters for bytes 0x80–0x9F; other bytes are Latin-1.
const CP1252_HIGH: [char; 32] = [
    '€', '\u{81}', '‚', 'ƒ', '„', '…', '†', '‡', 'ˆ', '‰', 'Š', '‹', 'Œ', '\u{8d}', 'Ž', '\u{8f}', '\u{90}', '‘', '’', '“',
    '”', '•', '–', '—', '˜', '™', 'š', '›', 'œ', '\u{9d}', 'ž', 'Ÿ',
];

fn cp1252(b: u8) -> char {
    match b {
        0x80..=0x9f => CP1252_HIGH[(b - 0x80) as usize],
        _ => b as char,
    }
}

/// The URL of a `HYPERLINK "…"` field, when it is a web or mail link.
fn hyperlink(instruction: &str) -> Option<String> {
    let rest = instruction.trim().strip_prefix("HYPERLINK")?.trim();
    let url = rest.trim_start_matches('"').split('"').next()?.trim();
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:"))
        .then(|| url.to_string())
}

/// Convert RTF bytes into rich text. Never fails: what cannot be read is
/// left out.
pub fn rtf_to_rich(bytes: &[u8]) -> RichDoc {
    let mut stack: Vec<Group> = vec![Group::default()];
    let mut out = Builder::default();
    let mut text = String::new();
    // Fallback characters still to drop after a `\uN`.
    let mut skip_fallback = 0usize;
    // A high surrogate waiting for its pair.
    let mut high_surrogate: Option<u16> = None;
    // The next control word is the first of its group (destinations).
    let mut group_start = false;
    // The group was introduced by `\*`.
    let mut starred = false;
    let mut i = 0;

    // Send collected text to where the current group's text goes.
    fn flush(text: &mut String, stack: &[Group], out: &mut Builder) {
        if text.is_empty() {
            return;
        }
        let g = stack.last().expect("root group");
        match g.dest {
            Dest::Text => out.push_text(text, g.marks()),
            Dest::ListText => out.list_text.push_str(text),
            Dest::FieldInstruction => out.field_instruction.push_str(text),
            Dest::Footnote => out.footnote.push_str(text),
            Dest::Skip => {}
        }
        text.clear();
    }

    let emit = |c: char, text: &mut String, skip_fallback: &mut usize| {
        if *skip_fallback > 0 {
            *skip_fallback -= 1;
        } else {
            text.push(c);
        }
    };

    while i < bytes.len() {
        let b = bytes[i];
        match b {
            b'{' => {
                flush(&mut text, &stack, &mut out);
                let top = stack.last().cloned().unwrap_or_default();
                stack.push(Group { field_link: None, ..top });
                group_start = true;
                starred = false;
                skip_fallback = 0;
                i += 1;
            }
            b'}' => {
                flush(&mut text, &stack, &mut out);
                if stack.len() > 1 {
                    let closed = stack.pop().expect("checked");
                    let parent_dest = stack.last().map(|g| g.dest);
                    match closed.dest {
                        Dest::FieldInstruction if parent_dest != Some(Dest::FieldInstruction) => {
                            let instruction = std::mem::take(&mut out.field_instruction);
                            if let Some(parent) = stack.last_mut() {
                                parent.field_link = hyperlink(&instruction);
                            }
                        }
                        Dest::Footnote if parent_dest != Some(Dest::Footnote) => {
                            let note = std::mem::take(&mut out.footnote);
                            let note = note.split_whitespace().collect::<Vec<_>>().join(" ");
                            if !note.is_empty() && parent_dest == Some(Dest::Text) {
                                let parent = stack.last().expect("checked");
                                let mut marks = parent.marks();
                                marks.push(Mark::Italic);
                                out.push_text(&format!(" [{note}]"), marks);
                            }
                        }
                        _ => {}
                    }
                }
                group_start = false;
                starred = false;
                i += 1;
            }
            b'\\' => {
                i += 1;
                let Some(&c) = bytes.get(i) else { break };
                if c.is_ascii_alphabetic() {
                    let start = i;
                    while i < bytes.len() && bytes[i].is_ascii_alphabetic() && i - start < 32 {
                        i += 1;
                    }
                    let word = std::str::from_utf8(&bytes[start..i]).unwrap_or("");
                    let num_start = i;
                    if i < bytes.len() && bytes[i] == b'-' {
                        i += 1;
                    }
                    while i < bytes.len() && bytes[i].is_ascii_digit() && i - num_start < 11 {
                        i += 1;
                    }
                    let param: Option<i32> = std::str::from_utf8(&bytes[num_start..i]).ok().and_then(|s| s.parse().ok());
                    if i < bytes.len() && bytes[i] == b' ' {
                        i += 1;
                    }
                    let first = group_start;
                    group_start = false;

                    if word != "u" {
                        high_surrogate = None;
                    }
                    flush(&mut text, &stack, &mut out);
                    // The link of the enclosing field, for its shown text.
                    let field_link = stack.iter().rev().nth(1).and_then(|p| p.field_link.clone());
                    let g = stack.last_mut().expect("root group");
                    let on = param.map_or(true, |p| p != 0);

                    // Destinations.
                    if first && (starred || SKIPPED.contains(&word)) {
                        g.dest = match word {
                            "fldinst" => Dest::FieldInstruction,
                            "listtext" => Dest::ListText,
                            _ => Dest::Skip,
                        };
                        if g.dest == Dest::FieldInstruction {
                            out.field_instruction.clear();
                        }
                        continue;
                    }
                    if g.dest == Dest::Skip {
                        continue;
                    }
                    match word {
                        "fldinst" => {
                            g.dest = Dest::FieldInstruction;
                            out.field_instruction.clear();
                        }
                        "fldrslt" => {
                            // The field's shown text; a link when the field is one.
                            if field_link.is_some() {
                                g.link = field_link;
                            }
                        }
                        "listtext" | "pntext" => g.dest = Dest::ListText,
                        "footnote" => {
                            if g.dest == Dest::Text {
                                g.dest = Dest::Footnote;
                                out.footnote.clear();
                            }
                        }
                        "par" | "sect" | "page" | "row" => {
                            if g.dest == Dest::Text {
                                let g = g.clone();
                                out.end_paragraph(&g);
                            } else if g.dest == Dest::Footnote {
                                out.footnote.push(' ');
                            }
                        }
                        "line" => {
                            if g.dest == Dest::Text {
                                let g = g.clone();
                                out.end_paragraph(&g);
                            } else {
                                text.push(' ');
                            }
                        }
                        "pard" => {
                            g.align = None;
                            g.list = false;
                        }
                        "plain" => {
                            g.bold = false;
                            g.italic = false;
                            g.underline = false;
                            g.strike = false;
                        }
                        "b" => g.bold = on,
                        "i" => g.italic = on,
                        "strike" | "striked" => g.strike = on,
                        "ulnone" => g.underline = false,
                        w if w.starts_with("ul") && !w.starts_with("ulc") => g.underline = on,
                        "ql" => g.align = None,
                        "qc" => g.align = Some("center"),
                        "qr" => g.align = Some("right"),
                        "qj" => g.align = Some("justify"),
                        "ls" => g.list = true,
                        "uc" => g.uc = param.unwrap_or(1).max(0) as usize,
                        "u" => {
                            if let Some(p) = param {
                                let unit = if p < 0 { (p + 65536) as u16 } else { p as u16 };
                                let ch = match (high_surrogate.take(), unit) {
                                    (Some(hi), 0xdc00..=0xdfff) => char::decode_utf16([hi, unit]).next().and_then(Result::ok),
                                    (_, 0xd800..=0xdbff) => {
                                        high_surrogate = Some(unit);
                                        None
                                    }
                                    (_, u) => char::from_u32(u as u32),
                                };
                                let uc = g.uc;
                                if let Some(ch) = ch {
                                    text.push(ch);
                                }
                                skip_fallback = uc;
                            }
                        }
                        "tab" | "cell" => text.push('\t'),
                        "emdash" => text.push('—'),
                        "endash" => text.push('–'),
                        "bullet" => text.push('•'),
                        "lquote" => text.push('‘'),
                        "rquote" => text.push('’'),
                        "ldblquote" => text.push('“'),
                        "rdblquote" => text.push('”'),
                        _ => {}
                    }
                } else {
                    i += 1;
                    let first = group_start;
                    group_start = false;
                    match c {
                        b'*' => {
                            if first {
                                starred = true;
                                group_start = true;
                            }
                        }
                        b'\'' => {
                            let hex = bytes.get(i..i + 2).and_then(|h| std::str::from_utf8(h).ok());
                            if let Some(v) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                                emit(cp1252(v), &mut text, &mut skip_fallback);
                                i += 2;
                            }
                        }
                        b'~' => emit('\u{a0}', &mut text, &mut skip_fallback),
                        b'_' => emit('\u{2011}', &mut text, &mut skip_fallback),
                        b'-' => {}
                        b'\n' | b'\r' => {
                            if stack.last().is_some_and(|g| g.dest == Dest::Text) {
                                flush(&mut text, &stack, &mut out);
                                let g = stack.last().expect("root group").clone();
                                out.end_paragraph(&g);
                            }
                        }
                        other => emit(other as char, &mut text, &mut skip_fallback),
                    }
                }
            }
            b'\r' | b'\n' => i += 1,
            _ => {
                group_start = false;
                // Text runs up to the next control character; bytes above
                // 0x7f are read as Windows-1252, or as UTF-8 when valid.
                let start = i;
                while i < bytes.len() && !matches!(bytes[i], b'{' | b'}' | b'\\' | b'\r' | b'\n') {
                    i += 1;
                }
                let run = &bytes[start..i];
                let decoded: String = match std::str::from_utf8(run) {
                    Ok(s) => s.to_string(),
                    Err(_) => run.iter().map(|&b| cp1252(b)).collect(),
                };
                for ch in decoded.chars() {
                    emit(ch, &mut text, &mut skip_fallback);
                }
            }
        }
    }
    flush(&mut text, &stack, &mut out);
    let last = stack.last().cloned().unwrap_or_default();
    out.finish(&last)
}

/// Plain text of an RTF file (for notes): one line per paragraph.
pub fn rtf_to_text(bytes: &[u8]) -> String {
    rtf_to_rich(bytes).plain_text().trim_end().to_string()
}
