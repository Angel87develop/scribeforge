//! Word (DOCX / Office Open XML) writer.
//!
//! Produces the minimal set of parts Word, LibreOffice and Google Docs need:
//! content types, package relationships, the main document, a style sheet,
//! a page-number header or footer, and core properties.

use std::io::{Cursor, Write};

use chrono::Utc;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::html::escape;
use super::{is_centered_style, span_style, CompileSettings, Compiled, Flow};
use crate::errors::AppResult;
use crate::project::document::{Block, ParaAttrs, Span};

const W_NS: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R_NS: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

fn twips(inches: f32) -> i64 {
    (inches * 1440.0).round() as i64
}

/// Paragraph being emitted, before it is serialised.
struct Para<'a> {
    style: &'static str,
    align: Option<&'a str>,
    first_line: Option<i64>,
    left: Option<i64>,
    page_break: bool,
    runs: String,
}

impl<'a> Para<'a> {
    fn new(style: &'static str) -> Self {
        Self { style, align: None, first_line: None, left: None, page_break: false, runs: String::new() }
    }

    fn xml(&self) -> String {
        let mut ppr = format!("<w:pStyle w:val=\"{}\"/>", self.style);
        if self.page_break {
            ppr.push_str("<w:pageBreakBefore/>");
        }
        if self.first_line.is_some() || self.left.is_some() {
            ppr.push_str("<w:ind");
            if let Some(l) = self.left {
                ppr.push_str(&format!(" w:left=\"{l}\""));
            }
            if let Some(f) = self.first_line {
                ppr.push_str(&format!(" w:firstLine=\"{f}\""));
            }
            ppr.push_str("/>");
        }
        if let Some(al) = self.align {
            let v = match al {
                "center" => "center",
                "right" => "right",
                "justify" => "both",
                _ => "left",
            };
            ppr.push_str(&format!("<w:jc w:val=\"{v}\"/>"));
        }
        format!("<w:p><w:pPr>{ppr}</w:pPr>{}</w:p>", self.runs)
    }
}

struct Writer<'a> {
    s: &'a CompileSettings,
    body: String,
    pending_break: bool,
    /// The next body paragraph follows a heading or separator: no indent.
    after_break: bool,
}

impl<'a> Writer<'a> {
    fn push(&mut self, mut p: Para) {
        if self.pending_break {
            p.page_break = true;
            self.pending_break = false;
        }
        self.body.push_str(&p.xml());
        self.body.push('\n');
    }

    fn body_para(&mut self, attrs: &'a ParaAttrs, spans: &[Span]) {
        let mut p = Para::new("Normal");
        let centered = is_centered_style(attrs.style.as_deref());
        p.align = attrs.align.as_deref().or(if centered { Some("center") } else { None });
        if !self.after_break && !centered && p.align.map_or(true, |a| a == "left" || a == "justify") {
            p.first_line = Some(twips(self.s.first_line_indent));
        } else {
            p.first_line = Some(0);
        }
        p.runs = runs(spans, self.s.keep_formatting);
        self.push(p);
        self.after_break = false;
    }

    fn flow(&mut self, f: &Flow<'a>) {
        match f {
            Flow::Section { title, show_title, level, chapter, new_page } => {
                if *new_page {
                    self.pending_break = true;
                }
                if *show_title {
                    let style = match level {
                        1 => "Heading1",
                        2 => "Heading2",
                        3 => "Heading3",
                        _ => "Heading4",
                    };
                    let mut p = Para::new(style);
                    let mut rpr = String::new();
                    if *chapter {
                        p.align = Some("center");
                        if self.s.chapter_title_size > 0.0 {
                            let hs = (self.s.chapter_title_size * 2.0).round() as i64;
                            rpr = format!("<w:sz w:val=\"{hs}\"/><w:szCs w:val=\"{hs}\"/>");
                        }
                    }
                    p.runs = text_run(title, &rpr);
                    self.push(p);
                }
                self.after_break = true;
            }
            Flow::Separator => {
                let mut p = Para::new("Normal");
                p.align = Some("center");
                p.first_line = Some(0);
                p.runs = text_run(&self.s.separator, "");
                self.push(p);
                self.after_break = true;
            }
            Flow::Block(b) => self.block(b),
        }
    }

