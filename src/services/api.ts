/// Tauri IPC bindings for ScribeForge.
///
/// These mirror the `#[tauri::command]` functions in `src-tauri/src/commands.rs`.
/// Every command returns a Promise that rejects with the serialised `AppError`
/// string on failure.

import { invoke } from "@tauri-apps/api/core";

export interface CategoryDto {
    id: string;
    label: string;
    description: string;
}

export interface TemplatePreview {
    id: string;
    name: string;
    category: string;
    description: string;
    preview: string;
    has_starter_content: boolean;
}

export interface RecentProjectDto {
    path: string;
    name: string;
    last_opened: string;
    available: boolean;
}

export interface ManifestJson {
    project_id: string;
    name: string;
    author: string | null;
    format_version: number;
    app_version: string;
    created_at: string;
    modified_at: string;
    template_id: string;
    template_category: string;
}

export interface OpenProjectResult {
    path: string;
    project_id: string;
    manifest: ManifestJson;
}

export interface DocumentMetaDto {
    id: string;
    title: string;
    kind:
        | "folder"
        | "document"
        | "draft_root"
        | "research_root"
        | "trash_root"
        | "research";
    parent: string | null;
    order: number;
    synopsis: string;
    /** Corkboard card title; empty means "use the document title". */
    card_title: string;
    /** Custom binder icon id (see DocIcons); empty means the default icon. */
    icon: string;
    status: string;
    labels: string[];
    word_count: number;
    /** Word-count target; 0 means none. */
    word_goal: number;
    /** "character", "place"… when the document has a sheet. */
    sheet_kind: string | null;
    /** Position on a freeform corkboard. */
    card_pos: CardPos | null;
    created_at: string;
    modified_at: string;
    in_trash: boolean;
}

export interface CurrentProjectDto {
    path: string;
    project_id: string;
    name: string;
    author: string | null;
    binder: DocumentMetaDto[];
    word_count: number;
    dirty: boolean;
}

export interface ParaAttrs {
    style?: string;
    align?: "left" | "center" | "right" | "justify";
    line_height?: number;
    space_before?: number;
    space_after?: number;
    indent_left?: number;
    indent_right?: number;
    indent_first?: number;
}

export type Mark =
    | { type: "bold" }
    | { type: "italic" }
    | { type: "underline" }
    | { type: "strikethrough" }
    | { type: "code_span" }
    | { type: "link"; href: string }
    | { type: "font_family"; family: string }
    | { type: "font_size"; pt: number }
    | { type: "color"; hex: string }
    | { type: "highlight"; hex: string }
    | { type: "comment"; id: string };

export interface RichSpan {
    text: string;
    marks?: Mark[];
}
export interface RichBlock {
    type: string;
    attrs?: ParaAttrs;
    spans?: RichSpan[];
    level?: number;
    items?: { spans?: RichSpan[] }[];
    text?: string;
}
export interface RichDoc {
    blocks: RichBlock[];
}

/** A margin comment; its anchor is a `comment` mark in the text. */
export interface CommentDto {
    id: string;
    text: string;
    resolved: boolean;
    created_at: string;
    modified_at: string;
}

export interface DocumentDto {
    id: string;
    title: string;
    kind: DocumentMetaDto["kind"];
    content: RichDoc;
    synopsis: string;
    notes: string;
    labels: string[];
    status: string;
    word_count: number;
    word_goal: number;
    comments: CommentDto[];
    sheet: Sheet | null;
    created_at: string;
    modified_at: string;
}

export interface CardPos {
    x: number;
    y: number;
}

export interface SheetField {
    label: string;
    value: string;
}

export interface SheetRelation {
    target: string;
    label: string;
}

/** Structured fields of a character or place sheet. */
export interface Sheet {
    kind: string;
    fields: SheetField[];
    relations: SheetRelation[];
}

export interface ColorDef {
    name: string;
    color: string;
}

export interface OrganizationDto {
    labels: ColorDef[];
    statuses: ColorDef[];
}

export interface DefinitionRename {
    kind: "label" | "status";
    from: string;
    to: string;
}

export interface CollectionQuery {
    text: string;
    status: string;
    label: string;
    keyword: string;
    /** "character", "place", "any" or "". */
    sheet: string;
    scope: "manuscript" | "research" | "all";
    documents_only: boolean;
}

