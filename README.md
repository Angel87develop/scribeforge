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

Check that every interface text has a Spanish translation:

```bash
npm run i18n:check
```

The tests cover the `.scri` format and the binder: saving and reopening, creating projects from templates, detecting damaged files, blocking unsafe paths inside archives, moving projects between machines, and the full trash, restore and delete cycle. They also check that image attachments survive saving, resizing, duplicating and moving, and that compiling produces valid TXT, Markdown, HTML, DOCX, PDF and EPUB files with the right documents, presets and selection. The writing tools are covered too: daily statistics and streaks, the words-a-day target, snapshots (word-level comparison, restore, removal with the document), spelling in Spanish and English with the personal dictionary, find and replace with regular expressions across formatted text, and that comments, targets, snapshots, statistics and the dictionary all survive saving and reopening.

## What you can do

### Start a project

When the app opens, you choose a template. There are 30 of them, grouped into Getting Started, Blank, Fiction, Non-Fiction, Scriptwriting and Miscellaneous. Fiction, non-fiction and script templates come with a starting set of folders and documents. A blank project has only the three fixed sections: Manuscript, Research and Trash.

From the same window you can reopen a recent project or open any `.scri` file. If a file is damaged or was made by a newer version of the app, you get a clear message and the file is left untouched.

### Organize with the binder

The binder on the left holds the whole project as a tree.

- Create documents and folders, rename them by double-clicking, duplicate them, and drag them to reorder or move them. Dropping on the top or bottom edge of a row places the item before or after it; dropping on the middle puts it inside.
- Documents can have subdocuments. Drag a document onto the middle of another document, or right-click a document and choose New Subdocument. A document with children gets an arrow you can use to expand or collapse it.
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
- Smart typography (Preferences > Editor): a typed `"` becomes Spanish quotes « » (with “ ” inside them) or curly quotes “ ”, a typed `'` becomes ‘ or ’, three dots become an ellipsis (…), and a hyphen and a space at the start of a paragraph become a dialogue dash (—). Each can be turned off.
- Text copied from a PDF or an e-mail, where every line ends in a line break, is joined back into paragraphs when pasted (lines starting with a dialogue dash or a list marker always start a new paragraph). For text pasted before, Edit > Join Broken Lines does the same on the selection or the whole document; Ctrl+Z undoes it.
- Your work is saved to the project shortly after you stop typing, and the whole project is autosaved every 30 seconds when it has changes. The interval can be changed in Preferences.

### Writing tools

**Targets.** Tools > Project Targets sets a word goal for the manuscript, an optional deadline and a goal for each writing session. With a goal and a deadline, ScribeForge works out how many words a day you still need (counting today). Each document can have its own target in the Inspector's Metadata tab; it shows as a progress bar in the editor's title bar. The status bar shows the session and the manuscript progress; click either to open the targets. The session counts the words written since the project was opened, and New Session starts it again.

**Statistics.** Tools > Writing Statistics shows the words written today, in the last 7 and 30 days, the current and longest streak of writing days, the best day and the daily average, with a heatmap of the last twelve months and a chart of the last 30 days. Hover a day to see its numbers. Only words you type count; find and replace or restoring a snapshot does not.

**Snapshots.** Documents > Take Snapshot (Ctrl+5) keeps a copy of the document's text. The Inspector's Snapshots tab lists them: name or rename them, compare one with the current text or with another snapshot (removed words struck through in red, added words underlined in green), restore one, or delete it. Restoring keeps the replaced text as a new snapshot, so it can be undone.

**Spelling.** Misspelled words get a wavy red underline. Right-click one for suggestions, to add it to the dictionary or to ignore it. Tools > Spelling chooses the language (Spanish, English, both, or off) and manages the personal dictionary. Both are saved in the project file. The Spanish and English Hunspell dictionaries are built into the app, so nothing is downloaded.

**Find and replace.** Edit > Find and Replace (Ctrl+H) searches the whole project or the current document, optionally with regular expressions (`$1` in the replacement inserts the first group), matching case or whole words, and also in titles, synopses and notes. Every match is listed with its context and what it would become; untick the ones to leave alone. Before changing a document's text, ScribeForge takes a snapshot of it, so any replacement can be undone. The Trash is never searched.

**Comments.** Select some text and press Ctrl+Shift+M (or the speech-bubble button on the formatting bar) to attach a comment. Comments appear in a margin to the right of the text, next to the passage they belong to. Click one to select its text; mark it resolved, reopen it or delete it. If the commented text is deleted, the comment is listed at the bottom of the margin so it can be removed. Comments are never compiled.

