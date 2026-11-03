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
├── snapshots/
│   └── <doc>/<id>.json      (optional)  Snapshots of a document's text.
├── metadata/
│   ├── project.json         (required)  Mirror of manifest.config for tooling.
│   ├── stats.json           (optional)  Words written per day.
│   └── dictionary.json      (optional)  Personal spelling dictionary.
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
    "backup_count": 5,
    "deadline": "2027-03-01",       // optional; YYYY-MM-DD
    "spell_language": "es"          // "es" | "en" | "es,en" | "off"
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
  ],
  "word_goal": 2000,                // optional; 0 or absent = no target
  "comments": [                     // optional; margin comments
    {
      "id": "uuid",                 // matches a `comment` mark in content
      "text": "Too slow here?",
      "resolved": false,
      "created_at": "…",
      "modified_at": "…"
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

## 5b. Writing data

All of these are optional and additive; files written before they existed
open with empty defaults.

- `snapshots/<document-id>/<snapshot-id>.json` — `{ id, document_id, name,
  created_at, title, word_count, content }`, where `content` is a RichDoc.
  Snapshots of a document that no longer exists are skipped on read and
  never written.
- `metadata/stats.json` — `{ "days": { "YYYY-MM-DD": { "added": n,
  "removed": n } } }`, keyed by the writer's local date.
- `metadata/dictionary.json` — `{ "words": ["Eldoria", …] }`.

## 6. RichDoc content model

A minimal, editor-agnostic block/span tree:

- **Blocks**: `paragraph`, `heading` (level 1–6), `block_quote`,
  `list_ordered`, `list_unordered`, `code_block`, `divider`.
- **Spans**: text runs with optional marks.
- **Marks**: `bold`, `italic`, `underline`, `strikethrough`, `code_span`,
  `link { href }`, `font_family`, `font_size`, `color`, `highlight`, and
  `comment { id }` (the anchor of a margin comment; not compiled).

The model maps 1:1 to HTML for the editor UI and to TXT/Markdown for
compilation, and is the only persisted representation of document text.

## 7. Safe-save procedure

1. Serialise the project fully in memory.
2. Write a fresh archive to `<target>.scri.tmp` (a hidden sibling temp file).
3. Re-open the temp archive, verify structure and re-read the manifest.
4. Replace the target:
   - direct rename where the OS allows it;
   - otherwise `rename(target, *.old) → rename(tmp, target) → remove(.old)`.
5. Copy the new file into this computer's backup folder for the project,
   `<local data dir>/com.scribeforge.app/backups/<project_id>/<name>-<timestamp>.scri`
   (`%LOCALAPPDATA%` on Windows), and prune to the newest `backup_count`
   copies. Backups stay outside the project's folder so a synced folder does
   not carry several full copies of every project. (Earlier builds wrote
   them to `<name>.backups/` next to the file; those folders are left as
   they are.)
6. On any failure before step 4 completes, the original file is untouched.

Before step 2 the app checks that the file on disk is still the version it
last read or wrote (size and modification time, then SHA-256). If another
computer saved it meanwhile, the save is refused and the two versions are
combined first (see §9a).

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

## 9a. Several computers (synced folders)

A project can live in a folder that a cloud client (OneDrive, Google Drive
for desktop, Dropbox, iCloud) keeps in sync between computers. ScribeForge
never talks to the cloud service; next to the project it keeps one small
sidecar file, which is **not** part of the container:

```
.MyProject.scri.sync
```

```jsonc
{
  "device_id": "uuid-v4",            // random, generated once per installation
  "device_name": "Laptop",           // chosen by the user; may be empty
  "state": "open",                    // "open" | "closed"
  "heartbeat": "2026-11-02T10:31:00Z",// refreshed every 60 s while open
  "saved_hash": "sha256-hex"          // last version this computer saved
}
```

- **Open elsewhere:** `state: "open"` from another device with a heartbeat
  younger than 180 s → the user may open read-only or anyway.
- **Still syncing:** `state: "closed"` (or a stale `open`) whose
  `saved_hash` differs from the file on disk → the newest version has not
  arrived yet; the user may wait or open what is there.
- **Changed while open:** polled every 10 s. With nothing unsaved the app
  reloads; otherwise the two versions are combined document by document,
  using the version last read or written as the common origin: a document
  changed on one side only is taken from that side, one changed on both is
  the user's choice (this computer's, the other's, or keep this one and store
  the other as a snapshot).
- **Conflict copies:** `.scri` files next to the project whose name starts
  with the project's file name and whose `project_id` matches are offered for
  combining (without a common origin nothing is deleted). When the app exits
  with unsaved changes and the file was changed elsewhere, the changes are
  written to such a copy, `<name> (<device> <date>).scri`.

The sidecar holds no account data and no paths. Missing or unreadable
sidecars are ignored.

## 10. Changelog

| Version | App        | Change                                    |
|---------|------------|-------------------------------------------|
| 1       | 0.1.0      | Initial format.                            |
| 1       | 0.1.0      | Additive: snapshots, stats, dictionary, comments, word targets, deadline, spell language. |
