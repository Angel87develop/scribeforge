//! HTML writer. The block and inline renderers here are XHTML-safe so the
//! EPUB writer reuses them for its chapter files.

use super::{is_centered_style, span_link, span_style, CompileSettings, Compiled, Flow};
use crate::project::document::{Block, ParaAttrs, Span};

pub fn to_html(c: &Compiled) -> String {
    let s = c.settings;
    let mut body = String::new();
    if s.title_page {
        body.push_str(&title_page_html(c));
    }
    for f in c.flow() {
        flow_html(&f, s, &mut body);
    }
    format!(
        "<!DOCTYPE html>\n<html lang=\"{lang}\">\n<head>\n<meta charset=\"utf-8\" />\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />\n\
         <meta name=\"generator\" content=\"ScribeForge\" />\n{author}<title>{title}</title>\n\
         <style>\n{css}</style>\n</head>\n<body>\n<main>\n{body}</main>\n</body>\n</html>\n",
        lang = escape(&s.language),
        author = if c.author.is_empty() {
            String::new()
        } else {
            format!("<meta name=\"author\" content=\"{}\" />\n", escape(&c.author))
        },
        title = escape(&c.title),
        css = css(s, false),
        body = body,
    )
}

pub fn title_page_html(c: &Compiled) -> String {
    let mut out = String::from("<section class=\"title-page\">\n");
    out.push_str(&format!("<h1 class=\"book-title\">{}</h1>\n", escape(&c.title)));
    if !c.author.is_empty() {
        out.push_str(&format!("<p class=\"book-author\">by {}</p>\n", escape(&c.author)));
    }
    out.push_str("</section>\n");
    out
}

/// Render one flow event. `new_page` becomes a CSS page break.
pub fn flow_html(f: &Flow, s: &CompileSettings, out: &mut String) {
    match f {
        Flow::Section { title, show_title, level, chapter, new_page } => {
            if *show_title {
                let mut classes = vec![if *chapter { "chapter-title" } else { "section-title" }];
                if *new_page {
                    classes.push("page-break");
                }
                out.push_str(&format!(
                    "<h{l} class=\"{c}\">{t}</h{l}>\n",
                    l = level,
                    c = classes.join(" "),
                    t = escape(title)
                ));
            } else if *new_page {
                out.push_str("<div class=\"page-break\"></div>\n");
            }
        }
        Flow::Separator => {
            let text = if s.separator.trim().is_empty() {
                "&#160;".to_string()
            } else {
                escape(&s.separator)
            };
            out.push_str(&format!("<p class=\"separator\">{text}</p>\n"));
        }
        Flow::Block(b) => block_html(b, s.keep_formatting, out),
    }
}

pub fn block_html(b: &Block, keep: bool, out: &mut String) {
    match b {
        Block::Paragraph { attrs, spans } => {
            out.push_str(&format!("<p{}>{}</p>\n", para_attrs(attrs), inline_html(spans, keep)));
        }
        Block::Heading { level, attrs, spans } => {
            let l = (*level).clamp(1, 6);
            out.push_str(&format!("<h{l}{}>{}</h{l}>\n", para_attrs(attrs), inline_html(spans, keep)));
        }
        Block::BlockQuote { attrs, spans } => {
            out.push_str(&format!(
                "<blockquote><p{}>{}</p></blockquote>\n",
                para_attrs(attrs),
                inline_html(spans, keep)
            ));
        }
        Block::ListUnordered { items } | Block::ListOrdered { items } => {
            let tag = if matches!(b, Block::ListOrdered { .. }) { "ol" } else { "ul" };
            out.push_str(&format!("<{tag}>\n"));
            for it in items {
                out.push_str(&format!("<li>{}</li>\n", inline_html(&it.spans, keep)));
            }
            out.push_str(&format!("</{tag}>\n"));
        }
        Block::CodeBlock { text } => {
            out.push_str(&format!("<pre><code>{}</code></pre>\n", escape(text)));
        }
        Block::Divider => out.push_str("<hr />\n"),
    }
}

fn para_attrs(a: &ParaAttrs) -> String {
    let mut out = String::new();
    if let Some(style) = &a.style {
        let class: String = style
            .chars()
            .map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' })
            .collect();
        out.push_str(&format!(" class=\"sf-{class}\""));
    }
    let align = a
        .align
        .as_deref()
        .or(if is_centered_style(a.style.as_deref()) { Some("center") } else { None });
    if let Some(al) = align {
        if matches!(al, "center" | "right" | "justify") {
            out.push_str(&format!(" style=\"text-align: {al}; text-indent: 0\""));
        }
    }
    out
}