    fn block(&mut self, b: &'a Block) {
        let keep = self.s.keep_formatting;
        match b {
            Block::Paragraph { attrs, spans } => self.body_para(attrs, spans),
            Block::Heading { level, attrs, spans } => {
                let style = match level {
                    1 => "Heading2",
                    2 => "Heading3",
                    _ => "Heading4",
                };
                let mut p = Para::new(style);
                p.align = attrs.align.as_deref();
                p.runs = runs(spans, keep);
                self.push(p);
                self.after_break = true;
            }
            Block::BlockQuote { spans, .. } => {
                let mut p = Para::new("Quote");
                p.runs = runs(spans, keep);
                self.push(p);
                self.after_break = true;
            }
            Block::ListUnordered { items } | Block::ListOrdered { items } => {
                let ordered = matches!(b, Block::ListOrdered { .. });
                for (i, it) in items.iter().enumerate() {
                    let mut p = Para::new("Normal");
                    p.left = Some(twips(0.5));
                    p.first_line = Some(0);
                    let marker = if ordered { format!("{}. ", i + 1) } else { "\u{2022} ".to_string() };
                    p.runs = text_run(&marker, "");
                    p.runs.push_str(&runs(&it.spans, keep));
                    self.push(p);
                }
                self.after_break = true;
            }
            Block::CodeBlock { text } => {
                for line in text.lines() {
                    let mut p = Para::new("Code");
                    p.runs = text_run(line, "");
                    self.push(p);
                }
                self.after_break = true;
            }
            Block::Divider => {
                let mut p = Para::new("Normal");
                p.align = Some("center");
                p.first_line = Some(0);
                p.runs = text_run("* * *", "");
                self.push(p);
                self.after_break = true;
            }
        }
    }
}

fn runs(spans: &[Span], keep: bool) -> String {
    let mut out = String::new();
    for span in spans {
        if span.text.is_empty() {
            continue;
        }
        let st = span_style(span, keep);
        let mut rpr = String::new();
        if st.bold {
            rpr.push_str("<w:b/>");
        }
        if st.italic {
            rpr.push_str("<w:i/>");
        }
        if st.underline {
            rpr.push_str("<w:u w:val=\"single\"/>");
        }
        if st.strike {
            rpr.push_str("<w:strike/>");
        }
        if st.code {
            rpr.push_str(
                "<w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\" w:cs=\"Courier New\"/>",
            );
        }
        out.push_str(&text_run(&span.text, &rpr));
    }
    out
}

/// One `<w:r>`; line breaks inside the text become `<w:br/>`.
fn text_run(text: &str, rpr: &str) -> String {
    let mut inner = String::new();
    for (i, line) in text.split('\n').enumerate() {
        if i > 0 {
            inner.push_str("<w:br/>");
        }
        inner.push_str(&format!("<w:t xml:space=\"preserve\">{}</w:t>", escape(line)));
    }
    if rpr.is_empty() {
        format!("<w:r>{inner}</w:r>")
    } else {
        format!("<w:r><w:rPr>{rpr}</w:rPr>{inner}</w:r>")
    }
}

