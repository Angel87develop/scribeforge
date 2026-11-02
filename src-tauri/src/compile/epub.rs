//! EPUB 3 writer (with an EPUB 2 `toc.ncx` for older readers).
//!
//! Every chapter (a folder, or a top-level document) becomes its own XHTML
//! file. The `mimetype` entry comes first and is stored uncompressed, as the
//! specification requires.

use std::io::{Cursor, Write};

use chrono::Utc;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::html::{css, escape, flow_html, title_page_html};
use super::{Compiled, Flow};
use crate::errors::AppResult;

struct Chapter {
    title: String,
    body: String,
}

pub fn to_epub(c: &Compiled) -> AppResult<Vec<u8>> {
    let s = c.settings;

    // Split the flow into chapter files.
    let mut chapters: Vec<Chapter> = Vec::new();
    for f in c.flow() {
        if let Flow::Section { title, chapter: true, .. } = &f {
            chapters.push(Chapter { title: title.clone(), body: String::new() });
        }
        if chapters.is_empty() {
            chapters.push(Chapter { title: c.title.clone(), body: String::new() });
        }
        // Each chapter starts its own file, so a page break is implied.
        let f = match f {
            Flow::Section { title, show_title, level, chapter, .. } => {
                Flow::Section { title, show_title, level, chapter, new_page: false }
            }
            other => other,
        };
        let ch = chapters.last_mut().expect("at least one chapter");
        flow_html(&f, s, &mut ch.body);
    }

    let mut buf = Cursor::new(Vec::new());
    {
        let mut zip = ZipWriter::new(&mut buf);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);

        zip.start_file("mimetype", stored)?;
        zip.write_all(b"application/epub+zip")?;

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(
            b"<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n\
  <rootfiles>\n\
    <rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/>\n\
  </rootfiles>\n\
</container>\n",
        )?;

        zip.start_file("OEBPS/style.css", deflated)?;
        zip.write_all(css(s, true).as_bytes())?;

        if s.title_page {
            zip.start_file("OEBPS/title.xhtml", deflated)?;
            zip.write_all(xhtml_page(&c.title, &s.language, &title_page_html(c)).as_bytes())?;
        }

        for (i, ch) in chapters.iter().enumerate() {
            zip.start_file(format!("OEBPS/chapter-{}.xhtml", i + 1), deflated)?;
            zip.write_all(xhtml_page(&ch.title, &s.language, &ch.body).as_bytes())?;
        }

        zip.start_file("OEBPS/nav.xhtml", deflated)?;
        zip.write_all(nav_xhtml(c, &chapters).as_bytes())?;

        zip.start_file("OEBPS/toc.ncx", deflated)?;
        zip.write_all(toc_ncx(c, &chapters).as_bytes())?;

        zip.start_file("OEBPS/content.opf", deflated)?;
        zip.write_all(content_opf(c, chapters.len()).as_bytes())?;

        zip.finish()?;
    }
    Ok(buf.into_inner())
}

fn xhtml_page(title: &str, lang: &str, body: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n\
<html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" lang=\"{lang}\" xml:lang=\"{lang}\">\n\
<head>\n<meta charset=\"utf-8\" />\n<title>{title}</title>\n<link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\" />\n</head>\n\
<body>\n{body}</body>\n</html>\n",
        lang = escape(lang),
        title = escape(title),
        body = body,
    )
}

fn chapter_label(ch: &Chapter, i: usize) -> String {
    if ch.title.trim().is_empty() {
        format!("Chapter {}", i + 1)
    } else {
        ch.title.clone()
    }
}

fn nav_xhtml(c: &Compiled, chapters: &[Chapter]) -> String {
    let mut items = String::new();
    if c.settings.title_page {
        items.push_str("<li><a href=\"title.xhtml\">Title Page</a></li>\n");
    }
    for (i, ch) in chapters.iter().enumerate() {
        items.push_str(&format!(
            "<li><a href=\"chapter-{}.xhtml\">{}</a></li>\n",
            i + 1,
            escape(&chapter_label(ch, i))
        ));
    }
    let body = format!(
        "<nav epub:type=\"toc\" id=\"toc\">\n<h1>Contents</h1>\n<ol>\n{items}</ol>\n</nav>\n"
    );
    xhtml_page("Contents", &c.settings.language, &body)
}

fn toc_ncx(c: &Compiled, chapters: &[Chapter]) -> String {
    let mut points = String::new();
    let mut order = 1;
    if c.settings.title_page {
        points.push_str(&format!(
            "<navPoint id=\"nav-title\" playOrder=\"{order}\"><navLabel><text>Title Page</text></navLabel>\
             <content src=\"title.xhtml\"/></navPoint>\n"
        ));
        order += 1;
    }
    for (i, ch) in chapters.iter().enumerate() {
        points.push_str(&format!(
            "<navPoint id=\"nav-{n}\" playOrder=\"{order}\"><navLabel><text>{t}</text></navLabel>\
             <content src=\"chapter-{n}.xhtml\"/></navPoint>\n",
            n = i + 1,
            t = escape(&chapter_label(ch, i)),
        ));
        order += 1;
    }
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<ncx xmlns=\"http://www.daisy.org/z3986/2005/ncx/\" version=\"2005-1\">\n\
<head><meta name=\"dtb:uid\" content=\"urn:uuid:{id}\"/></head>\n\
<docTitle><text>{title}</text></docTitle>\n<navMap>\n{points}</navMap>\n</ncx>\n",
        id = c.project_id,
        title = escape(&c.title),
    )
}

fn content_opf(c: &Compiled, chapter_count: usize) -> String {
    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n\
         <item id=\"ncx\" href=\"toc.ncx\" media-type=\"application/x-dtbncx+xml\"/>\n\
         <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n",
    );
    let mut spine = String::new();
    if c.settings.title_page {
        manifest.push_str("<item id=\"title\" href=\"title.xhtml\" media-type=\"application/xhtml+xml\"/>\n");
        spine.push_str("<itemref idref=\"title\"/>\n");
    }
    for i in 1..=chapter_count {
        manifest.push_str(&format!(
            "<item id=\"ch{i}\" href=\"chapter-{i}.xhtml\" media-type=\"application/xhtml+xml\"/>\n"
        ));
        spine.push_str(&format!("<itemref idref=\"ch{i}\"/>\n"));
    }
    let creator = if c.author.is_empty() {
        String::new()
    } else {
        format!("<dc:creator>{}</dc:creator>\n", escape(&c.author))
    };
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
<package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"bookid\" xml:lang=\"{lang}\">\n\
<metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n\
<dc:identifier id=\"bookid\">urn:uuid:{id}</dc:identifier>\n\
<dc:title>{title}</dc:title>\n{creator}<dc:language>{lang}</dc:language>\n\
<meta property=\"dcterms:modified\">{modified}</meta>\n\
</metadata>\n<manifest>\n{manifest}</manifest>\n<spine toc=\"ncx\">\n{spine}</spine>\n</package>\n",
        lang = escape(&c.settings.language),
        id = c.project_id,
        title = escape(&c.title),
        modified = Utc::now().format("%Y-%m-%dT%H:%M:%SZ"),
    )
}
