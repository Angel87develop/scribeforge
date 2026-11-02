//! Tests for compiling a project to TXT, Markdown, HTML, DOCX, PDF and EPUB,
//! for document selection and presets, and for subdocuments in the binder.

use std::io::{Cursor, Read};

use scribeforge_lib::compile::{
    collect, compile, preset_settings, presets, CompileFormat, CompileRequest, CompileSettings,
};
use scribeforge_lib::project::document::{Block, DocumentKind, Mark, ParaAttrs, RichDoc, Span};
use scribeforge_lib::project::model::Project;
use scribeforge_lib::templates::build_project_from_template;
use uuid::Uuid;

struct Fixture {
    project: Project,
    chapter: Uuid,
    scene1: Uuid,
    scene2: Uuid,
    note: Uuid,
}

/// Manuscript > "Chapter One" (folder) > "Scene A", "Scene B";
/// Research > "Note".
fn fixture() -> Fixture {
    let mut p = build_project_from_template("blank/blank", "My Novel".into(), Some("Ana Pérez".into())).unwrap();
    let draft = p.root_id(DocumentKind::DraftRoot).unwrap();
    let research = p.root_id(DocumentKind::ResearchRoot).unwrap();
    let chapter = p.create_child(draft, DocumentKind::Folder, "Chapter One").unwrap();
    let scene1 = p.create_child(chapter, DocumentKind::Document, "Scene A").unwrap();
    let scene2 = p.create_child(chapter, DocumentKind::Document, "Scene B").unwrap();
    let note = p.create_child(research, DocumentKind::Research, "Note").unwrap();

    p.get_mut(scene1).unwrap().content = RichDoc {
        blocks: vec![Block::Paragraph {
            attrs: ParaAttrs::default(),
            spans: vec![
                Span { text: "It was a ".into(), marks: vec![] },
                Span { text: "dark".into(), marks: vec![Mark::Italic] },
                Span { text: " night, señor.".into(), marks: vec![] },
            ],
        }],
    };
    p.get_mut(scene2).unwrap().content = RichDoc::from_paragraph("The second scene <ends> here & now.");
    p.get_mut(note).unwrap().content = RichDoc::from_paragraph("Research only.");
    for id in [scene1, scene2, note] {
        p.get_mut(id).unwrap().touch();
    }
    Fixture { project: p, chapter, scene1, scene2, note }
}

fn request(format: CompileFormat, preset: &str) -> CompileRequest {
    CompileRequest {
        format,
        settings: preset_settings(preset).unwrap(),
        include: Vec::new(),
        title: None,
        author: None,
    }
}

fn zip_entries(bytes: &[u8]) -> Vec<String> {
    let zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    zip.file_names().map(str::to_string).collect()
}

fn zip_text(bytes: &[u8], name: &str) -> String {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
    let mut f = zip.by_name(name).unwrap();
    let mut s = String::new();
    f.read_to_string(&mut s).unwrap();
    s
}

#[test]
fn presets_are_listed_and_distinct() {
    let ids: Vec<String> = presets().into_iter().map(|p| p.id).collect();
    assert_eq!(ids, vec!["manuscript", "ebook", "screenplay"]);
    let m = preset_settings("manuscript").unwrap();
    assert!(m.font_family.contains("Courier"));
    assert_eq!(m.line_spacing, 2.0);
    let s = preset_settings("screenplay").unwrap();
    assert_eq!(s.margin_left, 1.5);
    assert_eq!(CompileSettings::default(), m);
}

#[test]
fn whole_manuscript_is_collected_in_binder_order_without_research() {
    let f = fixture();
    let items = collect(&f.project, &[]);
    let titles: Vec<&str> = items.iter().map(|i| i.title.as_str()).collect();
    assert_eq!(titles, vec!["Chapter One", "Scene A", "Scene B"]);
    assert_eq!(items[0].depth, 0);
    assert_eq!(items[1].depth, 1);
}