export interface Collection {
    id: string;
    name: string;
    color: string;
    kind: "manual" | "search";
    items: string[];
    query: CollectionQuery;
}

export interface LinksDto {
    outgoing: { title: string; target: string | null }[];
    backlinks: { id: string; title: string; via: "link" | "relation"; context: string }[];
}

export interface TimelineEvent {
    id: string;
    title: string;
    date: string;
    time: string;
    description: string;
    track: string;
    color: string;
    document: string | null;
    characters: string[];
}

export interface SearchHitDto {
    document_id: string;
    title: string;
    kind: string;
    in_trash: boolean;
    excerpt: string;
    field: string;
}

export interface UpdateDocumentArgs {
    id: string;
    title?: string;
    content?: RichDoc;
    synopsis?: string;
    card_title?: string;
    icon?: string;
    notes?: string;
    labels?: string[];
    status?: string;
    word_goal?: number;
    comments?: CommentDto[];
    sheet?: Sheet;
    remove_sheet?: boolean;
    card_pos?: CardPos;
    clear_card_pos?: boolean;
}

export interface WritingGoalsDto {
    project_goal: number;
    session_goal: number;
    /** YYYY-MM-DD or null. */
    deadline: string | null;
    manuscript_words: number;
    session_added: number;
    session_removed: number;
    session_started_at: string;
    today_added: number;
    /** Days left until the deadline, today included. */
    days_left: number | null;
    /** Words a day needed to meet the project goal by the deadline. */
    words_per_day: number | null;
}

export interface WritingGoalsArgs {
    project_goal: number;
    session_goal: number;
    deadline: string | null;
}

export interface DayRow {
    date: string;
    added: number;
    removed: number;
}

export interface WritingStatsDto {
    today: number;
    last_7_days: number;
    last_30_days: number;
    total_added: number;
    total_removed: number;
    days_written: number;
    average_per_writing_day: number;
    current_streak: number;
    longest_streak: number;
    best_day: { date: string; words: number } | null;
    history: DayRow[];
    today_date: string;
}

export interface SnapshotMeta {
    id: string;
    document_id: string;
    name: string;
    title: string;
    created_at: string;
    word_count: number;
}

export interface SnapshotDto extends SnapshotMeta {
    content: RichDoc;
}

export interface DiffChunk {
    kind: "equal" | "insert" | "delete";
    text: string;
}

export interface DiffResult {
    chunks: DiffChunk[];
    words_added: number;
    words_removed: number;
}

export interface SpellingDto {
    /** "es", "en", "es,en" or "off". */
    language: string;
    dictionary: string[];
}

export interface FindOptions {
    query: string;
    regex: boolean;
    case_sensitive: boolean;
    whole_word: boolean;
    in_text: boolean;
    in_titles: boolean;
    in_synopsis: boolean;
    in_notes: boolean;
    /** Limit to these documents; empty searches the whole project. */
    documents: string[];
}

export interface FindMatch {
    id: string;
    document_id: string;
    document_title: string;
    field: "text" | "title" | "synopsis" | "notes";
    before: string;
    matched: string;
    replacement: string | null;
    after: string;
}

export interface FindResult {
    matches: FindMatch[];
    documents: number;
    truncated: boolean;
}

export interface ReplaceResult {
    replaced: number;
    documents: string[];
}

export interface ImageAttachmentDto {
    id: string;
    document_id: string;
    filename: string;
    mime_type: string;
    display_width: number;
    display_height: number;
    data_url: string;
}

export type CompileFormat = "txt" | "markdown" | "html" | "docx" | "pdf" | "epub";

/** Mirrors `compile::CompileSettings` in Rust. */
export interface CompileSettings {
    preset: string;
    font_family: string;
    font_size: number;
    line_spacing: number;
    /** Inches; 0 = no indent. */
    first_line_indent: number;
    /** Points after each paragraph. */
    paragraph_spacing: number;
    /** Points before each body paragraph. */
    paragraph_spacing_before: number;
    alignment: "left" | "justify";
    folder_titles: boolean;
    document_titles: boolean;
    uppercase_titles: boolean;
    /** Points; 0 = derived from the body size. */
    chapter_title_size: number;
    separator: string;
    page_break_before_chapters: boolean;
    title_page: boolean;
    keep_formatting: boolean;
    page_size: "letter" | "a4" | "a5";
    /** Inches. */
    margin: number;
    /** Inches. */
    margin_left: number;
    page_numbers: boolean;
    /** Running header on PDF and DOCX; empty = none. */
    header_text: string;
    language: string;
}

