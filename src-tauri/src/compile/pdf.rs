//! PDF writer.
//!
//! Writes PDF 1.4 by hand with the standard base fonts (Courier, Times,
//! Helvetica) in WinAnsi encoding, so no font files are embedded and no
//! external crate is needed. Text is laid out with the fonts' published
//! glyph widths: greedy line breaking, left/center/right alignment, first-line
//! indents, page breaks, keep-with-next for headings, and page numbers.
//!
//! Characters outside Windows-1252 (which covers Western European languages,
//! curly quotes and dashes) are written as "?".

use super::docx::round_words;
use super::{is_centered_style, span_style, CompileSettings, Compiled, Flow};
use crate::project::document::{Block, Span};

// ---------------------------------------------------------------------------
// Fonts and metrics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Family {
    Courier,
    Times,
    Helvetica,
}

impl Family {
    fn from_name(name: &str) -> Self {
        let n = name.to_lowercase();
        if n.contains("courier") || n.contains("mono") || n.contains("typewriter") {
            Family::Courier
        } else if n.contains("arial") || n.contains("helvetica") || n.contains("sans") || n.contains("segoe") {
            Family::Helvetica
        } else {
            Family::Times
        }
    }

    /// Base font names for regular, bold, italic, bold italic.
    fn base_fonts(self) -> [&'static str; 4] {
        match self {
            Family::Courier => ["Courier", "Courier-Bold", "Courier-Oblique", "Courier-BoldOblique"],
            Family::Times => ["Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic"],
            Family::Helvetica => [
                "Helvetica",
                "Helvetica-Bold",
                "Helvetica-Oblique",
                "Helvetica-BoldOblique",
            ],
        }
    }
}

/// Times-Roman widths for ASCII 32..=126, in 1/1000 em.
const TIMES: [u16; 95] = [
    250, 333, 408, 500, 500, 833, 778, 180, 333, 333, 500, 564, 250, 333, 250, 278, // ' '../
    500, 500, 500, 500, 500, 500, 500, 500, 500, 500, // 0-9
    278, 278, 564, 564, 564, 444, 921, // :;<=>?@
    722, 667, 667, 722, 611, 556, 722, 722, 333, 389, 722, 611, 889, 722, 722, 556, 722, 667, 556,
    611, 722, 722, 944, 722, 722, 611, // A-Z
    333, 278, 333, 469, 500, 333, // [\]^_`
    444, 500, 444, 500, 444, 333, 500, 500, 278, 278, 500, 278, 778, 500, 500, 500, 500, 333, 389,
    278, 500, 500, 722, 500, 500, 444, // a-z
    480, 200, 480, 541, // {|}~
];

/// Helvetica widths for ASCII 32..=126, in 1/1000 em.
const HELVETICA: [u16; 95] = [
    278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // ' '../
    556, 556, 556, 556, 556, 556, 556, 556, 556, 556, // 0-9
    278, 278, 584, 584, 584, 556, 1015, // :;<=>?@
    667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667,
    611, 722, 667, 944, 667, 667, 611, // A-Z
    278, 278, 278, 469, 556, 333, // [\]^_`
    556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500,
    278, 556, 500, 722, 500, 500, 500, // a-z
    334, 260, 334, 584, // {|}~
];

/// Map a Unicode character to its Windows-1252 byte.
fn cp1252(ch: char) -> u8 {
    let c = ch as u32;
    match c {
        0x20..=0x7E | 0xA0..=0xFF => c as u8,
        0x09 => b' ',
        0x20AC => 0x80,
        0x201A => 0x82,
        0x0192 => 0x83,
        0x201E => 0x84,
        0x2026 => 0x85,
        0x2020 => 0x86,
        0x2021 => 0x87,
        0x02C6 => 0x88,
        0x2030 => 0x89,
        0x0160 => 0x8A,
        0x2039 => 0x8B,
        0x0152 => 0x8C,
        0x017D => 0x8E,
        0x2018 => 0x91,
        0x2019 => 0x92,
        0x201C => 0x93,
        0x201D => 0x94,
        0x2022 => 0x95,
        0x2013 => 0x96,
        0x2014 => 0x97,
        0x02DC => 0x98,
        0x2122 => 0x99,
        0x0161 => 0x9A,
        0x203A => 0x9B,
        0x0153 => 0x9C,
        0x017E => 0x9E,
        0x0178 => 0x9F,
        _ => b'?',
    }
}

