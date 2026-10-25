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
    | { type: "highlight"; hex: string };

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
    created_at: string;
    modified_at: string;
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

export interface CreateProjectArgs {
    name: string;
    template_id: string;
    directory: string;
    author?: string | null;
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
    openExistingFileDialog: (): Promise<OpenProjectResult | null> =>
        invoke("open_existing_file_dialog"),
    openProjectAtPath: (path: string): Promise<OpenProjectResult> =>
        invoke("open_project_at_path", { path }),
    createProject: (args: CreateProjectArgs): Promise<OpenProjectResult> =>
        invoke("create_project", { args }),
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
    closeProject: (): Promise<void> => invoke("close_project"),
    quitApp: (): Promise<void> => invoke("quit_app"),
    pickDirectory: (title?: string): Promise<string | null> =>
        invoke("pick_directory", { title }),
    getDefaultProjectDir: (): Promise<string> => invoke("get_default_project_dir"),
    projectPathExists: (directory: string, name: string): Promise<boolean> =>
        invoke("project_path_exists", { directory, name }),
};