pub fn inline_html(spans: &[Span], keep: bool) -> String {
    let mut out = String::new();
    for span in spans {
        if span.text.is_empty() {
            continue;
        }
        let st = span_style(span, keep);
        let mut t = escape(&span.text);
        if st.code {
            t = format!("<code>{t}</code>");
        }
        if st.strike {
            t = format!("<s>{t}</s>");
        }
        if st.underline {
            t = format!("<u>{t}</u>");
        }
        if st.italic {
            t = format!("<em>{t}</em>");
        }
        if st.bold {
            t = format!("<strong>{t}</strong>");
        }
        if keep {
            if let Some(href) = span_link(span) {
                t = format!("<a href=\"{}\">{t}</a>", escape(href));
            }
        }
        out.push_str(&t);
    }
    out
}

/// XML/HTML escape. Uses numeric entities only, so the result is valid XHTML.
pub fn escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            // Control characters are not allowed in XML.
            c if (c as u32) < 0x20 && !matches!(c, '\n' | '\t' | '\r') => {}
            c => out.push(c),
        }
    }
    out
}

/// Stylesheet derived from the compile settings. `ebook` drops the page-like
/// centering, which reading systems handle themselves.
pub fn css(s: &CompileSettings, ebook: bool) -> String {
    let family = css_font_stack(&s.font_family);
    let line = 1.15 * s.line_spacing;
    let indent = s.first_line_indent;
    let mut css = String::new();
    if ebook {
        css.push_str(&format!(
            "body {{ font-family: {family}; line-height: {line:.2}; margin: 0 4%; }}\n"
        ));
    } else {
        css.push_str(&format!(
            "body {{ font-family: {family}; font-size: {size}pt; line-height: {line:.2}; \
             color: #1d1b18; background: #fdfcf9; margin: 0; }}\n\
             main {{ max-width: 40em; margin: 0 auto; padding: 3em 1.5em 6em; }}\n",
            size = s.font_size,
        ));
    }
    let align = if s.justified() { " text-align: justify; hyphens: auto;" } else { "" };
    let chapter_size = if s.chapter_title_size > 0.0 {
        format!(" font-size: {}pt;", s.chapter_title_size)
    } else {
        String::new()
    };
    css.push_str(&format!(
        "p {{ margin: {pb}pt 0 {ps}pt; text-indent: {indent}in;{align} }}\n\
         h1, h2, h3, h4, h5, h6 {{ line-height: 1.3; font-weight: bold; }}\n\
         .chapter-title {{ text-align: center; margin: 2em 0 1.5em;{chapter_size} }}\n\
         .section-title {{ margin: 1.5em 0 0.8em; }}\n\
         h1 + p, h2 + p, h3 + p, h4 + p, h5 + p, h6 + p, .separator + p, blockquote + p {{ text-indent: 0; }}\n\
         .separator {{ text-align: center; text-indent: 0; margin: 1em 0; }}\n\
         .page-break {{ page-break-before: always; break-before: page; }}\n\
         .title-page {{ text-align: center; margin: 30vh 0 4em; page-break-after: always; break-after: page; }}\n\
         .book-title {{ font-size: 2em; margin-bottom: 0.5em; }}\n\
         .book-author {{ text-indent: 0; text-align: center; font-style: italic; }}\n\
         blockquote {{ margin: 1em 2em; font-style: italic; }}\n\
         blockquote p {{ text-indent: 0; }}\n\
         pre {{ white-space: pre-wrap; font-family: \"Courier New\", monospace; font-size: 0.9em; }}\n\
         hr {{ border: none; border-top: 1px solid #999; margin: 2em 20%; }}\n\
         .sf-title, .sf-subtitle {{ text-align: center; text-indent: 0; }}\n\
         .sf-verse {{ text-indent: 0; margin-left: 2em; }}\n\
         .sf-caption, .sf-attribution {{ text-align: right; text-indent: 0; font-style: italic; }}\n",
        ps = s.paragraph_spacing,
        pb = s.paragraph_spacing_before,
    ));
    css
}

fn css_font_stack(family: &str) -> String {
    let f = family.replace(['"', ';', '{', '}'], "");
    let lower = f.to_lowercase();
    let generic = if lower.contains("courier") || lower.contains("mono") {
        "\"Courier New\", Courier, monospace"
    } else if lower.contains("arial") || lower.contains("helvetica") || lower.contains("sans") {
        "Helvetica, Arial, sans-serif"
    } else {
        "Georgia, \"Times New Roman\", serif"
    };
    if f.trim().is_empty() {
        generic.to_string()
    } else {
        format!("\"{}\", {generic}", f.trim())
    }
}