/// Width of a WinAnsi byte in 1/1000 em for a proportional font. Accented
/// letters use their base letter; other symbols use typical widths.
fn proportional_width(table: &[u16; 95], b: u8) -> f32 {
    let ascii = |c: u8| table[(c - 32) as usize] as f32;
    match b {
        32..=126 => ascii(b),
        0xA0 => ascii(b' '),
        0x85 | 0x97 | 0x89 => 1000.0,
        0x96 => 500.0,
        0x91 | 0x92 | 0x82 => ascii(b'\''),
        0x93 | 0x94 | 0x84 => ascii(b'"').max(444.0),
        0x95 => 350.0,
        0xA1 => ascii(b'!'),
        0xBF => ascii(b'?'),
        0xC0..=0xC5 => ascii(b'A'),
        0xC6 | 0x8C => ascii(b'A') * 1.3,
        0xC7 => ascii(b'C'),
        0xC8..=0xCB => ascii(b'E'),
        0xCC..=0xCF => ascii(b'I'),
        0xD0 => ascii(b'D'),
        0xD1 => ascii(b'N'),
        0xD2..=0xD6 | 0xD8 => ascii(b'O'),
        0xD9..=0xDC => ascii(b'U'),
        0xDD | 0x9F => ascii(b'Y'),
        0xDE => ascii(b'P'),
        0xDF => ascii(b'B'),
        0xE0..=0xE5 => ascii(b'a'),
        0xE6 | 0x9C => ascii(b'a') * 1.5,
        0xE7 => ascii(b'c'),
        0xE8..=0xEB => ascii(b'e'),
        0xEC..=0xEF => ascii(b'i'),
        0xF0 | 0xF2..=0xF6 | 0xF8 => ascii(b'o'),
        0xF1 => ascii(b'n'),
        0xF9..=0xFC => ascii(b'u'),
        0xFD | 0xFF => ascii(b'y'),
        0xFE => ascii(b'p'),
        0x8A => ascii(b'S'),
        0x9A => ascii(b's'),
        0x8E => ascii(b'Z'),
        0x9E => ascii(b'z'),
        _ => 556.0,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
struct Sty {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    mono: bool,
}

impl Sty {
    /// Font resource name: /F1../F4 body family, /F5 Courier for code.
    fn font_index(self) -> usize {
        if self.mono {
            return 5;
        }
        1 + (self.bold as usize) + 2 * (self.italic as usize)
    }
}

struct Metrics {
    family: Family,
}

impl Metrics {
    fn byte_width(&self, b: u8, sty: Sty) -> f32 {
        if sty.mono || self.family == Family::Courier {
            return 600.0;
        }
        let (table, bold_factor) = match self.family {
            Family::Times => (&TIMES, 1.06),
            _ => (&HELVETICA, 1.07),
        };
        let w = proportional_width(table, b);
        if sty.bold {
            w * bold_factor
        } else {
            w
        }
    }

    fn width(&self, text: &[u8], sty: Sty, size: f32) -> f32 {
        text.iter().map(|&b| self.byte_width(b, sty)).sum::<f32>() * size / 1000.0
    }
}

// ---------------------------------------------------------------------------
// Paragraph model
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq)]
enum Align {
    Left,
    Center,
    Right,
    /// Left with every line but the last stretched to the full width.
    Justify,
}

enum Tok {
    Word(Vec<(Vec<u8>, Sty)>),
    Space(Sty),
    Break,
}

struct PPara {
    toks: Vec<Tok>,
    size: f32,
    leading: f32,
    align: Align,
    first_indent: f32,
    left: f32,
    space_before: f32,
    space_after: f32,
    page_break: bool,
    keep_with_next: bool,
}

