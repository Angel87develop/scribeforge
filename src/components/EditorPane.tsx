/// A single editor pane: title bar + Tiptap editor.
///
/// The format bar is NOT per pane: `SplitEditor` renders one shared bar above
/// all panes and binds it to the active pane via `registerEditorApi` and
/// `onFormatChange`.
///
/// The title bar shows the document title — editable in place (double-click),
/// but it is NOT inside the editable content. The content is the Rust
/// `RichDoc` model translated via `RichDocConversion`.

import { memo, useCallback, useEffect, useState } from "react";
import { api, type DocumentDto, type DocumentMetaDto, type RichDoc } from "../services/api";
import { Corkboard } from "./Corkboard";
import { RichTextEditor, type EditorApi, type FormatState } from "./RichTextEditor";
import { IconChevronDown, IconClose } from "./Icons";
import "../styles/editor-pane.css";

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
}: Props) {
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
    const hasEditor = !!documentId && !!doc && !loading && !isFolder;

    // Drop the registration whenever no editor is mounted (empty pane,
    // folder view, unmount) so the shared format bar never drives a
    // destroyed editor.
    useEffect(() => {
        if (hasEditor) return;
        registerEditorApi?.(paneKey, null);
        onFormatChange?.(paneKey, null);
    }, [hasEditor, paneKey, registerEditorApi, onFormatChange]);
    useEffect(() => {
        return () => {
            registerEditorApi?.(paneKey, null);
            onFormatChange?.(paneKey, null);
        };
    }, [paneKey, registerEditorApi, onFormatChange]);

    // Load document content when the selection changes.
    useEffect(() => {
        if (!documentId) {
            setDoc(null);
            return;
        }
        setLoading(true);
        api.getDocument(documentId)
            .then((d) => {
                setDoc(d);
                setLoading(false);
            })
            .catch((e) => {
                onError(String(e));
                setLoading(false);
            });
    }, [documentId, onError]);

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
                if (!confirm("Delete permanently? This cannot be undone.")) return;
                await api.purgeDocument(doc.id);
            }
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    if (loading) {
        return <div className="editor-pane-loading"><div className="spinner" /> Loading…</div>;
    }

    const closeBtn = onClose && (
        <button
            type="button"
            className="editor-title-menu-btn"
            title="Close this pane"
            onClick={onClose}
        >
            <IconClose size={14} />
        </button>
    );

    if (!documentId || !doc) {
        return (
            <div className="editor-pane" data-pane={paneKey}>
                {closeBtn && <div className="editor-titlebar editor-titlebar-empty">{closeBtn}</div>}
                <div className="editor-pane-empty">Select a document to begin writing.</div>
            </div>
        );
    }

    const shownTitle = title ?? doc.title;

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
                        title="Double-click to rename"
                        onDoubleClick={() => {
                            setTitleDraft(shownTitle);
                            setEditingTitle(true);
                        }}
                    >
                        {shownTitle}
                    </div>
                )}
                <div className="editor-title-meta">
                    {doc.word_count > 0 && <span>{doc.word_count.toLocaleString()} words</span>}
                    <button
                        type="button"
                        className="editor-title-menu-btn"
                        title="Document actions"
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
                            Rename
                        </button>
                        <button className="ctx-item" onClick={() => docAction("duplicate")}>
                            Duplicate
                        </button>
                        <div className="ctx-sep" />
                        <button className="ctx-item" onClick={() => docAction("trash")}>
                            Move to Trash
                        </button>
                        <button className="ctx-item" onClick={() => docAction("restore")}>
                            Restore
                        </button>
                        <button className="ctx-item danger" onClick={() => docAction("purge")}>
                            Delete Permanently
                        </button>
                    </div>
                </>
            )}

            {isFolder ? (
                <Corkboard
                    folderId={doc.id}
                    binder={binder}
                    onOpenDocument={(id, kind) => onOpenDocument?.(paneKey, id, kind)}
                    onRefresh={onRefresh}
                    onError={onError}
                />
            ) : (
                <RichTextEditor
                    key={doc.id}
                    initialContent={doc.content}
                    editable={editable}
                    paneId={paneKey}
                    onContentChanged={handleContent}
                    registerApi={registerApi}
                    registerFormatState={setFormat}
                    onFocused={onPaneFocused}
                />
            )}
        </div>
    );
});