**Typewriter mode.** View > Typewriter Mode (Ctrl+Shift+T), or the Typewriter button under the editor, keeps the line you are writing in the middle of the screen.

### Split the editor

Use the buttons under the editor to show two documents side by side (Vertical) or one above the other (Horizontal).

- Click inside a pane to make it active. The formatting bar at the top, the binder and the Inspector then all work with that pane.
- Choosing a document in the binder opens it in the active pane.
- Each pane has an X in its title bar to close it. The other pane stays open.
- If the same document is open in both panes (on its own or inside Scrivenings), it is read-only in the second pane so your edits never overwrite each other.

### Folder views: Scrivenings, Corkboard and Outliner

A folder, or a document with subdocuments, has a view switcher in its title bar. Each pane remembers its choice.

- **Scrivenings** shows every document inside, one after another, so you can read and edit them as one continuous text. A dashed separator with the document's title divides them; click the title to open that document on its own. Each document still saves separately, and the formatting bar follows the one you are typing in.
- **Corkboard** shows index cards (see below).
- **Outliner** shows everything inside as a table: title, synopsis, status, label, keywords, words, created and modified. Choose which columns to show from the Columns menu. Click a column header to sort; sorting only changes the display, never the binder order. Double-click a title, synopsis, label or keywords to edit it, and change the status from its list. Drag rows to reorder them or drop one inside another, as in the binder. Word counts for folders and parent documents include everything inside them.
- Documents with subdocuments also have **Text**, which shows the document's own text.

### Corkboard

Click a folder and its contents appear as index cards, one per document.

- Each card shows a title and a short summary.
- The summary on a card is the document's synopsis, which is separate from the document text. Until you write one, the card shows the start of the document in grey. Editing the card never changes the document text.
- The card title is also separate. Changing it does not rename the document. Clear the field to go back to the document's own title.
- Double-click the top of a card to open it. The last card, New card, adds a document to the folder.

### Inspector

The panel on the right shows details for the selected document:

- **Synopsis**: a short summary, also shown on the corkboard.
- **Notes**: free-form notes, with image attachments. Drop images in or use the image button, and right-click an image for more options. The arrow next to *Notes* folds the notes text away so the images get the whole tab. With *Fit* on (the default) images fill the panel width, never taller than the visible panel, and follow the Inspector as it is resized; with *Fit* off each image keeps its own size, which you set by dragging its corner. Images are stored inside the `.scri` file, up to 10 MB each.
- **Metadata**: status, label, keywords, word and character counts, and dates.

### Composition mode

View > Composition Mode (F11) or the full-screen button on the toolbar opens the selected document full screen, on a page over a plain background, with nothing else on screen. A folder or a document with subdocuments opens as one continuous text.

Move the pointer to the bottom of the screen to show the controls: background color, page and text colors, page width, text size and page opacity. Your changes are remembered. Press Escape or F11 to leave.

### Compile

File > Compile (Ctrl+Shift+P) turns the manuscript into a single file: PDF, Word (DOCX), EPUB, HTML, Markdown or plain text.

- **Contents**: tick the documents and folders to include. Ticking a folder ticks everything inside it. The whole Manuscript is selected to start with; Research items can be added too. The Trash is never compiled.
- **Presets** fill in the settings for a common format, and you can change any of them afterwards:
  - *Standard Manuscript*: Courier 12 pt, double spaced, 1-inch margins, indented paragraphs, chapters on new pages, `#` between scenes, a title page with an approximate word count, and an "Author / TITLE / page" header.
  - *Ebook*: serif type, comfortable spacing, `* * *` between scenes and one chapter per file in EPUB.
  - *Screenplay*: Courier 12 pt, single spaced, 1.5-inch left margin, scene titles in capitals and no paragraph indents.
  - *Writing Format*: the active writing format profile from Preferences > Format (see below), as it is now.
- **Settings**: title and author, font, size, line spacing, alignment (left or justified), first-line indent, space before and after paragraphs, scene separator, chapter title size, folder and document titles, capitals, keeping bold and italics, title page, paper size (Letter, A4 or A5), margins, a running header, chapters on new pages and page numbers.
- Folders become chapter headings. Documents in the same folder are separated by the scene separator when their titles are hidden.
- Plain text, Markdown and HTML can be previewed in the dialog before saving.

The PDF writer uses the built-in PDF fonts (Courier, Times and Helvetica), choosing whichever is closest to the font you picked, so no font files are embedded. Text in Western European languages (including accents, ñ, ¿ and ¡, curly quotes and dashes) comes out correctly; characters outside that set appear as "?". Use DOCX if you need other scripts.

### Preferences

Tools > Preferences (Ctrl+,) sets:

