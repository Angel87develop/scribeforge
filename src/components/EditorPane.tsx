/// A single editor pane: title bar + Tiptap editor.
///
/// The format bar is NOT per pane: `SplitEditor` renders one shared bar above
/// all panes and binds it to the active pane via `registerEditorApi` and
/// `onFormatChange`.
///
/// The title bar shows the document title — editable in place (double-click),
/// but it is NOT inside the editable content. The content is the Rust
/// `RichDoc` model translated via `RichDocConversion`.
///
/// A folder, or a document with subdocuments, can be shown in several views,
/// picked from the switcher in the title bar and remembered per pane:
/// - Text (documents only): the document's own text.
/// - Scrivenings: every document inside, edited one after another.
/// - Corkboard: index cards for the direct children.
/// - Outliner: a sortable table of everything inside.
///
/// In the Text view the document's margin comments are shown beside the
/// text, a character or place sheet shows its fields above the text, and a
/// word-count target (if set) appears as a progress bar in the title bar.

import { memo, useCallback, useEffect, useRef, useState } from "react";
import { api, type CommentDto, type DocumentDto, type DocumentMetaDto, type RichDoc, type Sheet } from "../services/api";
import { SheetPanel } from "./SheetPanel";
import { Corkboard } from "./Corkboard";
import { Outliner } from "./Outliner";
import { RichTextEditor, type EditorApi, type FormatState } from "./RichTextEditor";
import { Scrivenings } from "./Scrivenings";
import { IconCards, IconChevronDown, IconClose, IconDocument, IconList, IconText } from "./Icons";
import "../styles/editor-pane.css";
import "../styles/outliner.css";
import { getLanguage, t, tn, useLanguage } from "../i18n";

export type GroupView = "text" | "scrivenings" | "corkboard" | "outliner";

const VIEW_LABELS: Record<GroupView, string> = {
    text: "Text",
    scrivenings: "Scrivenings",
    corkboard: "Corkboard",
    outliner: "Outliner",
};

function viewKey(paneKey: string, folder: boolean): string {
    return `sf.view.${paneKey}.${folder ? "folder" : "document"}`;
}

function loadView(paneKey: string, folder: boolean): GroupView {
    const v = localStorage.getItem(viewKey(paneKey, folder));
    if (v === "scrivenings" || v === "corkboard" || v === "outliner") return v;
    if (v === "text" && !folder) return v;
    return folder ? "corkboard" : "text";
}

/** Every binder id, for a pane that must be entirely read-only. */
function allIds(binder: DocumentMetaDto[]): ReadonlySet<string> {
    return new Set(binder.map((d) => d.id));
}

interface Props {
    documentId: string | null;
    /** Which split pane this is ("primary" | "secondary"). */
    paneKey: "primary" | "secondary";
    /** Binder items; a folder pane shows its children as a corkboard. */
    binder: DocumentMetaDto[];
    /** Opens a document from this pane's corkboard in this pane. */
    onOpenDocument?: (paneKey: string, id: string, kind: string) => void;
    /** Live title from the binder; overrides the title loaded with the doc. */
    title?: string;
    /** When set (split view), shows an X that closes this pane. */
    onClose?: () => void;
    /** False when the pane must be read-only (e.g. same doc in both panes). */
    editable?: boolean;
    onTitleChanged: (id: string, title: string) => void;
    onContentChanged: (id: string, doc: RichDoc, wordCount: number) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
    /** Registers this pane's editor API with the workspace. */
    registerEditorApi?: (paneKey: string, api: EditorApi | null) => void;
    /** Notifies the workspace that this pane gained focus. */
    onPaneFocused?: (paneKey: string) => void;
    /** Reports this pane's format state (null when no editor is shown). */
    onFormatChange?: (paneKey: string, format: FormatState | null) => void;
    /** Documents being edited in the other pane: shown read-only here. */
    lockedIds?: ReadonlySet<string>;
    /** Reports which documents this pane shows as editable text. */
    onDisplayedIds?: (paneKey: string, ids: string[]) => void;
    /** Changes when document text was changed outside the editor (find and
     *  replace, snapshot restore): the pane reloads what it shows. */
    reloadToken?: number;
}