fn tokenize(pieces: &[(&str, Sty)]) -> Vec<Tok> {
    let mut toks = Vec::new();
    let mut cur: Vec<(Vec<u8>, Sty)> = Vec::new();
    for (text, sty) in pieces {
        for ch in text.chars() {
            match ch {
                ' ' | '\t' | '\u{a0}' => {
                    if !cur.is_empty() {
                        toks.push(Tok::Word(std::mem::take(&mut cur)));
                    }
                    toks.push(Tok::Space(*sty));
                }
                '\n' => {
                    if !cur.is_empty() {
                        toks.push(Tok::Word(std::mem::take(&mut cur)));
                    }
                    toks.push(Tok::Break);
                }
                '\r' => {}
                c => {
                    let b = cp1252(c);
                    match cur.last_mut() {
                        Some((bytes, s)) if s == sty => bytes.push(b),
                        _ => cur.push((vec![b], *sty)),
                    }
                }
            }
        }
    }
    if !cur.is_empty() {
        toks.push(Tok::Word(cur));
    }
    toks
}

fn span_pieces<'s>(spans: &'s [Span], keep: bool, base: Sty) -> Vec<(&'s str, Sty)> {
    spans
        .iter()
        .map(|s| {
            let st = span_style(s, keep);
            (
                s.text.as_str(),
                Sty {
                    bold: base.bold || st.bold,
                    italic: base.italic || st.italic,
                    underline: st.underline,
                    strike: st.strike,
                    mono: base.mono || st.code,
                },
            )
        })
        .collect()
}

// ---------------------------------------------------------------------------
// Line layout
// ---------------------------------------------------------------------------

struct Line {
    pieces: Vec<(Vec<u8>, Sty)>,
    width: f32,
    /// Ends the paragraph or a forced line break: never stretched.
    last: bool,
}

fn push_piece(line: &mut Line, bytes: &[u8], sty: Sty) {
    match line.pieces.last_mut() {
        Some((b, s)) if *s == sty => b.extend_from_slice(bytes),
        _ => line.pieces.push((bytes.to_vec(), sty)),
    }
}

fn layout_lines(p: &PPara, m: &Metrics, avail: f32) -> Vec<Line> {
    let mut lines = Vec::new();
    let mut line = Line { pieces: Vec::new(), width: 0.0, last: false };
    let mut pending_space: Option<Sty> = None;
    let width_for = |lines: &Vec<Line>| {
        if lines.is_empty() {
            (avail - p.first_indent).max(avail * 0.3)
        } else {
            avail
        }
    };

    for tok in &p.toks {
        match tok {
            Tok::Space(sty) => {
                if !line.pieces.is_empty() {
                    pending_space = Some(*sty);
                }
            }
            Tok::Break => {
                line.last = true;
                lines.push(std::mem::replace(&mut line, Line { pieces: Vec::new(), width: 0.0, last: false }));
                pending_space = None;
            }
            Tok::Word(pieces) => {
                let w: f32 = pieces.iter().map(|(b, s)| m.width(b, *s, p.size)).sum();
                let space_w = pending_space.map_or(0.0, |s| m.width(b" ", s, p.size));
                let room = width_for(&lines);
                if !line.pieces.is_empty() && line.width + space_w + w > room {
                    lines.push(std::mem::replace(&mut line, Line { pieces: Vec::new(), width: 0.0, last: false }));
                    pending_space = None;
                } else if let Some(s) = pending_space.take() {
                    push_piece(&mut line, b" ", s);
                    line.width += space_w;
                }
                let room = width_for(&lines);
                if line.pieces.is_empty() && w > room {
                    // A word longer than the line: break it between characters.
                    for (bytes, sty) in pieces {
                        for &b in bytes {
                            let cw = m.byte_width(b, *sty) * p.size / 1000.0;
                            if !line.pieces.is_empty() && line.width + cw > width_for(&lines) {
                                lines.push(std::mem::replace(
                                    &mut line,
                                    Line { pieces: Vec::new(), width: 0.0, last: false },
                                ));
                            }
                            push_piece(&mut line, &[b], *sty);
                            line.width += cw;
                        }
                    }
                } else {
                    for (bytes, sty) in pieces {
                        push_piece(&mut line, bytes, *sty);
                    }
                    line.width += w;
                }
            }
        }
    }
    if !line.pieces.is_empty() || lines.is_empty() {
        line.last = true;
        lines.push(line);
    }
    lines
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

struct Pager<'m> {
    m: &'m Metrics,
    page_w: f32,
    page_h: f32,
    top: f32,
    bottom: f32,
    left: f32,
    right: f32,
    pages: Vec<Vec<u8>>,
    y: f32,
}