- **General**: light or dark theme, or follow Windows; how many recent projects to remember.
- **Editor**: typewriter mode and smart typography.
- **Format**: the writing format profile. Pick one of eight profiles (Classic Novel, Modern Novel, Japanese Light Novel, Web Novel, Professional Manuscript, Epic Fantasy, Pocket Novel, Cinematic Novel), see a preview and apply it. Each profile can be adjusted and restored to its original values; changes are kept per profile and never alter the others.
  - *Editor* values (font, size, alignment, line spacing, first-line indent, space before and after paragraphs, no indent after a heading or scene break) change how text looks while writing, previewed live while the dialog is open. They are defaults: paragraphs you formatted yourself keep their own alignment, spacing and indents, and the document text is never rewritten. If the profile's font is not installed, the editor uses a similar one and the tab says which.
  - *Export* values (page size, margins including the binding side, chapter start, scene separator, chapter title size, page numbers and header) do not change the editor. They are used by the *Writing Format* compile preset. Page, margins, numbering and header apply to PDF and DOCX only.
  - The text column width is also set here; it is shared by all profiles.
- **Saving**: autosave on or off, how often it runs, and how many backups to keep in `<name>.backups/`.
- **Composition**: the default look of composition mode.
- **Languages**: the interface language, English or Español. It changes as soon as you press Save, without closing the project. Menus, dialogs, messages, templates, native file dialogs and dates switch language; your documents, label and status names, and the text of projects created earlier stay as they are. New sheets and new documents get their default names in the chosen language.

### Other features

- Search the whole project (titles, text, synopses and notes) and click a result to open it.
- Save As makes a copy of the project somewhere else.
- Resize the binder and Inspector by dragging their edges; the editor gives up or takes the room, and always keeps at least 320 pixels. Double-click an edge to restore that panel's default width. The layout is remembered.
- Zoom the editor in and out.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+S | Save |
| Ctrl+N | New document |
| Ctrl+O | Open project |
| Ctrl+F | Find |
| Ctrl+H | Find and replace |
| Ctrl+Shift+F | Search the project |
| Ctrl+5 | Take a snapshot |
| Ctrl+Shift+M | Add a comment |
| Ctrl+Shift+T | Typewriter mode |
| Ctrl+B / Ctrl+I / Ctrl+U | Bold / italic / underline |
| Ctrl+Shift+B | Show or hide the binder |
| Ctrl+Shift+I | Show or hide the Inspector |
| Ctrl+Shift+D | Duplicate |
| Ctrl+= / Ctrl+- | Zoom in / zoom out |
| Ctrl+Shift+P | Compile |
| F11 | Composition mode (Escape also leaves it) |
| Ctrl+, | Preferences |

## The .scri format

A `.scri` file is a ZIP archive with a version number, not a renamed text file. Inside it looks like this:

```
MyProject.scri
├── manifest.json        project id, name, format version, dates, template
├── documents/
│   ├── index.json       document order
│   └── <uuid>.json      one file per document: title, text, synopsis, notes, comments...
├── snapshots/
│   └── <doc>/<id>.json  snapshots of each document
└── metadata/
    ├── project.json     project preferences
    ├── stats.json       words written per day
    └── dictionary.json  personal spelling dictionary
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
│   ├── compile/             compiling to TXT, Markdown, HTML, DOCX, PDF and EPUB
│   ├── writing/             statistics, snapshots and diffs, spelling, find and replace
│   ├── format_profiles.rs   writing format profiles and their compile settings
│   └── settings.rs          global preferences and recent projects
└── src/                     React interface
    ├── App.tsx              switches between templates, workspace and welcome screen
    ├── dialogs/             template picker, new project, recent projects
    ├── components/          binder, editor, split view, corkboard, inspector, menus
    ├── services/api.ts      typed calls into the Rust core
    ├── i18n/                interface translation: t() and the Spanish table (es.ts)
    └── styles/              stylesheets
```

The main ideas behind it:

- All the project logic lives in Rust. The interface only talks to it through the typed functions in `services/api.ts`.
- Text is stored as a simple JSON model of blocks, spans and formatting marks. It does not depend on how a particular editor library works inside, and it can later be exported to plain text, Markdown, HTML or Word.
- Global settings are kept apart from projects, in `%APPDATA%/com.scribeforge.app/settings.json`.
- Interface text is written in English and wrapped in `t("…")`; the English text is the key into `src/i18n/es.ts`. When you add or change a text, add its Spanish line to `es.ts` and run `npm run i18n:check`, which also covers the template, profile and preset texts that come from Rust.

## Not done yet

- Attachments other than images, such as PDFs

## License

This is a private project. All code and artwork were made for it.