export interface CompilePreset {
    id: string;
    label: string;
    description: string;
    settings: CompileSettings;
}

export interface CompileRequest {
    format: CompileFormat;
    settings: CompileSettings;
    /** Selected binder ids; empty compiles the whole Manuscript. */
    include: string[];
    title?: string | null;
    author?: string | null;
}

/** Mirrors `commands::PreferencesDto` / `settings.rs` in Rust. */
export interface Preferences {
    general: {
        language: string;
        /** "auto" takes the colours from the wallpaper. */
        theme: "light" | "dark" | "system" | "auto";
        open_last_project_on_start: boolean;
        confirm_deletions: boolean;
        recent_max: number;
    };
    editor: {
        font_family: string;
        font_size: number;
        line_height: number;
        text_width_px: number;
        show_ruler: boolean;
        typewriter_mode: boolean;
        smart_quotes: "angular" | "curly" | "off";
        smart_ellipsis: boolean;
        dialogue_dash: boolean;
    };
    appearance: {
        show_toolbar: boolean;
        show_binder: boolean;
        show_inspector: boolean;
        density: string;
        wallpaper: {
            /** Stored image (see `setWallpaper`); empty means none. */
            file: string;
            /** How much of the image shows through, 0 to 1. */
            visibility: number;
            /** Opacity of the panels over the image, 0.3 to 1. */
            panel_opacity: number;
            blur_px: number;
        };
    };
    saving: {
        autosave: boolean;
        autosave_interval_secs: number;
        backup_count: number;
        backup_on_close: boolean;
    };
    composition: {
        background: string;
        page_color: string;
        text_color: string;
        page_width_px: number;
        font_size: number;
        page_opacity: number;
    };
    format: FormatSettings;
    sync: {
        /** This computer's random id; never changed from the interface. */
        device_id: string;
        device_name: string;
        warn_open_elsewhere: boolean;
        auto_reload: boolean;
    };
    /** Where new projects go; empty means Documents/ScribeForge. */
    default_project_dir: string;
}

/** Mirrors `format_profiles::FormatProfile` in Rust. */
export interface FormatProfile {
    font_family: string;
    font_size_pt: number;
    alignment: "left" | "justify";
    /** Word-processor multiple (1.0 single, 2.0 double). */
    line_height: number;
    first_line_indent_cm: number;
    space_before_pt: number;
    space_after_pt: number;
    no_indent_after_heading: boolean;
    /** Only used when compiling. */
    export: {
        page_size: "a4" | "a5" | "letter";
        margin_cm: number;
        inner_margin_cm: number;
        chapter_start: "new_page" | "continuous";
        /** Empty = blank line. */
        scene_separator: string;
        /** 0 = automatic. */
        chapter_title_size_pt: number;
        page_numbers: boolean;
        header_text: string;
    };
}

/** Mirrors `format_profiles::FormatSettings` in Rust. */
export interface FormatSettings {
    active_profile: string;
    /** Customised profiles by id; untouched profiles are absent. */
    custom: Record<string, FormatProfile>;
}

/** Mirrors `format_profiles::BuiltinProfile` in Rust. */
export interface BuiltinFormatProfile {
    id: string;
    name: string;
    description: string;
    profile: FormatProfile;
}

// ---------------------------------------------------------------------------
// Working from several computers (mirrors `sync` and its commands in Rust)
// ---------------------------------------------------------------------------

/** Exact text of `AppError::ExternalChange`: another computer saved the
 *  project since this one last read or wrote it. */
export const EXTERNAL_CHANGE = "the project file was changed on another computer";

export function isExternalChange(e: unknown): boolean {
    return String(e) === EXTERNAL_CHANGE;
}

export interface ConflictCopy {
    path: string;
    file_name: string;
    modified_at: string | null;
}

/** Device names are "" when the other computer has no name. */
export type OpenCheck =
    | { status: "ok" }
    | { status: "open_elsewhere"; device_name: string; last_seen: string }
    | { status: "syncing"; device_name: string; saved_at: string };

export type CloudProvider = "onedrive" | "google_drive" | "dropbox" | "icloud";