#[test]
fn selection_limits_what_is_compiled() {
    let f = fixture();
    let mut req = request(CompileFormat::Txt, "manuscript");
    req.include = vec![f.chapter, f.scene2, f.note];
    let txt = String::from_utf8(compile(&f.project, &req).unwrap()).unwrap();
    assert!(txt.contains("CHAPTER ONE"));
    assert!(txt.contains("second scene"));
    assert!(!txt.contains("dark"), "Scene A was not selected");
    assert!(txt.contains("Research only."), "selected research is included");

    req.include = vec![Uuid::new_v4()];
    assert!(compile(&f.project, &req).is_err(), "an empty selection is refused");
}

#[test]
fn txt_and_markdown_render_titles_separators_and_marks() {
    let f = fixture();
    let txt = String::from_utf8(compile(&f.project, &request(CompileFormat::Txt, "manuscript")).unwrap()).unwrap();
    assert!(txt.starts_with("My Novel\nby Ana Pérez"));
    assert!(txt.contains("CHAPTER ONE"));
    // Scene titles are hidden in the manuscript preset; a separator divides them.
    assert!(!txt.contains("Scene A"));
    assert!(txt.contains("\n#\n"));

    let md = String::from_utf8(compile(&f.project, &request(CompileFormat::Markdown, "manuscript")).unwrap()).unwrap();
    assert!(md.contains("# My Novel"));
    assert!(md.contains("## CHAPTER ONE"));
    assert!(md.contains("It was a *dark* night"));
    assert!(md.contains("\\#"), "the separator is escaped so it is not a heading");
    assert!(md.contains("\\<ends\\>"));
}

#[test]
fn html_is_escaped_and_styled() {
    let f = fixture();
    let html = String::from_utf8(compile(&f.project, &request(CompileFormat::Html, "ebook")).unwrap()).unwrap();
    assert!(html.starts_with("<!DOCTYPE html>"));
    assert!(html.contains("<em>dark</em>"));
    assert!(html.contains("&lt;ends&gt; here &amp; now"));
    assert!(html.contains("class=\"separator\">* * *</p>"));
    assert!(html.contains("Georgia"));
}

#[test]
fn docx_is_a_valid_package() {
    let f = fixture();
    let bytes = compile(&f.project, &request(CompileFormat::Docx, "manuscript")).unwrap();
    let names = zip_entries(&bytes);
    for required in [
        "[Content_Types].xml",
        "_rels/.rels",
        "word/document.xml",
        "word/styles.xml",
        "word/_rels/document.xml.rels",
        "word/header1.xml",
        "docProps/core.xml",
    ] {
        assert!(names.iter().any(|n| n == required), "missing {required}");
    }
    let doc = zip_text(&bytes, "word/document.xml");
    assert!(doc.contains("CHAPTER ONE"));
    assert!(doc.contains("<w:i/>"));
    assert!(doc.contains("&lt;ends&gt;"));
    assert!(doc.contains("<w:pageBreakBefore/>"));
    let styles = zip_text(&bytes, "word/styles.xml");
    assert!(styles.contains("Courier New"));
    assert!(styles.contains("w:line=\"480\""), "double spacing");
}

#[test]
fn pdf_has_valid_structure() {
    let f = fixture();
    let bytes = compile(&f.project, &request(CompileFormat::Pdf, "manuscript")).unwrap();
    assert!(bytes.starts_with(b"%PDF-1.4"));
    assert!(bytes.ends_with(b"%%EOF\n"));
    let text = String::from_utf8_lossy(&bytes);
    assert!(text.contains("/BaseFont /Courier"));
    assert!(text.contains("(CHAPTER ONE)"));
    // Title page plus one page of text.
    assert!(text.contains("/Count 2"));

    // startxref points at the xref table.
    let start = text.rfind("startxref\n").unwrap() + "startxref\n".len();
    let end = start + text[start..].find('\n').unwrap();
    let offset: usize = text[start..end].parse().unwrap();
    assert_eq!(&bytes[offset..offset + 4], b"xref");

    // "ñ" is written as its Windows-1252 byte.
    assert!(bytes.windows(2).any(|w| w == [b'e', 0xF1]));
}

#[test]
fn pdf_paginates_long_text() {
    let mut f = fixture();
    let long = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(400);
    f.project.get_mut(f.scene2).unwrap().content = RichDoc::from_paragraph(&long);
    let bytes = compile(&f.project, &request(CompileFormat::Pdf, "ebook")).unwrap();
    let text = String::from_utf8_lossy(&bytes);
    let count: usize = text
        .split("/Count ")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .and_then(|n| n.parse().ok())
        .unwrap();
    assert!(count > 3, "expected several pages, got {count}");
    assert!(text.contains("/BaseFont /Times-Roman"));
}

