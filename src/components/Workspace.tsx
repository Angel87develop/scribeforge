/// Workspace: the main editing surface when a project is open.
///
/// Layout (top to bottom, left to right):
///   MenuBar
///   Toolbar
///   +---- Binder | SplitEditor | Inspector ----+
///   Status bar
///
/// Wires:
/// - Full CRUD on documents via the backend commands.
/// - Rich-text editing (Tiptap) with debounced autosave.
/// - Split editor: two documents simultaneously, vertical or horizontal.
/// - Inspector metadata editing and image attachments.
/// - Resizable binder / inspector panels (persisted in localStorage).
/// - Global keyboard shortcuts (Ctrl+S, Ctrl+N, Ctrl+F, ...).
/// - Project-wide search overlay.
/// - A dirty-state indicator in the status bar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    api,
    type CurrentProjectDto,
    type DocumentMetaDto,
    type RichDoc,
    type SearchHitDto,
} from "../services/api";
import { Binder } from "./Binder";
import { Inspector } from "./Inspector";
import { MenuBar, type MenuAction, type MenuDef } from "./MenuBar";
import { SplitEditor } from "./SplitEditor";
import { Toolbar } from "./Toolbar";
import type { EditorApi } from "./RichTextEditor";
import { IconSearch } from "./Icons";
import "../styles/workspace.css";

interface Props {
    onBackToTemplates: () => void;
}

const BINDER_KEY = "sf.binder.width";
const INSPECTOR_KEY = "sf.inspector.width";
const INSPECTOR_OPEN_KEY = "sf.inspector.open";
const BINDER_OPEN_KEY = "sf.binder.open";

function loadWidth(key: string, def: number): number {
    const v = localStorage.getItem(key);
    if (!v) return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= 120 && n <= 600 ? n : def;
}

function isFolderKind(kind: string): boolean {
    return kind === "folder" || kind === "draft_root" || kind === "research_root" || kind === "trash_root";
}

function isRootKind(kind: string): boolean {
    return kind === "draft_root" || kind === "research_root" || kind === "trash_root";
}