fn pdf_string(bytes: &[u8], out: &mut Vec<u8>) {
    out.push(b'(');
    for &b in bytes {
        if matches!(b, b'(' | b')' | b'\\') {
            out.push(b'\\');
        }
        out.push(b);
    }
    out.push(b')');
}

fn encode(text: &str) -> Vec<u8> {
    text.chars().filter(|c| *c != '\n' && *c != '\r').map(cp1252).collect()
}

impl<'m> Pager<'m> {
    fn avail(&self) -> f32 {
        self.page_w - self.left - self.right
    }

    fn new_page(&mut self) {
        self.pages.push(Vec::new());
        self.y = self.page_h - self.top;
    }

    fn at_page_top(&self) -> bool {
        (self.y - (self.page_h - self.top)).abs() < 0.01
    }

    fn cur(&mut self) -> &mut Vec<u8> {
        if self.pages.is_empty() {
            self.new_page();
        }
        self.pages.last_mut().unwrap()
    }

    fn text_at(&mut self, x: f32, baseline: f32, text: &[u8], sty: Sty, size: f32) {
        let mut ops = format!("BT /F{} {size:.2} Tf {x:.2} {baseline:.2} Td ", sty.font_index()).into_bytes();
        pdf_string(text, &mut ops);
        ops.extend_from_slice(b" Tj ET\n");
        self.cur().extend_from_slice(&ops);
    }

    fn draw_line(&mut self, p: &PPara, line: &Line, first: bool) {
        let avail = self.avail();
        let indent = if first { p.first_indent } else { 0.0 };
        let x0 = self.left + p.left
            + match p.align {
                Align::Left | Align::Justify => indent,
                Align::Center => ((avail - p.left - line.width) / 2.0).max(0.0),
                Align::Right => (avail - p.left - line.width).max(0.0),
            };
        // Justified lines spread the leftover width over their spaces with
        // the word-spacing operator (it only affects byte 32).
        let spaces = line.pieces.iter().flat_map(|(b, _)| b.iter()).filter(|&&b| b == b' ').count();
        let word_spacing = if p.align == Align::Justify && !line.last && spaces > 0 {
            ((avail - p.left - indent - line.width) / spaces as f32).max(0.0)
        } else {
            0.0
        };
        let baseline = self.y - p.size;
        let mut ops: Vec<u8> = format!("BT {x0:.2} {baseline:.2} Td ").into_bytes();
        if word_spacing > 0.0 {
            ops.extend_from_slice(format!("{word_spacing:.3} Tw ").as_bytes());
        }
        let mut decorations = String::new();
        let mut x = x0;
        for (bytes, sty) in &line.pieces {
            ops.extend_from_slice(format!("/F{} {:.2} Tf ", sty.font_index(), p.size).as_bytes());
            pdf_string(bytes, &mut ops);
            ops.extend_from_slice(b" Tj ");
            let w = self.m.width(bytes, *sty, p.size)
                + word_spacing * bytes.iter().filter(|&&b| b == b' ').count() as f32;
            if sty.underline {
                decorations.push_str(&format!("{x:.2} {:.2} {w:.2} 0.6 re f\n", baseline - p.size * 0.12));
            }
            if sty.strike {
                decorations.push_str(&format!("{x:.2} {:.2} {w:.2} 0.6 re f\n", baseline + p.size * 0.28));
            }
            x += w;
        }
        // Word spacing is graphics state: reset it so later text is unaffected.
        if word_spacing > 0.0 {
            ops.extend_from_slice(b"0 Tw ");
        }
        ops.extend_from_slice(b"ET\n");
        ops.extend_from_slice(decorations.as_bytes());
        self.cur().extend_from_slice(&ops);
        self.y -= p.leading;
    }

    fn paragraph(&mut self, p: &PPara, next_height: f32) {
        let page_has_content = self.pages.last().is_some_and(|pg| !pg.is_empty());
        if p.page_break && page_has_content {
            self.new_page();
        }
        if self.pages.is_empty() {
            self.new_page();
        }
        let avail = self.avail() - p.left;
        let lines = layout_lines(p, self.m, avail);
        let before = if self.at_page_top() && !p.page_break { 0.0 } else { p.space_before };
        let mut needed = before + p.leading * lines.len().min(2) as f32;
        if p.keep_with_next {
            needed = before + p.leading * lines.len() as f32 + next_height;
        }
        if self.y - needed < self.bottom && !self.at_page_top() {
            self.new_page();
        } else {
            self.y -= before;
        }
        for (i, line) in lines.iter().enumerate() {
            if self.y - p.leading < self.bottom - 0.01 && !self.at_page_top() {
                self.new_page();
            }
            self.draw_line(p, line, i == 0);
        }
        self.y -= p.space_after;
    }
}