export interface SyncStatus {
    provider: CloudProvider | null;
    read_only: boolean;
}

export interface SyncPoll {
    external_change: boolean;
    dirty: boolean;
    open_elsewhere: string | null;
    saved_by: string;
}

export type MergeSide = "local" | "remote" | "both";

export interface MergeItem {
    id: string;
    title: string;
    change: "local_only" | "remote_only" | "both";
    suggested: MergeSide;
    local_deleted: boolean;
    remote_deleted: boolean;
    comparable: boolean;
}

export interface SyncConflict {
    device_name: string;
    /** File name of the conflict copy being combined, or null. */
    copy_name: string | null;
    items: MergeItem[];
}

export interface BackupDto {
    path: string;
    file_name: string;
    created_at: string | null;
    size: number;
}

export interface CreateProjectArgs {
    name: string;
    template_id: string;
    directory: string;
    author?: string | null;
}

/** A Scrivener project chosen for import (`commands::ScrivenerSource`). */
export interface ScrivenerSource {
    /** The `.scrivx` file inside the `.scriv` folder. */
    path: string;
    /** Suggested name for the new project. */
    name: string;
}

/** What an import did (`import::scrivener::ImportSummary`). */
export interface ImportSummary {
    documents: number;
    images: number;
    /** Binder titles of PDFs and other files that were not copied. */
    not_copied: string[];
}

export interface ImportScrivenerArgs {
    source: string;
    name: string;
    directory: string;
}