export function Workspace({ onBackToTemplates }: Props) {
    const [project, setProject] = useState<CurrentProjectDto | null>(null);
    const [binder, setBinder] = useState<DocumentMetaDto[]>([]);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [selectedKind, setSelectedKind] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<string>("");
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [searchHits, setSearchHits] = useState<SearchHitDto[]>([]);

    // Panel state.
    const [binderOpen, setBinderOpen] = useState(() => localStorage.getItem(BINDER_OPEN_KEY) !== "0");
    const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem(INSPECTOR_OPEN_KEY) !== "0");
    const [binderWidth, setBinderWidth] = useState(() => loadWidth(BINDER_KEY, 240));
    const [inspectorWidth, setInspectorWidth] = useState(() => loadWidth(INSPECTOR_KEY, 300));
    const [zoom, setZoom] = useState(1);

    // Active editor APIs — one per split pane; flushed on save.
    const editorApisRef = useRef<Map<string, EditorApi>>(new Map());
    const focusedPaneRef = useRef<string>("primary");

    const registerEditorApi = useCallback((paneKey: string, api: EditorApi | null) => {
        if (api) editorApisRef.current.set(paneKey, api);
        else editorApisRef.current.delete(paneKey);
    }, []);

    const onPaneFocused = useCallback((paneKey: string) => {
        focusedPaneRef.current = paneKey;
    }, []);

    // ----- Load project -----
    const refresh = useCallback(async () => {
        try {
            const p = await api.getCurrentProject();
            setProject(p);
            setBinder(p.binder);
            setExpanded((prev) => {
                const next = new Set<string>();
                for (const d of p.binder) {
                    // Documents with sub-documents expand too.
                    if (prev.has(d.id)) next.add(d.id);
                    if (isRootKind(d.kind)) next.add(d.id);
                }
                return next;
            });
            if (selectedId && !p.binder.some((d) => d.id === selectedId)) {
                setSelectedId(null);
                setSelectedKind(null);
            }
        } catch (e) {
            setError(String(e));
        }
    }, [selectedId]);

    useEffect(() => {
        refresh();
    }, []);

    // ----- Selection -----
    const selectDoc = useCallback((id: string, kind: string) => {
        setSelectedId(id);
        setSelectedKind(kind);
    }, []);

    const toggleExpand = useCallback((id: string) => {
        setExpanded((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }, []);

    // ----- Content updates from the editor (debounced inside RichTextEditor) -----
    const handleContentChanged = useCallback(async (id: string, rich: RichDoc, words: number) => {
        // Optimistic word-count update for the binder row.
        setBinder((prev) => prev.map((m) => (m.id === id ? { ...m, word_count: words } : m)));
        try {
            await api.updateDocument({ id, content: rich });
        } catch (e) {
            setError(String(e));
        }
    }, []);

    const handleTitleChanged = useCallback(async (id: string, title: string) => {
        setBinder((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)));
        try {
            await api.updateDocument({ id, title });
        } catch (e) {
            setError(String(e));
        }
    }, []);

    // ----- Manual save -----
    const save = useCallback(async () => {
        try {
            // Flush every open editor's pending edits before writing the file.
            editorApisRef.current.forEach((ed) => ed.flush());
            await api.saveCurrentProject();
            setStatus("Project saved");
            setProject((p) => (p ? { ...p, dirty: false } : p));
        } catch (e) {
            setError(String(e));
        }
    }, []);

    // ----- Autosave loop (every 30s when dirty) -----
    useEffect(() => {
        const id = window.setInterval(async () => {
            try {
                const wrote = await api.autosaveProject();
                if (wrote) {
                    setStatus("Autosaved");
                    setProject((p) => (p ? { ...p, dirty: false } : p));
                }
            } catch (e) {
                setError(String(e));
            }
        }, 30000);
        return () => window.clearInterval(id);
    }, []);

    // ----- Helpers for document actions -----
    function defaultParentId(): string | null {
        if (!selectedId) {
            const draft = binder.find((d) => d.kind === "draft_root");
            return draft ? draft.id : null;
        }
        const sel = binder.find((d) => d.id === selectedId);
        if (!sel) return null;
        if (isFolderKind(sel.kind)) return sel.id;
        return sel.parent;
    }

    async function createChild(kind: "document" | "folder") {
        const parent = defaultParentId();
        if (!parent) {
            setError("No suitable parent folder. Select a folder first.");
            return;
        }
        try {
            const meta = await api.createDocument(parent, kind);
            setExpanded((prev) => new Set(prev).add(parent));
            await refresh();
            setSelectedId(meta.id);
            if (kind === "document") setSelectedKind("document");
        } catch (e) {
            setError(String(e));
        }
    }

    // ----- Actions -----
    const action = useCallback(
        async (a: MenuAction) => {
            setError(null);
            try {
                switch (a) {
                    case "new-project":
                        onBackToTemplates();
                        return;
                    case "open-project":
                        onBackToTemplates();
                        return;
                    case "new-document":
                        await createChild("document");
                        return;
                    case "new-folder":
                        await createChild("folder");
                        return;
                    case "save":
                        await save();
                        return;
                    case "save-as": {
                        const name = project ? `${project.name} (copy).scri` : "Project.scri";
                        const path = await api.pickSaveFile("Save Project As", name);
                        if (path) {
                            await api.saveProjectAs(path);
                            setStatus("Saved as new project");
                            await refresh();
                        }
                        return;
                    }
                    case "close-project":
                        await api.closeProject();
                        onBackToTemplates();
                        return;
                    case "exit":
                        await api.quitApp();
                        return;
                    case "undo":
                    case "redo":
                    case "cut":
                    case "copy":
                    case "paste":
                    case "select-all": {
                        // Clipboard/history ops operate on the focused pane.
                        const editor = editorApisRef.current.get(focusedPaneRef.current);
                        editor?.focus();
                        const cmd = {
                            "undo": "undo",
                            "redo": "redo",
                            "cut": "cut",
                            "copy": "copy",
                            "paste": "paste",
                            "select-all": "selectAll",
                        }[a];
                        document.execCommand(cmd);
                        return;
                    }
                    case "find":
                    case "search-project":
                    case "project-search":
                        setSearchOpen(true);
                        return;
                    case "toggle-binder":
                        setBinderOpen((v) => {
                            const n = !v;
                            localStorage.setItem(BINDER_OPEN_KEY, n ? "1" : "0");
                            return n;
                        });
                        return;
                    case "toggle-inspector":
                        setInspectorOpen((v) => {
                            const n = !v;
                            localStorage.setItem(INSPECTOR_OPEN_KEY, n ? "1" : "0");
                            return n;
                        });
                        return;
                    case "duplicate":
                        if (selectedId) {
                            await api.duplicateDocument(selectedId);
                            await refresh();
                        }
                        return;
                    case "rename":
                        setStatus("Double-click the document title (or a binder row) to rename.");
                        return;
                    case "move-to-trash":
                        if (selectedId) {
                            await api.moveToTrash(selectedId);
                            setSelectedId(null);
                            setSelectedKind(null);
                            await refresh();
                        }
                        return;
                    case "restore":
                        if (selectedId) {
                            await api.restoreFromTrash(selectedId);
                            await refresh();
                        }
                        return;
                    case "delete-permanently":
                        if (selectedId && confirm("Delete permanently? This cannot be undone.")) {
                            await api.purgeDocument(selectedId);
                            setSelectedId(null);
                            setSelectedKind(null);
                            await refresh();
                        }
                        return;
                    case "zoom-in":
                        setZoom((z) => Math.min(z + 0.1, 2));
                        return;
                    case "zoom-out":
                        setZoom((z) => Math.max(z - 0.1, 0.5));
                        return;
                    case "zoom-reset":
                        setZoom(1);
                        return;
                    case "about":
                        setStatus("ScribeForge 0.1.0 — a desktop writing application.");
                        return;
                    case "shortcuts":
                        setStatus("Ctrl+S save · Ctrl+N new doc · Ctrl+F find · Ctrl+B/I/U format · Ctrl+Shift+B/I panels.");
                        return;
                    case "reset-layout":
                        localStorage.removeItem(BINDER_KEY);
                        localStorage.removeItem(INSPECTOR_KEY);
                        setBinderWidth(240);
                        setInspectorWidth(300);
                        return;
                    case "word-count":
                    case "project-stats":
                        setStatus(
                            `${project?.word_count ?? 0} words in manuscript · ${binder.length} items in binder.`,
                        );
                        return;
                    default:
                        return;
                }
            } catch (e) {
                setError(String(e));
            }
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selectedId, project, binder, save],
    );

    // ----- Keyboard shortcuts -----
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key.toLowerCase()) {
                    case "s":
                        e.preventDefault();
                        action("save");
                        break;
                    case "n":
                        if (!e.shiftKey) {
                            e.preventDefault();
                            action("new-document");
                        }
                        break;
                    case "o":
                        e.preventDefault();
                        action("open-project");
                        break;
                    case "f":
                        e.preventDefault();
                        action("find");
                        break;
                    case "b":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("toggle-binder");
                        }
                        // Plain Ctrl+B is handled natively by Tiptap.
                        break;
                    case "i":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("toggle-inspector");
                        }
                        // Plain Ctrl+I is handled natively by Tiptap.
                        break;
                    case "d":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("duplicate");
                        }
                        break;
                }
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [action]);

    // ----- Resizers -----
    const startResize = (which: "binder" | "inspector") => (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX;
        const startW = which === "binder" ? binderWidth : inspectorWidth;
        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const next = which === "binder" ? startW + delta : startW - delta;
            const clamped = Math.max(140, Math.min(560, next));
            if (which === "binder") setBinderWidth(clamped);
            else setInspectorWidth(clamped);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
            localStorage.setItem(
                which === "binder" ? BINDER_KEY : INSPECTOR_KEY,
                String(which === "binder" ? binderWidth : inspectorWidth),
            );
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    };

    useEffect(() => {
        localStorage.setItem(BINDER_KEY, String(binderWidth));
    }, [binderWidth]);
    useEffect(() => {
        localStorage.setItem(INSPECTOR_KEY, String(inspectorWidth));
    }, [inspectorWidth]);

    // ----- Menus -----
    const hasEditor = selectedId !== null && (selectedKind === "document" || selectedKind === "research");
    const selected = binder.find((d) => d.id === selectedId) ?? null;
    const inTrash = selected?.in_trash ?? false;
    const isRootSel = selected ? isRootKind(selected.kind) : false;

    const disabledActions = useMemo(() => {
        const s = new Set<MenuAction>();
        if (!hasEditor) {
            for (const a of ["undo", "redo", "cut", "copy", "paste", "select-all"] as MenuAction[]) {
                s.add(a);
            }
        }
        if (!selectedId || isRootSel || !inTrash) s.add("restore");
        if (!selectedId || isRootSel || inTrash) s.add("move-to-trash");
        if (!selectedId || isRootSel) s.add("delete-permanently");
        if (!selectedId || isRootSel) s.add("duplicate");
        if (!selectedId || isRootSel) s.add("rename");
        return s;
    }, [hasEditor, selectedId, isRootSel, inTrash]);

    const menus: MenuDef[] = useMemo(
        () => [
            {
                label: "File",
                items: [
                    { label: "New Project", action: "new-project" },
                    { label: "New Document", action: "new-document", shortcut: "Ctrl+N" },
                    { label: "New Folder", action: "new-folder" },
                    { separator: true, label: "" },
                    { label: "Open Project…", action: "open-project", shortcut: "Ctrl+O" },
                    { separator: true, label: "" },
                    { label: "Save", action: "save", shortcut: "Ctrl+S" },
                    { label: "Save As…", action: "save-as" },
                    { separator: true, label: "" },
                    { label: "Close Project", action: "close-project" },
                    { label: "Exit", action: "exit", shortcut: "Alt+F4" },
                ],
            },
            {
                label: "Edit",
                items: [
                    { label: "Undo", action: "undo", shortcut: "Ctrl+Z", disabled: !hasEditor },
                    { label: "Redo", action: "redo", shortcut: "Ctrl+Y", disabled: !hasEditor },
                    { separator: true, label: "" },
                    { label: "Cut", action: "cut", shortcut: "Ctrl+X", disabled: !hasEditor },
                    { label: "Copy", action: "copy", shortcut: "Ctrl+C", disabled: !hasEditor },
                    { label: "Paste", action: "paste", shortcut: "Ctrl+V", disabled: !hasEditor },
                    { label: "Select All", action: "select-all", shortcut: "Ctrl+A", disabled: !hasEditor },
                    { separator: true, label: "" },
                    { label: "Find…", action: "find", shortcut: "Ctrl+F" },
                    { label: "Search Project…", action: "search-project", shortcut: "Ctrl+Shift+F" },
                ],
            },
            {
                label: "View",
                items: [
                    { label: binderOpen ? "Hide Binder" : "Show Binder", action: "toggle-binder", shortcut: "Ctrl+Shift+B" },
                    { label: inspectorOpen ? "Hide Inspector" : "Show Inspector", action: "toggle-inspector", shortcut: "Ctrl+Shift+I" },
                    { separator: true, label: "" },
                    { label: "Zoom In", action: "zoom-in", shortcut: "Ctrl+=" },
                    { label: "Zoom Out", action: "zoom-out", shortcut: "Ctrl+-" },
                    { label: "Reset Zoom", action: "zoom-reset" },
                    { separator: true, label: "" },
                    { label: "Reset Layout", action: "reset-layout" },
                ],
            },
            {
                label: "Documents",
                items: [
                    { label: "New Document", action: "new-document", shortcut: "Ctrl+N" },
                    { label: "New Folder", action: "new-folder" },
                    { separator: true, label: "" },
                    { label: "Rename", action: "rename", disabled: disabledActions.has("rename") },
                    { label: "Duplicate", action: "duplicate", shortcut: "Ctrl+Shift+D", disabled: disabledActions.has("duplicate") },
                    { separator: true, label: "" },
                    { label: "Move to Trash", action: "move-to-trash", disabled: disabledActions.has("move-to-trash") },
                    { label: "Restore", action: "restore", disabled: disabledActions.has("restore") },
                    { label: "Delete Permanently", action: "delete-permanently", disabled: disabledActions.has("delete-permanently") },
                ],
            },
            {
                label: "Tools",
                items: [
                    { label: "Search Project…", action: "project-search", shortcut: "Ctrl+Shift+F" },
                    { label: "Word Count", action: "word-count" },
                    { label: "Project Statistics", action: "project-stats" },
                ],
            },
            {
                label: "Window",
                items: [{ label: "Reset Layout", action: "reset-layout" }],
            },
            {
                label: "Help",
                items: [
                    { label: "Keyboard Shortcuts", action: "shortcuts" },
                    { label: "About ScribeForge", action: "about" },
                ],
            },
        ],
        [binderOpen, inspectorOpen, hasEditor, disabledActions],
    );

    // ----- Search -----
    async function runSearch(q: string) {
        if (!q.trim()) {
            setSearchHits([]);
            return;
        }
        try {
            const hits = await api.searchProject(q);
            setSearchHits(hits);
        } catch (e) {
            setError(String(e));
        }
    }

    // ----- Render -----
    if (!project) {
        return (
            <div className="ws-loading">
                {error ? <div className="ws-error">{error}</div> : <div>Loading project…</div>}
            </div>
        );
    }

    return (
        <div className="ws-root">
            <MenuBar menus={menus} onAction={action} />
            <Toolbar onAction={action} disabledActions={disabledActions} />

            <div className="ws-body" style={{ fontSize: `${zoom}em` }}>
                {binderOpen && (
                    <>
                        <div style={{ width: `${binderWidth}px`, flexShrink: 0, height: "100%", display: "flex" }}>
                            <Binder
                                binder={binder}
                                selectedId={selectedId}
                                expanded={expanded}
                                onSelect={selectDoc}
                                onToggle={toggleExpand}
                                onRefresh={refresh}
                                onError={setError}
                            />
                        </div>
                        <div className="binder-resizer" onMouseDown={startResize("binder")} />
                    </>
                )}

                <SplitEditor
                    binder={binder}
                    selectedId={selectedId}
                    onSelect={(id, kind) => {
                        setSelectedId(id);
                        setSelectedKind(kind);
                    }}
                    onContentChanged={handleContentChanged}
                    onTitleChanged={handleTitleChanged}
                    onRefresh={refresh}
                    onError={setError}
                    registerEditorApi={registerEditorApi}
                    onPaneFocused={onPaneFocused}
                />

                {inspectorOpen && (
                    <>
                        <div className="inspector-resizer" onMouseDown={startResize("inspector")} />
                        <div style={{ width: `${inspectorWidth}px`, flexShrink: 0, height: "100%", display: "flex" }}>
                            <Inspector
                                documentId={selectedId}
                                meta={selected}
                                onError={setError}
                                onMetaChanged={refresh}
                            />
                        </div>
                    </>
                )}
            </div>

            {/* Status bar */}
            <div className="status-bar">
                {error && <span className="status-message status-error">{error}</span>}
                {!error && status && <span className="status-message">{status}</span>}
                {!error && !status && selected && (
                    <span className="status-message">
                        {selected.word_count.toLocaleString()} words — {selected.title}
                    </span>
                )}
                {!error && !status && !selected && (
                    <span className="status-message">
                        {project.word_count.toLocaleString()} words in manuscript · {binder.length} items
                    </span>
                )}
                {project.dirty && <span className="status-dirty">● Unsaved changes</span>}
                <span>{project.path}</span>
            </div>

            {/* Search overlay */}
            {searchOpen && (
                <SearchOverlay
                    query={searchQuery}
                    onQuery={(q) => {
                        setSearchQuery(q);
                        runSearch(q);
                    }}
                    hits={searchHits}
                    onClose={() => setSearchOpen(false)}
                    onOpen={(id) => {
                        setSearchOpen(false);
                        selectDoc(id, "document");
                    }}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Search overlay
// ---------------------------------------------------------------------------

function SearchOverlay({
    query,
    onQuery,
    hits,
    onClose,
    onOpen,
}: {
    query: string;
    onQuery: (q: string) => void;
    hits: SearchHitDto[];
    onClose: () => void;
    onOpen: (id: string) => void;
}) {
    return (
        <div className="overlay-root" onClick={onClose}>
            <div className="dialog" style={{ minWidth: 520 }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconSearch size={18} />
                    <span className="dialog-title">Search Project</span>
                </div>
                <div className="dialog-body">
                    <input
                        type="text"
                        autoFocus
                        placeholder="Search titles, content, synopsis, notes…"
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        style={{ marginBottom: 12 }}
                    />
                    <div className="search-results">
                        {hits.length === 0 && query.trim() && (
                            <div className="recent-empty">No results.</div>
                        )}
                        {hits.map((hit) => (
                            <div
                                key={hit.document_id + hit.field}
                                className="search-result"
                                onClick={() => onOpen(hit.document_id)}
                            >
                                <div className="search-result-title">
                                    {hit.title}
                                    <span className="search-result-field">{hit.field}</span>
                                </div>
                                {hit.excerpt && (
                                    <div className="search-result-excerpt">{hit.excerpt}</div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
                <div className="dialog-footer">
                    <button onClick={onClose}>Close</button>
                </div>
            </div>
        </div>
    );
}
