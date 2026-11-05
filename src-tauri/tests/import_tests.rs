//! Importing Scrivener projects: the RTF reader and the binder.

use std::fs;
use std::path::{Path, PathBuf};

use scribeforge_lib::import::rtf::{rtf_to_rich, rtf_to_text};
use scribeforge_lib::import::scrivener::{find_scrivx, import, project_name};
use scribeforge_lib::project::document::{Block, Document, DocumentKind, Mark, RichDoc};
use scribeforge_lib::project::model::Project;
use scribeforge_lib::storage::{read_project_from_path, write_project_to_path};

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir()
        .join("scribeforge-tests")
        .join(format!("{}-{}", tag, std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

fn paragraphs(doc: &RichDoc) -> Vec<String> {
    doc.blocks
        .iter()
        .map(|b| match b {
            Block::Paragraph { spans, .. } => spans.iter().map(|s| s.text.as_str()).collect(),
            other => format!("{other:?}"),
        })
        .collect()
}

// ---- RTF ----------------------------------------------------------------

/// What Scrivener 3 for Windows writes, trimmed.
const SCRIVENER_RTF: &str = r#"{\rtf1\ansi\ansicpg1252\uc1\deff0{\fonttbl{\f0\fnil\fcharset0\fprq2 Palatino Linotype;}}
{\colortbl;\red0\green0\blue0;}
{\*\expandedcolortbl;;}
\paperw12240\paperh15840\margl1800\margr1800\margt1440\margb1440\fet2\ftnbj\aenddoc
\pgnrestart\pgnstarts0
\pard\plain \ltrch\loch {\f0\fs24\b0\i0 La noche ca\'edda sobre el pueblo. }{\f0\fs24\b \u8212?Nadie}{\f0\fs24 \u8212? dijo \i \'abnada\'bb\i0 .}
\par\pard\plain\fi720 {\f0\fs24 Segunda l\u237?nea con }{\f0\fs24\ul subrayado}{\f0\fs24  y }{\f0\fs24\strike tachado}{\f0\fs24 .}
\par\pard\plain\qc {\f0\fs24 #}
\par\pard\plain {\f0\fs24 Fin.}{\super\chftn}{\footnote\pard\plain\chftn {\f0\fs20  Una nota al pie.}}
\par\pard\plain {\f0\fs24 }
\par }"#;

#[test]
fn rtf_keeps_text_marks_alignment_and_characters() {
    let doc = rtf_to_rich(SCRIVENER_RTF.as_bytes());
    let paras = paragraphs(&doc);
    assert_eq!(
        paras,
        vec![
            "La noche caída sobre el pueblo. —Nadie— dijo «nada».",
            "Segunda línea con subrayado y tachado.",
            "#",
            "Fin. [Una nota al pie.]",
        ]
    );
    let Block::Paragraph { spans, .. } = &doc.blocks[0] else { panic!("paragraph") };
    let bold: Vec<&str> = spans.iter().filter(|s| s.marks.contains(&Mark::Bold)).map(|s| s.text.as_str()).collect();
    assert_eq!(bold, vec!["—Nadie"]);
    assert!(spans.iter().any(|s| s.text == "«nada»" && s.marks == vec![Mark::Italic]));

    let Block::Paragraph { spans, .. } = &doc.blocks[1] else { panic!("paragraph") };
    assert!(spans.iter().any(|s| s.text == "subrayado" && s.marks == vec![Mark::Underline]));
    assert!(spans.iter().any(|s| s.text == "tachado" && s.marks == vec![Mark::Strikethrough]));

    let Block::Paragraph { attrs, .. } = &doc.blocks[2] else { panic!("paragraph") };
    assert_eq!(attrs.align.as_deref(), Some("center"));
}

#[test]
fn rtf_reads_lists_links_and_unicode_from_a_mac() {
    let rtf = r#"{\rtf1\ansi\ansicpg1252\cocoartf2709
{\fonttbl\f0\fswiss\fcharset0 Helvetica;}
{\*\listtable{\list\listtemplateid1{\listlevel\levelnfc23{\leveltext\'01\uc0\u8226 ;}{\levelnumbers;}}}}
\pard\tx720\li720\fi-360\ls1\pardirnatural
\ls1{\listtext	\uc0\u8226 	}uno\
{\listtext	\uc0\u8226 	}dos\
\pard\pardirnatural
Visita {\field{\*\fldinst{HYPERLINK "https://example.com/"}}{\fldrslt la web}} hoy \uc0\u55357 \u56842 .\
{\field{\*\fldinst{HYPERLINK "scrivcmt://ABC"}}{\fldrslt comentario}} fin}"#;
    let doc = rtf_to_rich(rtf.as_bytes());
    let Block::ListUnordered { items } = &doc.blocks[0] else { panic!("list first: {:?}", doc.blocks) };
    let items: Vec<String> = items.iter().map(|i| i.spans.iter().map(|s| s.text.as_str()).collect()).collect();
    assert_eq!(items, vec!["uno", "dos"]);

    let Block::Paragraph { spans, .. } = &doc.blocks[1] else { panic!("paragraph") };
    let text: String = spans.iter().map(|s| s.text.as_str()).collect();
    assert_eq!(text, "Visita la web hoy 😊.");
    assert!(spans
        .iter()
        .any(|s| s.text == "la web" && s.marks == vec![Mark::Link { href: "https://example.com/".into() }]));

    // A link to a Scrivener comment is not a link: only its text stays.
    let Block::Paragraph { spans, .. } = &doc.blocks[2] else { panic!("paragraph") };
    assert!(spans.iter().all(|s| s.marks.is_empty()));
    assert_eq!(spans.iter().map(|s| s.text.as_str()).collect::<String>(), "comentario fin");
}

#[test]
fn rtf_numbered_lists_and_plain_text() {
    let rtf = r"{\rtf1\ansi {\listtext 1.\tab}\ls2 primero\par {\listtext 2.\tab}\ls2 segundo\par\pard despu\'e9s\par}";
    let doc = rtf_to_rich(rtf.as_bytes());
    assert!(matches!(&doc.blocks[0], Block::ListOrdered { items } if items.len() == 2));
    assert_eq!(paragraphs(&RichDoc { blocks: doc.blocks[1..].to_vec() }), vec!["después"]);

    assert_eq!(rtf_to_text(br"{\rtf1\ansi Nota uno\par Nota dos\par}"), "Nota uno\nNota dos");
    // Broken input never panics.
    let _ = rtf_to_rich(br"{\rtf1 {\b sin cerrar \u");
    let _ = rtf_to_rich(b"");
}

// ---- Scrivener 3 project ---------------------------------------------------

fn scrivener3_project(dir: &Path) -> PathBuf {
    let scriv = dir.join("Mi novela.scriv");
    write(
        &scriv.join("Mi novela.scrivx"),
        r#"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<ScrivenerProject Template="NO" Version="2.0" Identifier="X" Creator="SCRWIN-3.1.5.1">
    <Binder>
        <BinderItem UUID="DRAFT-1" Type="DraftFolder" Created="2023-01-01 10:00:00 +0100" Modified="2023-01-01 10:00:00 +0100">
            <Title>Manuscrito</Title>
            <Children>
                <BinderItem UUID="CH-1" Type="Folder" Created="2023-01-02 09:30:00 +0100" Modified="2023-02-03 18:00:00 +0100">
                    <Title>Capítulo 1</Title>
                    <MetaData><LabelID>1</LabelID><StatusID>2</StatusID><IncludeInCompile>Yes</IncludeInCompile></MetaData>
                    <Children>
                        <BinderItem UUID="SC-1" Type="Text" Created="2023-01-02 09:31:00 +0100" Modified="2023-01-02 09:31:00 +0100">
                            <Title>La llegada</Title>
                            <MetaData><StatusID>0</StatusID></MetaData>
                            <Target Type="Words" Notify="No">2000</Target>
                        </BinderItem>
                        <BinderItem UUID="SC-2" Type="Text" Created="2023-01-02 09:32:00 +0100" Modified="2023-01-02 09:32:00 +0100">
                            <Title>Escena con hijos</Title>
                            <Children>
                                <BinderItem UUID="SC-3" Type="Text" Created="2023-01-02 09:33:00 +0100" Modified="2023-01-02 09:33:00 +0100">
                                    <Title>Subescena</Title>
                                </BinderItem>
                            </Children>
                        </BinderItem>
                    </Children>
                </BinderItem>
                <BinderItem UUID="CH-2" Type="Folder" Created="2023-01-03 09:30:00 +0100" Modified="2023-01-03 09:30:00 +0100">
                    <Title>Capítulo con texto</Title>
                </BinderItem>
            </Children>
        </BinderItem>
        <BinderItem UUID="RES-1" Type="ResearchFolder" Created="2023-01-01 10:00:00 +0100" Modified="2023-01-01 10:00:00 +0100">
            <Title>Investigación</Title>
            <Children>
                <BinderItem UUID="IMG-1" Type="Image" Created="2023-01-04 10:00:00 +0100" Modified="2023-01-04 10:00:00 +0100">
                    <Title>Mapa</Title>
                </BinderItem>
                <BinderItem UUID="PDF-1" Type="PDF" Created="2023-01-04 10:00:00 +0100" Modified="2023-01-04 10:00:00 +0100">
                    <Title>Artículo</Title>
                </BinderItem>
            </Children>
        </BinderItem>
        <BinderItem UUID="CHARS" Type="Folder" Created="2023-01-01 10:00:00 +0100" Modified="2023-01-01 10:00:00 +0100">
            <Title>Personajes</Title>
            <Children>
                <BinderItem UUID="CHAR-1" Type="Text" Created="2023-01-05 10:00:00 +0100" Modified="2023-01-05 10:00:00 +0100">
                    <Title>Ana</Title>
                    <MetaData><LabelID>2</LabelID></MetaData>
                </BinderItem>
            </Children>
        </BinderItem>
        <BinderItem UUID="TRASH-1" Type="TrashFolder" Created="2023-01-01 10:00:00 +0100" Modified="2023-01-01 10:00:00 +0100">
            <Title>Papelera</Title>
            <Children>
                <BinderItem UUID="OLD-1" Type="Text" Created="2023-01-06 10:00:00 +0100" Modified="2023-01-06 10:00:00 +0100">
                    <Title>Borrador viejo</Title>
                </BinderItem>
            </Children>
        </BinderItem>
    </Binder>
    <LabelSettings>
        <Title>Etiqueta</Title>
        <Labels>
            <Label ID="-1">Sin etiqueta</Label>
            <Label ID="1" Color="1.0 0.5 0.0">Capítulo</Label>
            <Label ID="2" Color="0.2 0.4 0.8">Personaje</Label>
        </Labels>
    </LabelSettings>
    <StatusSettings>
        <Title>Estado</Title>
        <StatusItems>
            <Status ID="-1">Sin estado</Status>
            <Status ID="0">Pendiente</Status>
            <Status ID="1">Primer borrador</Status>
            <Status ID="2">Revisado</Status>
        </StatusItems>
    </StatusSettings>
    <ProjectTargets Notify="No">
        <DraftTarget Type="Words" CountIncludedOnly="Yes">90000</DraftTarget>
        <SessionTarget Type="Words">1000</SessionTarget>
        <Deadline>2024-06-30 00:00:00 +0200</Deadline>
    </ProjectTargets>
</ScrivenerProject>"#,
    );
    let data = scriv.join("Files").join("Data");
    write(&data.join("SC-1").join("content.rtf"), r"{\rtf1\ansi Llegaron de noche.\par Nadie los vio.\par}");
    write(&data.join("SC-1").join("notes.rtf"), r"{\rtf1\ansi Revisar el clima.\par}");
    write(&data.join("SC-1").join("synopsis.txt"), "Ana llega al pueblo.\n");
    write(&data.join("SC-3").join("content.rtf"), r"{\rtf1\ansi Texto de la subescena.\par}");
    write(&data.join("CH-2").join("content.rtf"), r"{\rtf1\ansi Prólogo dentro de la carpeta.\par}");
    write(&data.join("CHAR-1").join("content.rtf"), r"{\rtf1\ansi Treinta a\'f1os.\par}");
    write(&data.join("OLD-1").join("content.rtf"), r"{\rtf1\ansi Descartado.\par}");
    // A tiny PNG and a PDF.
    fs::create_dir_all(data.join("IMG-1")).unwrap();
    fs::write(data.join("IMG-1").join("content.png"), [0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A, 0, 0]).unwrap();
    write(&data.join("PDF-1").join("content.pdf"), "%PDF-1.4");
    scriv
}

fn find<'a>(project: &'a Project, title: &str) -> &'a Document {
    project.documents.values().find(|d| d.title == title).unwrap_or_else(|| panic!("no document {title}"))
}

fn titles_under(project: &Project, parent: uuid::Uuid) -> Vec<String> {
    project.children(Some(parent)).iter().map(|d| d.title.clone()).collect()
}

#[test]
fn imports_a_scrivener_3_project() {
    let dir = temp_dir("import-scriv3");
    let scriv = scrivener3_project(&dir);
    let scrivx = find_scrivx(&scriv).unwrap();
    assert_eq!(project_name(&scrivx), "Mi novela");
    // The folder holding the .scriv works too.
    assert_eq!(find_scrivx(&dir).unwrap(), scrivx);

    let (project, summary) = import(&scrivx, "Mi novela".into(), None).unwrap();
    let draft = project.root_id(DocumentKind::DraftRoot).unwrap();
    let research = project.root_id(DocumentKind::ResearchRoot).unwrap();
    let trash = project.root_id(DocumentKind::TrashRoot).unwrap();

    assert_eq!(titles_under(&project, draft), vec!["Capítulo 1", "Capítulo con texto"]);
    let ch1 = find(&project, "Capítulo 1");
    assert_eq!(ch1.kind, DocumentKind::Folder);
    assert_eq!(ch1.labels, vec!["Capítulo"]);
    assert_eq!(ch1.status, "Revisado");
    assert_eq!(ch1.created_at.to_rfc3339(), "2023-01-02T08:30:00+00:00");
    assert_eq!(ch1.modified_at.to_rfc3339(), "2023-02-03T17:00:00+00:00");
    assert_eq!(titles_under(&project, ch1.id), vec!["La llegada", "Escena con hijos"]);

    let scene = find(&project, "La llegada");
    assert_eq!(scene.kind, DocumentKind::Document);
    assert_eq!(paragraphs(&scene.content), vec!["Llegaron de noche.", "Nadie los vio."]);
    assert_eq!(scene.word_count, 6);
    assert_eq!(scene.notes, "Revisar el clima.");
    assert_eq!(scene.synopsis, "Ana llega al pueblo.");
    assert_eq!(scene.status, "Pendiente");
    assert_eq!(scene.word_goal, 2000);
    assert!(scene.labels.is_empty());

    // A text keeps its sub-documents; a folder with text becomes a document.
    let parent = find(&project, "Escena con hijos");
    assert_eq!(titles_under(&project, parent.id), vec!["Subescena"]);
    let prologue = find(&project, "Capítulo con texto");
    assert_eq!(prologue.kind, DocumentKind::Document);
    assert_eq!(paragraphs(&prologue.content), vec!["Prólogo dentro de la carpeta."]);

    // Research, other top-level folders and the trash.
    assert_eq!(titles_under(&project, research), vec!["Mapa", "Artículo", "Personajes"]);
    let map = find(&project, "Mapa");
    assert_eq!(map.kind, DocumentKind::Research);
    assert_eq!(map.attachments.len(), 1);
    assert_eq!(map.attachments[0].mime_type, "image/png");
    assert_eq!(project.assets[&map.attachments[0].id].bytes.len(), 10);
    let pdf = find(&project, "Artículo");
    assert!(pdf.content.plain_text().contains("content.pdf"));
    let ana = find(&project, "Ana");
    assert_eq!(ana.kind, DocumentKind::Research);
    assert_eq!(ana.labels, vec!["Personaje"]);
    assert_eq!(paragraphs(&ana.content), vec!["Treinta años."]);
    assert_eq!(titles_under(&project, trash), vec!["Borrador viejo"]);
    assert!(project.in_trash(find(&project, "Borrador viejo").id));

    // Project settings.
    let config = &project.manifest.config;
    let names = |defs: &[scribeforge_lib::project::manifest::ColorDef]| defs.iter().map(|d| d.name.clone()).collect::<Vec<_>>();
    assert_eq!(names(&config.labels), vec!["Capítulo", "Personaje"]);
    assert_eq!(config.labels[0].color, "#ff8000");
    assert_eq!(names(&config.statuses), vec!["Pendiente", "Primer borrador", "Revisado"]);
    assert_eq!(config.project_word_goal, 90000);
    assert_eq!(config.session_word_goal, 1000);
    assert_eq!(config.deadline.unwrap().to_string(), "2024-06-30");

    assert_eq!(summary.documents, 10);
    assert_eq!(summary.images, 1);
    assert_eq!(summary.not_copied, vec!["Artículo"]);

    // The result saves and opens like any project.
    let path = dir.join("Mi novela.scri");
    write_project_to_path(&project, &path).unwrap();
    let reopened = read_project_from_path(&path).unwrap();
    assert_eq!(reopened.documents.len(), project.documents.len());
    assert_eq!(paragraphs(&find(&reopened, "La llegada").content), vec!["Llegaron de noche.", "Nadie los vio."]);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn imports_a_scrivener_2_project() {
    let dir = temp_dir("import-scriv2");
    let scriv = dir.join("Old.scriv");
    write(
        &scriv.join("project.scrivx"),
        r#"<?xml version="1.0" encoding="UTF-8"?>
<ScrivenerProject Version="1.0">
<Binder>
<BinderItem ID="0" Type="DraftFolder" Created="2015-03-01 12:00:00 +0000" Modified="2015-03-01 12:00:00 +0000">
<Title>Draft</Title>
<Children>
<BinderItem ID="7" Type="Text" Created="2015-03-02 12:00:00 +0000" Modified="2015-03-02 12:00:00 +0000"><Title>One</Title></BinderItem>
</Children>
</BinderItem>
<BinderItem ID="1" Type="ResearchFolder"><Title>Research</Title></BinderItem>
<BinderItem ID="2" Type="TrashFolder"><Title>Trash</Title></BinderItem>
</Binder>
</ScrivenerProject>"#,
    );
    let docs = scriv.join("Files").join("Docs");
    write(&docs.join("7.rtf"), r"{\rtf1\ansi First words.\par}");
    write(&docs.join("7_synopsis.txt"), "Short.");
    write(&docs.join("7_notes.rtf"), r"{\rtf1\ansi A note.\par}");

    let scrivx = find_scrivx(&scriv).unwrap();
    assert_eq!(project_name(&scrivx), "Old");
    let (project, summary) = import(&scrivx, "Old".into(), None).unwrap();
    let one = find(&project, "One");
    assert_eq!(paragraphs(&one.content), vec!["First words."]);
    assert_eq!(one.synopsis, "Short.");
    assert_eq!(one.notes, "A note.");
    assert_eq!(one.status, "");
    // No label or status lists in the file: the defaults stay.
    assert!(!project.manifest.config.labels.is_empty());
    assert_eq!(summary.documents, 1);
    fs::remove_dir_all(&dir).ok();
}

#[test]
fn rejects_folders_without_a_scrivener_project() {
    let dir = temp_dir("import-none");
    assert!(find_scrivx(&dir).is_err());
    write(&dir.join("broken.scriv").join("broken.scrivx"), "<not xml");
    let scrivx = find_scrivx(&dir).unwrap();
    assert!(import(&scrivx, "x".into(), None).is_err());
    fs::remove_dir_all(&dir).ok();
}