export const api = {
    listCategories: (): Promise<CategoryDto[]> => invoke("list_categories"),
    listTemplates: (category: string): Promise<TemplatePreview[]> =>
        invoke("list_templates", { category }),
    getTemplatePreview: (templateId: string): Promise<TemplatePreview> =>
        invoke("get_template_preview", { templateId }),
    listRecentProjects: (): Promise<RecentProjectDto[]> =>
        invoke("list_recent_projects"),
    removeRecentProject: (path: string): Promise<void> =>
        invoke("remove_recent_project", { path }),
    pickProjectFile: (): Promise<string | null> => invoke("pick_project_file"),
    openProjectAtPath: (path: string, readOnly = false): Promise<OpenProjectResult> =>
        invoke("open_project_at_path", { path, readOnly }),
    createProject: (args: CreateProjectArgs): Promise<OpenProjectResult> =>
        invoke("create_project", { args }),
    /** Opens a folder dialog; null when cancelled, rejects when no project is there. */
    pickScrivenerProject: (): Promise<ScrivenerSource | null> => invoke("pick_scrivener_project"),
    /** Creates the `.scri` file and opens it. */
    importScrivener: (args: ImportScrivenerArgs): Promise<{ opened: OpenProjectResult; summary: ImportSummary }> =>
        invoke("import_scrivener", { args }),
    getCurrentProject: (): Promise<CurrentProjectDto> =>
        invoke("get_current_project"),
    getDocument: (id: string): Promise<DocumentDto> =>
        invoke("get_document", { id }),
    createDocument: (
        parent: string,
        kind: "document" | "folder" | "research",
        title?: string,
    ): Promise<DocumentMetaDto> =>
        invoke("create_document", { parent, kind, title }),
    renameDocument: (id: string, title: string): Promise<DocumentMetaDto> =>
        invoke("rename_document", { id, title }),
    duplicateDocument: (id: string): Promise<DocumentMetaDto> =>
        invoke("duplicate_document", { id }),
    moveDocument: (id: string, newParent: string, index?: number): Promise<void> =>
        invoke("move_document", { id, newParent, index }),
    moveToTrash: (id: string): Promise<void> => invoke("move_to_trash", { id }),
    restoreFromTrash: (id: string): Promise<DocumentMetaDto> =>
        invoke("restore_from_trash", { id }),
    purgeDocument: (id: string): Promise<void> => invoke("purge_document", { id }),
    emptyTrash: (): Promise<number> => invoke("empty_trash"),
    updateDocument: (args: UpdateDocumentArgs): Promise<DocumentDto> =>
        invoke("update_document", { args }),
    addImageAttachment: (
        documentId: string,
        dataUrl: string,
        filename?: string,
    ): Promise<ImageAttachmentDto> =>
        invoke("add_image_attachment", { documentId, dataUrl, filename }),
    listImageAttachments: (documentId: string): Promise<ImageAttachmentDto[]> =>
        invoke("list_image_attachments", { documentId }),
    resizeImageAttachment: (
        documentId: string,
        attachmentId: string,
        width: number,
        height: number,
    ): Promise<ImageAttachmentDto> =>
        invoke("resize_image_attachment", { documentId, attachmentId, width, height }),
    removeImageAttachment: (documentId: string, attachmentId: string): Promise<void> =>
        invoke("remove_image_attachment", { documentId, attachmentId }),
    exportImageAttachment: (attachmentId: string): Promise<string | null> =>
        invoke("export_image_attachment", { attachmentId }),
    searchProject: (query: string): Promise<SearchHitDto[]> =>
        invoke("search_project", { query }),
    saveCurrentProject: (): Promise<void> => invoke("save_current_project"),
    autosaveProject: (): Promise<boolean> => invoke("autosave_project"),
    saveProjectAs: (path: string): Promise<OpenProjectResult> =>
        invoke("save_project_as", { path }),
    isProjectDirty: (): Promise<boolean> => invoke("is_project_dirty"),
    pickSaveFile: (title?: string, fileName?: string): Promise<string | null> =>
        invoke("pick_save_file", { title, fileName }),
    /** Saves pending changes first; rejects with EXTERNAL_CHANGE when another
     *  computer saved the project meanwhile (the project stays open). */
    closeProject: (): Promise<void> => invoke("close_project"),
    quitApp: (): Promise<void> => invoke("quit_app"),
    listCompilePresets: (): Promise<CompilePreset[]> => invoke("list_compile_presets"),
    /** Opens a native save dialog; resolves to the written path or null. */
    compileProject: (request: CompileRequest): Promise<string | null> =>
        invoke("compile_project", { request }),
    compilePreview: (request: CompileRequest): Promise<string> =>
        invoke("compile_preview", { request }),
    listFormatProfiles: (): Promise<BuiltinFormatProfile[]> => invoke("list_format_profiles"),
    getPreferences: (): Promise<Preferences> => invoke("get_preferences"),
    updatePreferences: (prefs: Preferences): Promise<Preferences> =>
        invoke("update_preferences", { prefs }),
    /** Stores the image and returns its name for `appearance.wallpaper.file`. */
    setWallpaper: (dataUrl: string): Promise<string> => invoke("set_wallpaper", { dataUrl }),
    getWallpaper: (file: string): Promise<string> => invoke("get_wallpaper", { file }),
    pickDirectory: (title?: string): Promise<string | null> =>
        invoke("pick_directory", { title }),
    getDefaultProjectDir: (): Promise<string> => invoke("get_default_project_dir"),
    projectPathExists: (directory: string, name: string): Promise<boolean> =>
        invoke("project_path_exists", { directory, name }),

    // Working from several computers
    checkProjectOpen: (path: string): Promise<OpenCheck> => invoke("check_project_open", { path }),
    listConflictCopies: (): Promise<ConflictCopy[]> => invoke("list_conflict_copies"),
    getSyncStatus: (): Promise<SyncStatus> => invoke("get_sync_status"),
    syncPoll: (): Promise<SyncPoll> => invoke("sync_poll"),
    reloadFromDisk: (): Promise<{ changed: string[] }> => invoke("reload_from_disk"),
    getSyncConflict: (copyPath?: string): Promise<SyncConflict> => invoke("get_sync_conflict", { copyPath }),
    syncConflictDiff: (id: string): Promise<DiffResult> => invoke("sync_conflict_diff", { id }),
    resolveSyncConflict: (choices: Record<string, MergeSide>, snapshotLabel: string): Promise<void> =>
        invoke("resolve_sync_conflict", { choices, snapshotLabel }),
    cancelSyncConflict: (): Promise<void> => invoke("cancel_sync_conflict"),
    trashConflictCopy: (path: string): Promise<void> => invoke("trash_conflict_copy", { path }),
    syncTakeOver: (): Promise<void> => invoke("sync_take_over"),
    listLocalBackups: (): Promise<BackupDto[]> => invoke("list_local_backups"),
    restoreLocalBackup: (path: string): Promise<void> => invoke("restore_local_backup", { path }),

    // Goals and statistics
    getWritingGoals: (): Promise<WritingGoalsDto> => invoke("get_writing_goals"),
    setWritingGoals: (args: WritingGoalsArgs): Promise<WritingGoalsDto> =>
        invoke("set_writing_goals", { args }),
    resetWritingSession: (): Promise<WritingGoalsDto> => invoke("reset_writing_session"),
    getWritingStats: (): Promise<WritingStatsDto> => invoke("get_writing_stats"),

    // Snapshots
    createSnapshot: (documentId: string, name?: string): Promise<SnapshotMeta> =>
        invoke("create_snapshot", { documentId, name }),
    listSnapshots: (documentId: string): Promise<SnapshotMeta[]> =>
        invoke("list_snapshots", { documentId }),
    getSnapshot: (documentId: string, snapshotId: string): Promise<SnapshotDto> =>
        invoke("get_snapshot", { documentId, snapshotId }),
    renameSnapshot: (documentId: string, snapshotId: string, name: string): Promise<void> =>
        invoke("rename_snapshot", { documentId, snapshotId, name }),
    deleteSnapshot: (documentId: string, snapshotId: string): Promise<void> =>
        invoke("delete_snapshot", { documentId, snapshotId }),
    restoreSnapshot: (documentId: string, snapshotId: string): Promise<DocumentDto> =>
        invoke("restore_snapshot", { documentId, snapshotId }),
    /** Compare with the current text, or with another snapshot. */
    diffSnapshot: (documentId: string, snapshotId: string, otherId?: string): Promise<DiffResult> =>
        invoke("diff_snapshot", { documentId, snapshotId, otherId }),

    // Spelling
    getSpelling: (): Promise<SpellingDto> => invoke("get_spelling"),
    setSpellLanguage: (language: string): Promise<SpellingDto> =>
        invoke("set_spell_language", { language }),
    addToDictionary: (word: string): Promise<SpellingDto> => invoke("add_to_dictionary", { word }),
    removeFromDictionary: (word: string): Promise<SpellingDto> =>
        invoke("remove_from_dictionary", { word }),
    /** Resolves to the misspelled words among `words`. */
    spellCheck: (words: string[]): Promise<string[]> => invoke("spell_check", { words }),
    spellSuggest: (word: string): Promise<string[]> => invoke("spell_suggest", { word }),

    // Find and replace
    findInProject: (options: FindOptions, replacement?: string | null): Promise<FindResult> =>
        invoke("find_in_project", { options, replacement }),
    /** Replaces the listed match ids (every match when `ids` is null). */
    replaceInProject: (options: FindOptions, replacement: string, ids: string[] | null): Promise<ReplaceResult> =>
        invoke("replace_in_project", { options, replacement, ids }),

    // Labels and statuses
    getOrganization: (): Promise<OrganizationDto> => invoke("get_organization"),
    setOrganization: (labels: ColorDef[], statuses: ColorDef[], renames: DefinitionRename[]): Promise<OrganizationDto> =>
        invoke("set_organization", { labelsList: labels, statuses, renames }),

    // Collections
    listCollections: (): Promise<Collection[]> => invoke("list_collections"),
    saveCollection: (collection: Collection): Promise<Collection[]> => invoke("save_collection", { collection }),
    deleteCollection: (id: string): Promise<Collection[]> => invoke("delete_collection", { id }),
    moveCollection: (id: string, index: number): Promise<Collection[]> => invoke("move_collection", { id, index }),
    addToCollection: (id: string, documents: string[]): Promise<Collection[]> =>
        invoke("add_to_collection", { id, documents }),
    removeFromCollection: (id: string, document: string): Promise<Collection[]> =>
        invoke("remove_from_collection", { id, document }),
    collectionItems: (id: string): Promise<DocumentMetaDto[]> => invoke("collection_items", { id }),

    // Links and timeline
    getLinks: (id: string): Promise<LinksDto> => invoke("get_links", { id }),
    getTimeline: (): Promise<TimelineEvent[]> => invoke("get_timeline"),
    saveTimelineEvent: (event: TimelineEvent): Promise<TimelineEvent[]> => invoke("save_timeline_event", { event }),
    deleteTimelineEvent: (id: string): Promise<TimelineEvent[]> => invoke("delete_timeline_event", { id }),

    // Corkboard
    resetCardPositions: (folder: string): Promise<void> => invoke("reset_card_positions", { folder }),
};