#[test]
fn epub_has_required_entries_and_chapters() {
    let f = fixture();
    let bytes = compile(&f.project, &request(CompileFormat::Epub, "ebook")).unwrap();
    let names = zip_entries(&bytes);
    assert_eq!(names[0], "mimetype", "mimetype must be the first entry");
    {
        let mut zip = zip::ZipArchive::new(Cursor::new(&bytes[..])).unwrap();
        let first = zip.by_index(0).unwrap();
        assert_eq!(first.compression(), zip::CompressionMethod::Stored);
    }
    for required in [
        "META-INF/container.xml",
        "OEBPS/content.opf",
        "OEBPS/nav.xhtml",
        "OEBPS/toc.ncx",
        "OEBPS/title.xhtml",
        "OEBPS/chapter-1.xhtml",
    ] {
        assert!(names.iter().any(|n| n == required), "missing {required}");
    }
    let opf = zip_text(&bytes, "OEBPS/content.opf");
    assert!(opf.contains("<dc:title>My Novel</dc:title>"));
    assert!(opf.contains("<dc:creator>Ana Pérez</dc:creator>"));
    let ch = zip_text(&bytes, "OEBPS/chapter-1.xhtml");
    assert!(ch.contains("Chapter One"));
    assert!(ch.contains("&lt;ends&gt;"));
    assert!(!ch.contains("&nbsp;"), "XHTML must not use HTML-only entities");
}

#[test]
fn title_and_author_can_be_overridden() {
    let f = fixture();
    let mut req = request(CompileFormat::Txt, "ebook");
    req.title = Some("Another Title".into());
    req.author = Some("Pen Name".into());
    let txt = String::from_utf8(compile(&f.project, &req).unwrap()).unwrap();
    assert!(txt.starts_with("Another Title\nby Pen Name"));
}

#[test]
fn subdocuments_are_listed_counted_and_compiled() {
    let mut f = fixture();
    let child = f.project.create_child(f.scene1, DocumentKind::Document, "Sub Scene").unwrap();
    f.project.get_mut(child).unwrap().content = RichDoc::from_paragraph("Nested words here.");
    f.project.get_mut(child).unwrap().touch();

    let listing = f.project.binder_listing();
    assert!(listing.iter().any(|d| d.id == child && d.parent == Some(f.scene1)));
    // 6 + 7 + 3 words.
    assert_eq!(f.project.manuscript_word_count(), 16);

    let items = collect(&f.project, &[]);
    let pos_parent = items.iter().position(|i| i.title == "Scene A").unwrap();
    assert_eq!(items[pos_parent + 1].title, "Sub Scene");
    assert_eq!(items[pos_parent + 1].depth, 2);
}

#[test]
fn moving_onto_a_document_makes_it_a_subdocument() {
    let mut f = fixture();
    f.project.move_node(f.scene2, f.scene1, 0).unwrap();
    assert_eq!(f.project.get(f.scene2).unwrap().parent, Some(f.scene1));
    let kids: Vec<Uuid> = f.project.children(Some(f.chapter)).iter().map(|d| d.id).collect();
    assert_eq!(kids, vec![f.scene1]);
}

#[test]
fn reordering_siblings_places_the_node_at_the_index() {
    let mut f = fixture();
    let c = f.project.create_child(f.chapter, DocumentKind::Document, "Scene C").unwrap();
    // Move the first scene to the end, then to the middle.
    f.project.move_node(f.scene1, f.chapter, 2).unwrap();
    let order = |p: &Project| -> Vec<Uuid> { p.children(Some(f.chapter)).iter().map(|d| d.id).collect() };
    assert_eq!(order(&f.project), vec![f.scene2, c, f.scene1]);
    f.project.move_node(f.scene1, f.chapter, 1).unwrap();
    assert_eq!(order(&f.project), vec![f.scene2, f.scene1, c]);
    let orders: Vec<i32> = f.project.children(Some(f.chapter)).iter().map(|d| d.order).collect();
    assert_eq!(orders, vec![0, 1, 2]);
}