export const EditorPane = memo(function EditorPane({
    documentId,
    paneKey,
    binder,
    onOpenDocument,
    title,
    onClose,
    editable = true,
    onTitleChanged,
    onContentChanged,
    onRefresh,
    onError,
    registerEditorApi,
    onPaneFocused,
    onFormatChange,
    lockedIds,
    onDisplayedIds,
    reloadToken = 0,
}: Props) {
    // Memoised: it has to follow language changes on its own.
    useLanguage();
    const [doc, setDoc] = useState<DocumentDto | null>(null);
    const [loading, setLoading] = useState(false);
    const [editingTitle, setEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

    const registerApi = useCallback(
        (a: EditorApi) => registerEditorApi?.(paneKey, a),
        [paneKey, registerEditorApi],
    );

    const setFormat = useCallback(
        (f: FormatState | null) => onFormatChange?.(paneKey, f),
        [paneKey, onFormatChange],
    );

    const isFolder =
        !!doc &&
        (doc.kind === "folder" ||
            doc.kind === "draft_root" ||
            doc.kind === "research_root" ||
            doc.kind === "trash_root");
    const hasChildren = !!documentId && binder.some((d) => d.parent === documentId);
    const grouped = isFolder || hasChildren;

    // The view of a folder / parent document, remembered per pane.
    const [folderView, setFolderView] = useState<GroupView>(() => loadView(paneKey, true));
    const [docView, setDocView] = useState<GroupView>(() => loadView(paneKey, false));
    const view: GroupView = !grouped ? "text" : isFolder ? folderView : docView;
    const chooseView = (v: GroupView) => {
        localStorage.setItem(viewKey(paneKey, isFolder), v);
        if (isFolder) setFolderView(v);
        else setDocView(v);
    };
    const views: GroupView[] = isFolder
        ? ["scrivenings", "corkboard", "outliner"]
        : ["text", "scrivenings", "corkboard", "outliner"];

    const hasEditor = !!documentId && !!doc && !loading && view === "text";
    const locked = !!doc && (lockedIds?.has(doc.id) ?? false);

    // Report the documents shown as text (Scrivenings reports its own list).
    const textDocId = hasEditor && doc && editable ? doc.id : null;
    useEffect(() => {
        if (view === "scrivenings") return;
        onDisplayedIds?.(paneKey, textDocId ? [textDocId] : []);
    }, [view, textDocId, paneKey, onDisplayedIds]);
    const reportScrivenings = useCallback(
        (ids: string[]) => onDisplayedIds?.(paneKey, editable ? ids : []),
        [paneKey, editable, onDisplayedIds],
    );

    // Drop the registration whenever no editor is mounted (empty pane,
    // folder view, unmount) so the shared format bar never drives a
    // destroyed editor. Scrivenings registers its own editors.
    useEffect(() => {
        if (hasEditor || view === "scrivenings") return;
        registerEditorApi?.(paneKey, null);
        onFormatChange?.(paneKey, null);
    }, [hasEditor, view, paneKey, registerEditorApi, onFormatChange]);
    useEffect(() => {
        return () => {
            registerEditorApi?.(paneKey, null);
            onFormatChange?.(paneKey, null);
        };
    }, [paneKey, registerEditorApi, onFormatChange]);

    // Comment edits are saved shortly after the last keystroke; a pending
    // save is flushed when the pane switches documents or closes.
    const commentSave = useRef<{ id: string; list: CommentDto[]; timer: number } | null>(null);
    const flushComments = useCallback(() => {
        const pending = commentSave.current;
        if (!pending) return;
        window.clearTimeout(pending.timer);
        commentSave.current = null;
        api.updateDocument({ id: pending.id, comments: pending.list }).catch((e) => onError(String(e)));
    }, [onError]);
    useEffect(() => flushComments, [documentId, reloadToken, flushComments]);

    // Load document content when the selection changes (or its text was
    // changed outside the editor). `loadSeq` counts completed loads and keys
    // the editor, so it remounts only once the new text has arrived.
    const [loadSeq, setLoadSeq] = useState(0);
    useEffect(() => {
        if (!documentId) {
            setDoc(null);
            return;
        }
        setLoading(true);
        api.getDocument(documentId)
            .then((d) => {
                setDoc(d);
                setLoadSeq((n) => n + 1);
                setLoading(false);
            })
            .catch((e) => {
                onError(String(e));
                setLoading(false);
            });
    }, [documentId, reloadToken, onError]);

    // Sheet edits are saved the same way as comments.
    const sheetSave = useRef<{ id: string; sheet: Sheet; timer: number } | null>(null);
    const flushSheet = useCallback(() => {
        const pending = sheetSave.current;
        if (!pending) return;
        window.clearTimeout(pending.timer);
        sheetSave.current = null;
        api.updateDocument({ id: pending.id, sheet: pending.sheet }).catch((e) => onError(String(e)));
    }, [onError]);
    useEffect(() => flushSheet, [documentId, reloadToken, flushSheet]);

    const handleSheet = useCallback(
        (sheet: Sheet) => {
            setDoc((prev) => (prev ? { ...prev, sheet } : prev));
            if (!doc) return;
            if (sheetSave.current) window.clearTimeout(sheetSave.current.timer);
            sheetSave.current = { id: doc.id, sheet, timer: window.setTimeout(flushSheet, 500) };
        },
        [doc, flushSheet],
    );

    const removeSheet = useCallback(() => {
        if (!doc) return;
        if (sheetSave.current) window.clearTimeout(sheetSave.current.timer);
        sheetSave.current = null;
        setDoc((prev) => (prev ? { ...prev, sheet: null } : prev));
        api.updateDocument({ id: doc.id, remove_sheet: true })
            .then(() => onRefresh())
            .catch((e) => onError(String(e)));
    }, [doc, onRefresh, onError]);

    const handleComments = useCallback(
        (list: CommentDto[]) => {
            setDoc((prev) => (prev ? { ...prev, comments: list } : prev));
            if (!doc) return;
            if (commentSave.current) window.clearTimeout(commentSave.current.timer);
            const id = doc.id;
            commentSave.current = { id, list, timer: window.setTimeout(flushComments, 500) };
        },
        [doc, flushComments],
    );

    const handleContent = useCallback(
        (rich: RichDoc, words: number) => {
            if (!doc) return;
            setDoc((prev) => (prev ? { ...prev, content: rich, word_count: words } : prev));
            onContentChanged(doc.id, rich, words);
        },
        [doc, onContentChanged],
    );

    function commitTitle() {
        const t = titleDraft.trim();
        if (!doc || !t || t === (title ?? doc.title)) {
            setEditingTitle(false);
            return;
        }
        api.updateDocument({ id: doc.id, title: t })
            .then((updated) => {
                setDoc(updated);
                onTitleChanged(updated.id, updated.title);
                setEditingTitle(false);
            })
            .catch((e) => {
                onError(String(e));
                setEditingTitle(false);
            });
    }

    async function docAction(action: "duplicate" | "trash" | "restore" | "purge") {
        if (!doc) return;
        setMenu(null);
        try {
            if (action === "duplicate") {
                await api.duplicateDocument(doc.id);
            } else if (action === "trash") {
                await api.moveToTrash(doc.id);
            } else if (action === "restore") {
                await api.restoreFromTrash(doc.id);
            } else if (action === "purge") {
                if (!confirm(t("Delete permanently? This cannot be undone."))) return;
                await api.purgeDocument(doc.id);
            }
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    if (loading) {
        return <div className="editor-pane-loading"><div className="spinner" /> {t("Loading…")}</div>;
    }

    const closeBtn = onClose && (
        <button
            type="button"
            className="editor-title-menu-btn"
            title={t("Close this pane")}
            onClick={onClose}
        >
            <IconClose size={14} />
        </button>
    );

    if (!documentId || !doc) {
        return (
            <div className="editor-pane" data-pane={paneKey}>
                {closeBtn && <div className="editor-titlebar editor-titlebar-empty">{closeBtn}</div>}
                <div className="editor-pane-empty">{t("Select a document to begin writing.")}</div>
            </div>
        );
    }

    const shownTitle = title ?? doc.title;
    const goal = doc.word_goal ?? 0;

    return (
        <div className="editor-pane" data-pane={paneKey}>
            {/* Title bar — independent from the content */}
            <div className="editor-titlebar">
                {editingTitle ? (
                    <input
                        autoFocus
                        className="editor-title-input"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                        onBlur={commitTitle}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") {
                                e.preventDefault();
                                commitTitle();
                            } else if (e.key === "Escape") {
                                e.preventDefault();
                                setEditingTitle(false);
                            }
                        }}
                    />
                ) : (
                    <div
                        className="editor-title"
                        title={t("Double-click to rename")}
                        onDoubleClick={() => {
                            setTitleDraft(shownTitle);
                            setEditingTitle(true);
                        }}
                    >
                        {shownTitle}
                    </div>
                )}
                <div className="editor-title-meta">
                    {grouped && (
                        <div className="view-switch" role="tablist" aria-label={t("View")}>
                            {views.map((v) => (
                                <button
                                    key={v}
                                    type="button"
                                    role="tab"
                                    aria-selected={view === v}
                                    className={view === v ? "active" : ""}
                                    title={t(VIEW_LABELS[v])}
                                    onClick={() => chooseView(v)}
                                >
                                    {v === "text" && <IconDocument size={12} />}
                                    {v === "scrivenings" && <IconText size={12} />}
                                    {v === "corkboard" && <IconCards size={12} />}
                                    {v === "outliner" && <IconList size={12} />}
                                    <span className="view-switch-label">{t(VIEW_LABELS[v])}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    {goal > 0 ? (
                        <span
                            className="title-goal"
                            title={t("{n} of {goal} words", {
                                n: doc.word_count.toLocaleString(getLanguage()),
                                goal: goal.toLocaleString(getLanguage()),
                            })}
                        >
                            <span className="title-goal-bar">
                                <span
                                    className={`title-goal-fill${doc.word_count >= goal ? " done" : ""}`}
                                    style={{ width: `${Math.min(100, (doc.word_count / goal) * 100)}%` }}
                                />
                            </span>
                            {doc.word_count.toLocaleString(getLanguage())} / {goal.toLocaleString(getLanguage())}
                        </span>
                    ) : (
                        doc.word_count > 0 && <span>{tn(doc.word_count, "{n} word", "{n} words")}</span>
                    )}
                    <button
                        type="button"
                        className="editor-title-menu-btn"
                        title={t("Document actions")}
                        onClick={(e) => {
                            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setMenu({ x: rect.left, y: rect.bottom + 2 });
                        }}
                    >
                        <IconChevronDown size={14} />
                    </button>
                    {closeBtn}
                </div>
            </div>

            {menu && (
                <>
                    <div className="ctx-backdrop" onClick={() => setMenu(null)} />
                    <div className="ctx-menu" style={{ left: menu.x, top: menu.y }}>
                        <button className="ctx-item" onClick={() => { setMenu(null); setTitleDraft(shownTitle); setEditingTitle(true); }}>
                            {t("Rename")}
                        </button>
                        <button className="ctx-item" onClick={() => docAction("duplicate")}>
                            {t("Duplicate")}
                        </button>
                        <div className="ctx-sep" />
                        <button className="ctx-item" onClick={() => docAction("trash")}>
                            {t("Move to Trash")}
                        </button>
                        <button className="ctx-item" onClick={() => docAction("restore")}>
                            {t("Restore")}
                        </button>
                        <button className="ctx-item danger" onClick={() => docAction("purge")}>
                            {t("Delete Permanently")}
                        </button>
                    </div>
                </>
            )}

            {view === "corkboard" ? (
                <Corkboard
                    folderId={doc.id}
                    binder={binder}
                    onOpenDocument={(id, kind) => onOpenDocument?.(paneKey, id, kind)}
                    onRefresh={onRefresh}
                    onError={onError}
                />
            ) : view === "outliner" ? (
                <Outliner
                    rootId={doc.id}
                    binder={binder}
                    onOpenDocument={(id, kind) => onOpenDocument?.(paneKey, id, kind)}
                    onRefresh={onRefresh}
                    onError={onError}
                />
            ) : view === "scrivenings" ? (
                <Scrivenings
                    key={`${doc.id}:${loadSeq}`}
                    rootId={doc.id}
                    binder={binder}
                    paneKey={paneKey}
                    includeRoot={!isFolder}
                    lockedIds={editable ? lockedIds : allIds(binder)}
                    onContentChanged={onContentChanged}
                    onOpenDocument={(id, kind) => onOpenDocument?.(paneKey, id, kind)}
                    registerEditorApi={registerEditorApi}
                    onFormatChange={onFormatChange}
                    onPaneFocused={onPaneFocused}
                    onDisplayedIds={reportScrivenings}
                    onError={onError}
                />
            ) : (
                <>
                {doc.sheet && (
                    <SheetPanel
                        sheet={doc.sheet}
                        documentId={doc.id}
                        binder={binder}
                        editable={editable && !locked}
                        onChange={handleSheet}
                        onRemove={removeSheet}
                        onOpenDocument={(id) => {
                            const kind = binder.find((d) => d.id === id)?.kind ?? "document";
                            onOpenDocument?.(paneKey, id, kind);
                        }}
                    />
                )}
                <RichTextEditor
                    key={`${doc.id}:${loadSeq}`}
                    initialContent={doc.content}
                    editable={editable && !locked}
                    paneId={paneKey}
                    onContentChanged={handleContent}
                    registerApi={registerApi}
                    registerFormatState={setFormat}
                    onFocused={onPaneFocused}
                    comments={doc.comments ?? []}
                    onCommentsChange={handleComments}
                />
                </>
            )}
        </div>
    );
});