# ScribeForge

ScribeForge is a desktop writing app for long projects: novels, scripts, research, anything you want to break into pieces and put back together. It takes its workflow from Scrivener, but has its own look and its own project format, `.scri`.

It is built with Rust (Tauri 2) and React with TypeScript. It runs on Windows today, and the code is written so it can be adapted to macOS and Linux.

Everything stays on your computer. There are no accounts and no cloud services.

## Getting started

You will need:

- Rust 1.77 or newer (install it with `rustup`)
- Node.js 18 or newer, with npm
- Windows 10 or 11 with WebView2 (already installed on current systems)

Install the dependencies:

```bash
npm install
```

Generate the app icons (only needed the first time):

```bash
npm run icon
```

Start the app in development mode:

```bash
npm run tauri dev
```

To build an installer, run the command below. The result goes to `src-tauri/target/release/bundle/`.

```bash
npm run tauri build
```

## Running the tests

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

The tests cover the `.scri` format and the binder: saving and reopening, creating projects from templates, detecting damaged files, blocking unsafe paths inside archives, moving projects between machines, and the full trash, restore and delete cycle. They also check that image attachments survive saving, resizing, duplicating and moving.

## What you can do

### Start a project

When the app opens, you choose a template. There are 30 of them, grouped into Getting Started, Blank, Fiction, Non-Fiction, Scriptwriting and Miscellaneous. Fiction, non-fiction and script templates come with a starting set of folders and documents. A blank project has only the three fixed sections: Manuscript, Research and Trash.

From the same window you can reopen a recent project or open any `.scri` file. If a file is damaged or was made by a newer version of the app, you get a clear message and the file is left untouched.

### Organize with the binder

The binder on the left holds the whole project as a tree.

- Create documents and folders, rename them by double-clicking, duplicate them, and drag them to reorder or move them.
- Documents can have subdocuments. Right-click a document and choose New Subdocument. A document with children gets an arrow you can use to expand or collapse it.
- Give any item its own icon. Right-click and choose Change Icon to pick from books, flags, notepads and way-station signs in several colors, character and location icons, to-do boxes, and about thirty more. Reset Icon to Default brings back the normal icon.
- Deleting moves items to the Trash, where you can restore them or delete them for good. The Manuscript, Research and Trash sections themselves cannot be deleted or moved.

### Write

The editor is built on Tiptap. It supports:

- Bold, italic, underline and strikethrough
- Font family, font size, text color and highlight color
- Alignment, plus line spacing, paragraph spacing and indents (the ¶ button on the formatting bar)
- Paragraph styles such as Title, Subtitle, Heading 1 to 3, Block Quote, Verse, Caption and Attribution
- Bulleted and numbered lists, and code blocks

Some details:

- Markdown is not converted. Typing `# `, `**`, `- ` or `> ` leaves the text exactly as you typed it, and so does pasting.
- Two hyphens in a row (`--`) turn into an em dash (—). This does not happen inside code.
- Your work is saved to the project shortly after you stop typing, and the whole project is autosaved every 30 seconds when it has changes.

### Split the editor

Use the buttons under the editor to show two documents side by side (Vertical) or one above the other (Horizontal).

- Click inside a pane to make it active. The formatting bar at the top, the binder and the Inspector then all work with that pane.
- Choosing a document in the binder opens it in the active pane.
- Each pane has an X in its title bar to close it. The other pane stays open.
- If the same document is open in both panes, the second one is read-only so your edits never overwrite each other.

### Corkboard

Click a folder and its contents appear as index cards, one per document.

- Each card shows a title and a short summary.
- The summary on a card is the document's synopsis, which is separate from the document text. Until you write one, the card shows the start of the document in grey. Editing the card never changes the document text.
- The card title is also separate. Changing it does not rename the document. Clear the field to go back to the document's own title.
- Double-click the top of a card to open it. The last card, New card, adds a document to the folder.

### Inspector

The panel on the right shows details for the selected document:

- **Synopsis**: a short summary, also shown on the corkboard.
- **Notes**: free-form notes, with image attachments. Drop images in or use the image button, resize them by dragging a corner, and right-click for more options. Images are stored inside the `.scri` file, up to 10 MB each.
- **Metadata**: status, label, keywords, word and character counts, and dates.

### Other features

- Search the whole project (titles, text, synopses and notes) and click a result to open it.
- Save As makes a copy of the project somewhere else.
- Resize the binder and Inspector by dragging their edges. The layout is remembered.
- Zoom the editor in and out.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+N | New document |
| Ctrl+O | Open project |
| Ctrl+F | Find |
| Ctrl+Shift+F | Search the project |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline |
| Ctrl+Shift+B | Show or hide the binder |
| Ctrl+Shift+I | Show or hide the Inspector |
| Ctrl+Shift+D | Duplicate |
| Ctrl+= / Ctrl+- | Zoom in / zoom out |

## The .scri format

A `.scri` file is a ZIP archive with a version number, not a renamed text file. Inside it looks like this:

```
MyProject.scri
├── manifest.json        project id, name, format version, dates, template
├── documents/
│   ├── index.json       document order
│   └── <uuid>.json      one file per document: title, text, synopsis, notes...
└── metadata/
    └── project.json     project preferences
```

A few rules the code enforces, each covered by tests:

- Every project and document has a permanent unique id.
- Saving writes to a temporary file first, reads it back to check it, and only then replaces the original. The last few versions are kept in a `<name>.backups/` folder.
- Archives with dangerous paths (such as `..` or absolute paths) are refused.
- Files from a newer format version are refused without being changed. Files from older versions are upgraded in memory when opened, and the original is not rewritten until you save.
- No absolute paths are stored, so you can copy a project to another computer and open it there.

There is more detail in [docs/scri-format.md](docs/scri-format.md).

## How the code is organized

```
ScribeForge/
├── src-tauri/src/           Rust core
│   ├── commands.rs          commands the interface can call
│   ├── state.rs             app settings and the open project
│   ├── errors.rs            error types sent to the interface
│   ├── project/             documents, the rich-text model, tree operations
│   ├── storage/             reading, writing, checking and backing up .scri files
│   ├── templates/           the 30 project templates
│   └── settings.rs          global preferences and recent projects
└── src/                     React interface
    ├── App.tsx              switches between templates, workspace and welcome screen
    ├── dialogs/             template picker, new project, recent projects
    ├── components/          binder, editor, split view, corkboard, inspector, menus
    ├── services/api.ts      typed calls into the Rust core
    └── styles/              stylesheets
```

The main ideas behind it:

- All the project logic lives in Rust. The interface only talks to it through the typed functions in `services/api.ts`.
- Text is stored as a simple JSON model of blocks, spans and formatting marks. It does not depend on how a particular editor library works inside, and it can later be exported to plain text, Markdown, HTML or Word.
- Global settings are kept apart from projects, in `%APPDATA%/com.scribeforge.app/settings.json`.

## Not done yet

- Scrivenings (several documents in one view), the Outliner and Composition Mode
- A full preferences window
- Compiling and exporting to TXT, Markdown, HTML and DOCX
- Attachments other than images, such as PDFs
- Dragging a document onto another document to make it a subdocument (for now, use right-click and New Subdocument)

## License

This is a private project. All code and artwork were made for it.