// ---------------------------------------------------------------------------
// Flow -> paragraphs
// ---------------------------------------------------------------------------

struct Builder<'a> {
    s: &'a CompileSettings,
    paras: Vec<PPara>,
    pending_break: bool,
    after_break: bool,
    page_content_h: f32,
}

impl<'a> Builder<'a> {
    fn leading(&self, size: f32) -> f32 {
        size * 1.15 * self.s.line_spacing
    }

    fn push(&mut self, mut p: PPara) {
        if self.pending_break {
            p.page_break = true;
            self.pending_break = false;
        }
        self.paras.push(p);
    }

    fn para(&self, pieces: &[(&str, Sty)], size: f32, align: Align) -> PPara {
        PPara {
            toks: tokenize(pieces),
            size,
            leading: self.leading(size),
            align,
            first_indent: 0.0,
            left: 0.0,
            space_before: 0.0,
            space_after: self.s.paragraph_spacing,
            page_break: false,
            keep_with_next: false,
        }
    }

    fn heading_size(&self, level: u8) -> f32 {
        let plain = Family::from_name(&self.s.font_family) == Family::Courier;
        let scale = if plain {
            1.0
        } else {
            match level {
                1 => 1.5,
                2 => 1.3,
                3 => 1.15,
                _ => 1.05,
            }
        };
        self.s.font_size * scale
    }

