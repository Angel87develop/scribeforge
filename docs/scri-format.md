# The `.scri` Container Format — ScribeForge Project

**Format version:** 1
**Stable since:** ScribeForge 0.1.0
**File signature:** ZIP archive (local file header `PK\x03\x04`), extension `.scri`

## 1. Overview

A `.scri` file is a versioned ZIP container holding a complete ScribeForge
project: manifest, documents, and project-scoped configuration. It is designed
to be:

- **Atomic** — the active file is never modified in place.
- **Portable** — no absolute host paths are stored anywhere.
- **Validated** — structural invariants are checked on every open.
- **Versioned** — old files migrate forward; files from the future are refused
  untouched.

## 2. Layout

```
MyProject.scri
├── manifest.json            (required)  Authoritative project metadata.
├── documents/
│   ├── index.json           (required)  Ordered list of document ids.
│   └── <uuid>.json          (required)  One file per document.
├── assets/
│   └── <uuid>.<ext>         (optional)  Binary image attachments (PNG/JPEG/GIF/WebP/BMP/SVG).
├── metadata/
│   └── project.json         (required)  Mirror of manifest.config for tooling.
└── [future dirs]            research/, backups/ — reserved.
```

Every entry uses `/` separators and UTF-8 names. Entry names that are empty,
absolute (`/…`), relative-up (`…/../…`), or contain a Windows drive letter
(`C:…`) are **rejected at open time** before any content is read.

## 3. manifest.json

```jsonc
{
  "project_id": "uuid-v4",          // immutable, generated at creation
  "name": "My Novel",
  "author": "Jane Doe",             // optional
  "format_version": 1,              // container format this file targets
  "app_version": "0.1.0",           // ScribeForge version that wrote it
  "created_at": "2026-10-17T12:00:00Z",
  "modified_at": "2026-10-17T12:05:00Z",
  "template_id": "fiction/novel",   // template origin
  "template_category": "fiction",
  "config": {                        // ProjectConfig
    "autosave": true,
    "autosave_interval_secs": 30,
    "session_word_goal": 0,
    "project_word_goal": 0,
    "backup_count": 5
  }
}
```

Rules:

- `format_version` 0 is invalid.
- A reader must refuse files whose `format_version` is **greater** than the
  version it supports, without modifying the file.
- A reader may open lower versions by migrating in memory; the on-disk file is
  only rewritten on the next explicit save.

## 4. documents/index.json

```json
{ "ids": ["uuid-1", "uuid-2", "…"] }
```

Ordering of ids is a fallback; the authoritative order of a document among its
siblings is the `order` field on the document itself. If `index.json` is
missing, readers may fall back to scanning `documents/*.json` (defensive mode).

## 5. documents/<uuid>.json

One JSON object per document:

```jsonc
{
  "id": "uuid",
  "title": "Chapter 1",
  "kind": "document",               // folder | document | draft_root
                                    // | research_root | trash_root | research
  "parent": "uuid-or-null",         // null for root-level nodes
  "original_parent": "uuid-or-null",// set while the node is in Trash
  "order": 0,                       // sibling index (0-based, contiguous)
  "content": { "blocks": [ … ] },   // RichDoc, see below
  "synopsis": "",
  "notes": "",
  "labels": [],
  "status": "First Draft",
  "created_at": "…",
  "modified_at": "…",
  "word_count": 0,                  // cached; recomputed on save
  "attachments": [                  // image attachments on the Notes tab
    {
      "id": "uuid",                 // matches assets/<uuid>.<ext>
      "filename": "cover.png",
      "mime_type": "image/png",
      "display_width": 240,         // user-adjusted display size (CSS px)
      "display_height": 180,
      "created_at": "…"
    }
  ]
}
```

Structural invariants enforced by the reader:

- Document ids are unique.
- Every `parent` refers to an existing folder-kind document or is null.
- The three root folders (`draft_root`, `research_root`, `trash_root`) must
  exist; a project missing them is invalid.

## 5a. assets/<uuid>.<ext>

Binary image data referenced by `documents/<uuid>.json` attachments. The
`<uuid>` in the filename is the attachment id (distinct from the document id);
the extension encodes the format (`png`, `jpg`, `gif`, `webp`, `bmp`, `svg`).

Properties:

- Stored uncompressed (`Stored` ZIP method) since these formats are already
  compressed — avoids wasting CPU on every save.
- Import validates magic bytes against the declared MIME type, so a renamed
  executable claiming to be a PNG is rejected.
- Hard limit: 10 MB per image.
- Assets are duplicated with fresh ids when a document is duplicated, and
  removed when a document is permanently purged (Trash keeps them restorable).
- Portability: like everything else in the container, assets travel with the
  file; no absolute paths are stored.

## 6. RichDoc content model

A minimal, editor-agnostic block/span tree:

- **Blocks**: `paragraph`, `heading` (level 1–6), `block_quote`,
  `list_ordered`, `list_unordered`, `code_block`, `divider`.
- **Spans**: text runs with optional marks.
- **Marks**: `bold`, `italic`, `underline`, `strikethrough`, `link { href }`.

The model maps 1:1 to HTML for the editor UI and to TXT/Markdown for
compilation, and is the only persisted representation of document text.

## 7. Safe-save procedure

1. Serialise the project fully in memory.
2. Write a fresh archive to `<target>.scri.tmp` (a hidden sibling temp file).
3. Re-open the temp archive, verify structure and re-read the manifest.
4. Replace the target:
   - direct rename where the OS allows it;
   - otherwise `rename(target, *.old) → rename(tmp, target) → remove(.old)`.
5. Copy the new file into `<name>.backups/<name>-<timestamp>.scri` and prune
   to the newest `backup_count` copies.
6. On any failure before step 4 completes, the original file is untouched.

## 8. Open procedure

1. Open as ZIP; any ZIP error → `InvalidProject`, file untouched.
2. Validate every entry name against the traversal rules.
3. Require `manifest.json`, `documents/`, `documents/index.json`.
4. Parse manifest; reject `format_version` 0 or > supported.
5. Load documents (index-first, directory-scan fallback).
6. Check structural invariants (unique ids, parents, root folders).
7. Only then hand the project to the application state.

## 9. Portability

- No absolute paths are written into any entry.
- Assets imported in future phases are stored inside the container (or, when
  the user explicitly chooses external references, recorded as relative paths).
- Test `portability_move_file_to_new_location` copies a `.scri` to a new path
  and reopens it, asserting identical ids and name.

## 10. Changelog

| Version | App        | Change                                    |
|---------|------------|-------------------------------------------|
| 1       | 0.1.0      | Initial format.                            |