pub fn to_docx(c: &Compiled) -> AppResult<Vec<u8>> {
    let s = c.settings;
    let mut w = Writer { s, body: String::new(), pending_break: false, after_break: true };

    if s.title_page {
        if s.preset == "manuscript" {
            let mut p = Para::new("Normal");
            p.align = Some("right");
            p.first_line = Some(0);
            p.runs = text_run(&format!("About {} words", round_words(c.word_count())), "");
            w.push(p);
        }
        let mut p = Para::new("Title");
        p.runs = text_run(&s.title_text(&c.title), "");
        w.push(p);
        if !c.author.is_empty() {
            let mut p = Para::new("Normal");
            p.align = Some("center");
            p.first_line = Some(0);
            p.runs = text_run(&format!("by {}", c.author), "");
            w.push(p);
        }
        w.pending_break = true;
    }
    for f in c.flow() {
        w.flow(&f);
    }
    let body = w.body;

    let (page_w, page_h) = s.page_size_points();
    let (page_w, page_h) = ((page_w * 20.0).round() as i64, (page_h * 20.0).round() as i64);
    let numbers_in_header = s.page_numbers && s.preset == "manuscript";
    let use_header = numbers_in_header || !s.header_text.is_empty();
    let use_footer = s.page_numbers && !numbers_in_header;
    let mut sect = String::from("<w:sectPr>");
    if use_header {
        sect.push_str("<w:headerReference w:type=\"default\" r:id=\"rId2\"/>");
    }
    if use_footer {
        sect.push_str("<w:footerReference w:type=\"default\" r:id=\"rId3\"/>");
    }
    sect.push_str(&format!(
        "<w:pgSz w:w=\"{page_w}\" w:h=\"{page_h}\"/>\
         <w:pgMar w:top=\"{m}\" w:right=\"{m}\" w:bottom=\"{m}\" w:left=\"{ml}\" w:header=\"720\" w:footer=\"720\" w:gutter=\"0\"/>",
        m = twips(s.margin),
        ml = twips(s.margin_left),
    ));
    if s.title_page {
        sect.push_str("<w:titlePg/>");
    }
    sect.push_str("</w:sectPr>");

    let document = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<w:document xmlns:w=\"{W_NS}\" xmlns:r=\"{R_NS}\"><w:body>\n{body}{sect}</w:body></w:document>\n"
    );

    let mut rels = String::from(
        "<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/>",
    );
    let mut overrides = String::new();
    if use_header {
        rels.push_str("<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/header\" Target=\"header1.xml\"/>");
        overrides.push_str("<Override PartName=\"/word/header1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml\"/>");
    }
    if use_footer {
        rels.push_str("<Relationship Id=\"rId3\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer\" Target=\"footer1.xml\"/>");
        overrides.push_str("<Override PartName=\"/word/footer1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml\"/>");
    }

    let content_types = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">\
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>\
<Default Extension=\"xml\" ContentType=\"application/xml\"/>\
<Override PartName=\"/word/document.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml\"/>\
<Override PartName=\"/word/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml\"/>\
{overrides}\
<Override PartName=\"/docProps/core.xml\" ContentType=\"application/vnd.openxmlformats-package.core-properties+xml\"/>\
</Types>\n"
    );

    let package_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">\
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"word/document.xml\"/>\
<Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties\" Target=\"docProps/core.xml\"/>\
</Relationships>\n";

    let document_rels = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">{rels}</Relationships>\n"
    );

    let now = Utc::now().format("%Y-%m-%dT%H:%M:%SZ");
    let core = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" \
xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">\
<dc:title>{title}</dc:title><dc:creator>{author}</dc:creator>\
<dcterms:created xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:created>\
<dcterms:modified xsi:type=\"dcterms:W3CDTF\">{now}</dcterms:modified>\
</cp:coreProperties>\n",
        title = escape(&c.title),
        author = escape(&c.author),
    );

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buf);
        let opts = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        let mut put = |name: &str, data: &str| -> AppResult<()> {
            zip.start_file(name, opts)?;
            zip.write_all(data.as_bytes())?;
            Ok(())
        };
        put("[Content_Types].xml", &content_types)?;
        put("_rels/.rels", package_rels)?;
        put("word/_rels/document.xml.rels", &document_rels)?;
        put("word/document.xml", &document)?;
        put("word/styles.xml", &styles_xml(s))?;
        if use_header {
            let mut paras = String::new();
            if !s.header_text.is_empty() {
                paras.push_str(&format!(
                    "<w:p><w:pPr><w:jc w:val=\"left\"/></w:pPr>{}</w:p>",
                    text_run(&s.header_text, "")
                ));
            }
            if numbers_in_header {
                let surname = c.author.split_whitespace().last().unwrap_or("").to_string();
                let mut label = String::new();
                if !surname.is_empty() {
                    label.push_str(&format!("{surname} / "));
                }
                label.push_str(&format!("{} / ", c.title.to_uppercase()));
                paras.push_str(&page_number_para("right", &label));
            }
            put("word/header1.xml", &part("hdr", &paras))?;
        }
        if use_footer {
            put("word/footer1.xml", &part("ftr", &page_number_para("center", "")))?;
        }
        put("docProps/core.xml", &core)?;
        zip.finish()?;
    }
    Ok(buf.into_inner())
}

/// Header (`hdr`) or footer (`ftr`) part holding the given paragraphs.
fn part(tag: &str, paras: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<w:{tag} xmlns:w=\"{W_NS}\" xmlns:r=\"{R_NS}\">{paras}</w:{tag}>\n"
    )
}

/// Paragraph holding `prefix` followed by a PAGE field.
fn page_number_para(align: &str, prefix: &str) -> String {
    let prefix_run = if prefix.is_empty() { String::new() } else { text_run(prefix, "") };
    format!(
        "<w:p><w:pPr><w:jc w:val=\"{align}\"/></w:pPr>{prefix_run}\
<w:r><w:fldChar w:fldCharType=\"begin\"/></w:r>\
<w:r><w:instrText xml:space=\"preserve\"> PAGE </w:instrText></w:r>\
<w:r><w:fldChar w:fldCharType=\"separate\"/></w:r><w:r><w:t>1</w:t></w:r>\
<w:r><w:fldChar w:fldCharType=\"end\"/></w:r></w:p>"
    )
}