    fn flow(&mut self, f: &Flow) {
        let size = self.s.font_size;
        let keep = self.s.keep_formatting;
        match f {
            Flow::Section { title, show_title, level, chapter, new_page } => {
                if *new_page {
                    self.pending_break = true;
                }
                if *show_title {
                    let hs = if *chapter && self.s.chapter_title_size > 0.0 {
                        self.s.chapter_title_size
                    } else {
                        self.heading_size(*level)
                    };
                    let bold = Family::from_name(&self.s.font_family) != Family::Courier;
                    let sty = Sty { bold, ..Sty::default() };
                    let mut p = self.para(&[(title.as_str(), sty)], hs, if *chapter { Align::Center } else { Align::Left });
                    p.keep_with_next = true;
                    p.space_before = if *chapter && (*new_page || self.pending_break) {
                        self.page_content_h / 4.0
                    } else {
                        self.leading(size)
                    };
                    p.space_after = self.leading(size) * if *chapter { 1.0 } else { 0.25 };
                    self.push(p);
                }
                self.after_break = true;
            }
            Flow::Separator => {
                let p = self.para(&[(self.s.separator.as_str(), Sty::default())], size, Align::Center);
                self.push(p);
                self.after_break = true;
            }
            Flow::Block(b) => match b {
                Block::Paragraph { attrs, spans } => {
                    let centered = is_centered_style(attrs.style.as_deref());
                    let align = match attrs.align.as_deref() {
                        Some("center") => Align::Center,
                        Some("right") => Align::Right,
                        Some("justify") => Align::Justify,
                        _ if centered => Align::Center,
                        _ if self.s.justified() => Align::Justify,
                        _ => Align::Left,
                    };
                    let mut p = self.para(&span_pieces(spans, keep, Sty::default()), size, align);
                    if matches!(align, Align::Left | Align::Justify) && !self.after_break {
                        p.first_indent = self.s.first_line_indent * 72.0;
                    }
                    p.space_before = self.s.paragraph_spacing_before;
                    self.push(p);
                    self.after_break = false;
                }
                Block::Heading { level, spans, .. } => {
                    let hs = self.heading_size(level.saturating_add(1));
                    let base = Sty { bold: true, ..Sty::default() };
                    let mut p = self.para(&span_pieces(spans, keep, base), hs, Align::Left);
                    p.keep_with_next = true;
                    p.space_before = self.leading(size) * 0.5;
                    self.push(p);
                    self.after_break = true;
                }
                Block::BlockQuote { spans, .. } => {
                    let base = Sty { italic: true, ..Sty::default() };
                    let mut p = self.para(&span_pieces(spans, keep, base), size, Align::Left);
                    p.left = 36.0;
                    self.push(p);
                    self.after_break = true;
                }
                Block::ListUnordered { items } | Block::ListOrdered { items } => {
                    let ordered = matches!(b, Block::ListOrdered { .. });
                    for (i, it) in items.iter().enumerate() {
                        let marker = if ordered { format!("{}. ", i + 1) } else { "\u{2022} ".to_string() };
                        let mut pieces = vec![(marker.as_str(), Sty::default())];
                        pieces.extend(span_pieces(&it.spans, keep, Sty::default()));
                        let mut p = self.para(&pieces, size, Align::Left);
                        p.left = 18.0;
                        self.push(p);
                    }
                    self.after_break = true;
                }
                Block::CodeBlock { text } => {
                    let sty = Sty { mono: true, ..Sty::default() };
                    let cs = size * 0.9;
                    let mut p = self.para(&[(text.as_str(), sty)], cs, Align::Left);
                    p.leading = cs * 1.2;
                    p.left = 18.0;
                    self.push(p);
                    self.after_break = true;
                }
                Block::Divider => {
                    let p = self.para(&[("* * *", Sty::default())], size, Align::Center);
                    self.push(p);
                    self.after_break = true;
                }
            },
        }
    }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

pub fn to_pdf(c: &Compiled) -> Vec<u8> {
    let s = c.settings;
    let family = Family::from_name(&s.font_family);
    let m = Metrics { family };
    let (page_w, page_h) = s.page_size_points();
    let mut pager = Pager {
        m: &m,
        page_w,
        page_h,
        top: s.margin * 72.0,
        bottom: s.margin * 72.0,
        left: s.margin_left * 72.0,
        right: s.margin * 72.0,
        pages: Vec::new(),
        y: 0.0,
    };

    // Title page.
    let size = s.font_size;
    if s.title_page {
        pager.new_page();
        let plain = Sty::default();
        if s.preset == "manuscript" {
            let top = page_h - pager.top - size;
            if !c.author.is_empty() {
                let left = pager.left;
                pager.text_at(left, top, &encode(&c.author), plain, size);
            }
            let words = encode(&format!("About {} words", round_words(c.word_count())));
            let x = page_w - pager.right - m.width(&words, plain, size);
            pager.text_at(x, top, &words, plain, size);
        }
        let title = encode(&s.title_text(&c.title));
        let ts = if family == Family::Courier { size } else { size * 2.0 };
        let tsty = Sty { bold: family != Family::Courier, ..Sty::default() };
        let tw = m.width(&title, tsty, ts);
        let ty = page_h * 0.55;
        pager.text_at((page_w - tw) / 2.0, ty, &title, tsty, ts);
        if !c.author.is_empty() {
            let by = encode(&format!("by {}", c.author));
            let bw = m.width(&by, plain, size);
            pager.text_at((page_w - bw) / 2.0, ty - ts * 2.0, &by, plain, size);
        }
    }

    let mut b = Builder {
        s,
        paras: Vec::new(),
        pending_break: s.title_page,
        after_break: true,
        page_content_h: page_h - 2.0 * s.margin * 72.0,
    };
    for f in c.flow() {
        b.flow(&f);
    }
    let paras = b.paras;
    for (i, p) in paras.iter().enumerate() {
        // Keep a heading with the first two lines of what follows.
        let next_h = paras.get(i + 1).map_or(0.0, |n| n.space_before + n.leading * 2.0);
        pager.paragraph(p, next_h);
    }
    if pager.pages.is_empty() {
        pager.new_page();
    }

    // Running header and page numbers (the title page has neither).
    let first_numbered = if s.title_page { 1 } else { 0 };
    if !s.header_text.is_empty() {
        let bytes = encode(&s.header_text);
        let hs = size * 0.9;
        let (x, y) = (pager.left, page_h - pager.top / 2.0);
        for page in pager.pages.iter_mut().skip(first_numbered) {
            page.extend_from_slice(&text_op(x, y, &bytes, Sty::default(), hs));
        }
    }
    if s.page_numbers {
        let surname = c.author.split_whitespace().last().unwrap_or("").to_string();
        let total = pager.pages.len();
        for idx in first_numbered..total {
            let n = idx - first_numbered + 1;
            let plain = Sty::default();
            if s.preset == "manuscript" {
                let mut label = String::new();
                if !surname.is_empty() {
                    label.push_str(&format!("{surname} / "));
                }
                label.push_str(&format!("{} / {n}", c.title.to_uppercase()));
                let bytes = encode(&label);
                let w = m.width(&bytes, plain, size);
                let x = page_w - pager.right - w;
                let y = page_h - pager.top / 2.0;
                pager.pages[idx].extend_from_slice(&text_op(x, y, &bytes, plain, size));
            } else {
                let bytes = encode(&n.to_string());
                let w = m.width(&bytes, plain, size * 0.9);
                let x = (page_w - w) / 2.0;
                let y = pager.bottom / 2.0;
                pager.pages[idx].extend_from_slice(&text_op(x, y, &bytes, plain, size * 0.9));
            }
        }
    }

    assemble(c, family, page_w, page_h, &pager.pages)
}

fn text_op(x: f32, y: f32, text: &[u8], sty: Sty, size: f32) -> Vec<u8> {
    let mut ops = format!("BT /F{} {size:.2} Tf {x:.2} {y:.2} Td ", sty.font_index()).into_bytes();
    pdf_string(text, &mut ops);
    ops.extend_from_slice(b" Tj ET\n");
    ops
}

/// Write the object graph, cross-reference table and trailer.
fn assemble(c: &Compiled, family: Family, page_w: f32, page_h: f32, pages: &[Vec<u8>]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut offsets: Vec<usize> = Vec::new();
    out.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

    // Object numbering: 1 catalog, 2 pages, 3-7 fonts, 8 info, then
    // (page, content) pairs.
    let first_page_obj = 9;
    let kids: Vec<String> = (0..pages.len())
        .map(|i| format!("{} 0 R", first_page_obj + i * 2))
        .collect();

    let obj = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &[u8]| {
        offsets.push(out.len());
        let n = offsets.len();
        out.extend_from_slice(format!("{n} 0 obj\n").as_bytes());
        out.extend_from_slice(body);
        out.extend_from_slice(b"\nendobj\n");
    };

    obj(&mut out, &mut offsets, b"<< /Type /Catalog /Pages 2 0 R >>");
    obj(
        &mut out,
        &mut offsets,
        format!("<< /Type /Pages /Kids [{}] /Count {} >>", kids.join(" "), pages.len()).as_bytes(),
    );
    let mut fonts: Vec<&str> = family.base_fonts().to_vec();
    fonts.push("Courier");
    for f in fonts {
        obj(
            &mut out,
            &mut offsets,
            format!("<< /Type /Font /Subtype /Type1 /BaseFont /{f} /Encoding /WinAnsiEncoding >>").as_bytes(),
        );
    }
    let mut info = b"<< /Producer (ScribeForge) /Title ".to_vec();
    pdf_string(&encode(&c.title), &mut info);
    if !c.author.is_empty() {
        info.extend_from_slice(b" /Author ");
        pdf_string(&encode(&c.author), &mut info);
    }
    info.extend_from_slice(
        format!(" /CreationDate (D:{}Z) >>", chrono::Utc::now().format("%Y%m%d%H%M%S")).as_bytes(),
    );
    obj(&mut out, &mut offsets, &info);

    for (i, content) in pages.iter().enumerate() {
        let content_obj = first_page_obj + i * 2 + 1;
        obj(
            &mut out,
            &mut offsets,
            format!(
                "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {page_w:.2} {page_h:.2}] \
                 /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R /F4 6 0 R /F5 7 0 R >> >> \
                 /Contents {content_obj} 0 R >>"
            )
            .as_bytes(),
        );
        let mut stream = format!("<< /Length {} >>\nstream\n", content.len()).into_bytes();
        stream.extend_from_slice(content);
        stream.extend_from_slice(b"\nendstream");
        obj(&mut out, &mut offsets, &stream);
    }

    let xref_at = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n0000000000 65535 f \n", offsets.len() + 1).as_bytes());
    for off in &offsets {
        out.extend_from_slice(format!("{off:010} 00000 n \n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R /Info 8 0 R >>\nstartxref\n{xref_at}\n%%EOF\n",
            offsets.len() + 1
        )
        .as_bytes(),
    );
    out
}