fn styles_xml(s: &CompileSettings) -> String {
    let font = escape(&s.font_family);
    let sz = (s.font_size * 2.0).round() as i64;
    let line = (240.0 * s.line_spacing).round() as i64;
    let after = (s.paragraph_spacing * 20.0).round() as i64;
    let before = (s.paragraph_spacing_before * 20.0).round() as i64;
    let normal_ppr = if s.justified() { "<w:pPr><w:jc w:val=\"both\"/></w:pPr>" } else { "" };
    let heading = |id: &str, name: &str, scale: f32, before: i64| {
        format!(
            "<w:style w:type=\"paragraph\" w:styleId=\"{id}\"><w:name w:val=\"{name}\"/>\
             <w:basedOn w:val=\"Normal\"/><w:next w:val=\"Normal\"/><w:qFormat/>\
             <w:pPr><w:keepNext/><w:spacing w:before=\"{before}\" w:after=\"{a}\"/><w:ind w:firstLine=\"0\"/></w:pPr>\
             <w:rPr><w:b/><w:sz w:val=\"{hs}\"/><w:szCs w:val=\"{hs}\"/></w:rPr></w:style>",
            a = 240.max(after),
            hs = (sz as f32 * scale).round() as i64,
        )
    };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n\
<w:styles xmlns:w=\"{W_NS}\">\
<w:docDefaults><w:rPrDefault><w:rPr>\
<w:rFonts w:ascii=\"{font}\" w:hAnsi=\"{font}\" w:cs=\"{font}\" w:eastAsia=\"{font}\"/>\
<w:sz w:val=\"{sz}\"/><w:szCs w:val=\"{sz}\"/><w:lang w:val=\"{lang}\"/></w:rPr></w:rPrDefault>\
<w:pPrDefault><w:pPr><w:spacing w:before=\"{before}\" w:after=\"{after}\" w:line=\"{line}\" w:lineRule=\"auto\"/></w:pPr></w:pPrDefault>\
</w:docDefaults>\
<w:style w:type=\"paragraph\" w:default=\"1\" w:styleId=\"Normal\"><w:name w:val=\"Normal\"/><w:qFormat/>{normal_ppr}</w:style>\
{h1}{h2}{h3}{h4}\
<w:style w:type=\"paragraph\" w:styleId=\"Title\"><w:name w:val=\"Title\"/><w:basedOn w:val=\"Normal\"/><w:qFormat/>\
<w:pPr><w:spacing w:before=\"4320\" w:after=\"480\"/><w:jc w:val=\"center\"/><w:ind w:firstLine=\"0\"/></w:pPr>\
<w:rPr><w:b/><w:sz w:val=\"{ts}\"/><w:szCs w:val=\"{ts}\"/></w:rPr></w:style>\
<w:style w:type=\"paragraph\" w:styleId=\"Quote\"><w:name w:val=\"Quote\"/><w:basedOn w:val=\"Normal\"/>\
<w:pPr><w:ind w:left=\"720\" w:right=\"720\" w:firstLine=\"0\"/></w:pPr><w:rPr><w:i/></w:rPr></w:style>\
<w:style w:type=\"paragraph\" w:styleId=\"Code\"><w:name w:val=\"Code\"/><w:basedOn w:val=\"Normal\"/>\
<w:pPr><w:spacing w:after=\"0\" w:line=\"240\" w:lineRule=\"auto\"/><w:ind w:firstLine=\"0\"/></w:pPr>\
<w:rPr><w:rFonts w:ascii=\"Courier New\" w:hAnsi=\"Courier New\" w:cs=\"Courier New\"/></w:rPr></w:style>\
</w:styles>\n",
        lang = escape(&s.language),
        h1 = heading("Heading1", "heading 1", 1.5, 480),
        h2 = heading("Heading2", "heading 2", 1.3, 360),
        h3 = heading("Heading3", "heading 3", 1.15, 240),
        h4 = heading("Heading4", "heading 4", 1.0, 240),
        ts = sz * 2,
    )
}

/// Word counts on a manuscript title page are rounded to a friendly figure.
pub fn round_words(n: u32) -> String {
    let rounded = if n < 1000 {
        ((n + 50) / 100) * 100
    } else {
        ((n + 500) / 1000) * 1000
    };
    let s = rounded.max(if n > 0 { 100 } else { 0 }).to_string();
    // Thousands separators.
    let mut out = String::new();
    for (i, ch) in s.chars().enumerate() {
        if i > 0 && (s.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(ch);
    }
    out
}
