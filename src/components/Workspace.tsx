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
/// - Project-wide search overlay, and find and replace with a preview.
/// - Writing tools: project/session targets with progress in the status
///   bar, writing statistics, snapshots, spelling, comments and typewriter
///   mode.
/// - Organisation: coloured labels and statuses (shared via context), wiki
///   links between documents, character/place sheets and the timeline.
/// - A dirty-state indicator in the status bar.
/// - Several computers (synced folder): a poll tells other computers this
///   one has the project open and notices versions saved elsewhere, which
///   are reloaded or combined in the conflict dialog; a read-only mode when
///   another computer has the project open; where the project lives in the
///   status bar; this computer's backups.
///
/// When text changes outside the editors (find and replace, restoring a
/// snapshot), pending edits are saved first and `reloadToken` is bumped so
/// every pane reloads what it shows.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    api,
    isExternalChange,
    type ConflictCopy,
    type CurrentProjectDto,
    type SyncStatus,
    type DocumentMetaDto,
    type RichDoc,
    type SearchHitDto,
    type WritingGoalsDto,
} from "../services/api";
import { usePreferences } from "../services/preferences";
import { CompileDialog } from "../dialogs/CompileDialog";
import { FindReplaceDialog } from "../dialogs/FindReplaceDialog";
import { PreferencesDialog } from "../dialogs/PreferencesDialog";
import { SpellingDialog } from "../dialogs/SpellingDialog";
import { StatsDialog } from "../dialogs/StatsDialog";
import { WritingGoalsDialog } from "../dialogs/WritingGoalsDialog";
import {
    BackupsDialog,
    ConflictCopiesDialog,
    SyncConflictDialog,
    deviceLabel,
    providerFolderLabel,
} from "../dialogs/SyncDialogs";
import { ProgressBar } from "./ProgressBar";
import { resetSpellcheck } from "./Spellcheck";
import { LabelsDialog } from "../dialogs/LabelsDialog";
import { OrganizationProvider } from "../services/organization";
import { createSheet } from "./sheetTemplates";
import { TimelineView } from "./TimelineView";
import { setLinkFollower, setLinkTargets } from "./WikiLinks";
import { Binder } from "./Binder";
import { Composition } from "./Composition";
import { Inspector } from "./Inspector";
import { MenuBar, type MenuAction, type MenuDef } from "./MenuBar";
import { SplitEditor } from "./SplitEditor";
import { Toolbar } from "./Toolbar";
import type { EditorApi } from "./RichTextEditor";
import { IconSearch } from "./Icons";
import "../styles/workspace.css";
import { getLanguage, t, tn } from "../i18n";

interface Props {
    /** "import" opens the Scrivener import dialog there. */
    onBackToTemplates: (intent?: "import") => void;
}

const BINDER_KEY = "sf.binder.width";
const INSPECTOR_KEY = "sf.inspector.width";
const INSPECTOR_OPEN_KEY = "sf.inspector.open";
const BINDER_OPEN_KEY = "sf.binder.open";

const BINDER_DEFAULT_WIDTH = 240;
const INSPECTOR_DEFAULT_WIDTH = 300;
const PANEL_MIN_WIDTH = 160;
const PANEL_MAX_WIDTH = 900;
const EDITOR_MIN_WIDTH = 320;
/** How often to look for versions saved on another computer. */
const SYNC_POLL_MS = 10_000;

function loadWidth(key: string, def: number): number {
    const v = localStorage.getItem(key);
    if (!v) return def;
    const n = parseInt(v, 10);
    return Number.isFinite(n) && n >= PANEL_MIN_WIDTH && n <= PANEL_MAX_WIDTH ? n : def;
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
    const [compileOpen, setCompileOpen] = useState(false);
    const [prefsOpen, setPrefsOpen] = useState(false);
    const [compositionOpen, setCompositionOpen] = useState(false);
    const [goalsOpen, setGoalsOpen] = useState(false);
    const [statsOpen, setStatsOpen] = useState(false);
    const [findOpen, setFindOpen] = useState(false);
    const [spellingOpen, setSpellingOpen] = useState(false);
    const [goals, setGoals] = useState<WritingGoalsDto | null>(null);
    const [timelineOpen, setTimelineOpen] = useState(false);
    const [labelsOpen, setLabelsOpen] = useState(false);
    const [reloadToken, setReloadToken] = useState(0);
    const { prefs, save: savePrefs } = usePreferences();

    // Several computers.
    const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
    /** Name of another computer that has the project open ("" unnamed). */
    const [openElsewhere, setOpenElsewhere] = useState<string | null>(null);
    /** A newer version waits to be reloaded (automatic reload is off). */
    const [newVersionFrom, setNewVersionFrom] = useState<string | null>(null);
    /** Conflict dialog: the version on disk, or a conflict copy; `then`
     *  continues what the conflict interrupted (closing, quitting). */
    const [conflict, setConflict] = useState<null | { copy?: ConflictCopy; then?: () => void }>(null);
    const [conflictCopies, setConflictCopies] = useState<ConflictCopy[]>([]);
    const [backupsOpen, setBackupsOpen] = useState(false);
    /** True while a version from another computer is being handled. */
    const syncBusy = useRef(false);
    const readOnly = syncStatus?.read_only ?? false;

    // Panel state.
    const [binderOpen, setBinderOpen] = useState(() => localStorage.getItem(BINDER_OPEN_KEY) !== "0");
    const [inspectorOpen, setInspectorOpen] = useState(() => localStorage.getItem(INSPECTOR_OPEN_KEY) !== "0");
    const [binderWidth, setBinderWidth] = useState(() => loadWidth(BINDER_KEY, BINDER_DEFAULT_WIDTH));
    const [inspectorWidth, setInspectorWidth] = useState(() => loadWidth(INSPECTOR_KEY, INSPECTOR_DEFAULT_WIDTH));
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

    // Content saves still on their way to the backend.
    const pendingSavesRef = useRef<Set<Promise<unknown>>>(new Set());

    /** Push every editor's pending edits and wait until they are stored. */
    const flushEditors = useCallback(async () => {
        editorApisRef.current.forEach((ed) => ed.flush());
        await Promise.allSettled([...pendingSavesRef.current]);
    }, []);

    // ----- Writing goals (status bar) -----
    const refreshGoals = useCallback(() => {
        api.getWritingGoals()
            .then(setGoals)
            .catch(() => undefined);
    }, []);
    const goalsTimer = useRef<number | null>(null);
    const scheduleGoals = useCallback(() => {
        if (goalsTimer.current !== null) return;
        goalsTimer.current = window.setTimeout(() => {
            goalsTimer.current = null;
            refreshGoals();
        }, 1500);
    }, [refreshGoals]);

    // Text changed outside the editors: reload panes, inspector, binder.
    const textReplaced = useCallback(() => {
        setReloadToken((t) => t + 1);
        refreshGoals();
    }, [refreshGoals]);

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

    const refreshSyncStatus = useCallback(() => {
        api.getSyncStatus()
            .then(setSyncStatus)
            .catch(() => undefined);
    }, []);

    useEffect(() => {
        refresh();
        refreshGoals();
        refreshSyncStatus();
        api.getSpelling()
            .then((s) => resetSpellcheck(s.language !== "off"))
            .catch(() => undefined);
        // Copies a cloud client made of this project, offered for combining.
        api.listConflictCopies()
            .then(setConflictCopies)
            .catch(() => undefined);
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

    // ----- Wiki links: targets follow the binder; Ctrl+click opens them -----
    useEffect(() => {
        setLinkTargets(
            binder
                .filter((d) => !d.in_trash && !isRootKind(d.kind))
                .map((d) => ({ id: d.id, title: d.title, kind: d.kind, sheet: d.sheet_kind })),
        );
    }, [binder]);

    useEffect(() => {
        setLinkFollower(async (title, target) => {
            if (target) {
                selectDoc(target.id, target.kind);
                return;
            }
            const research = binder.find((d) => d.kind === "research_root");
            if (!research || !confirm(t("No document is called “{title}”. Create it in Research?", { title }))) return;
            try {
                const meta = await api.createDocument(research.id, "research", title);
                await refresh();
                selectDoc(meta.id, meta.kind);
            } catch (e) {
                setError(String(e));
            }
        });
        return () => setLinkFollower(null);
    }, [binder, selectDoc, refresh]);

    // ----- Content updates from the editor (debounced inside RichTextEditor) -----
    const handleContentChanged = useCallback(async (id: string, rich: RichDoc, words: number) => {
        // Optimistic word-count update for the binder row.
        setBinder((prev) => prev.map((m) => (m.id === id ? { ...m, word_count: words } : m)));
        const saving = api.updateDocument({ id, content: rich });
        pendingSavesRef.current.add(saving);
        try {
            await saving;
            scheduleGoals();
        } catch (e) {
            setError(String(e));
        } finally {
            pendingSavesRef.current.delete(saving);
        }
    }, [scheduleGoals]);

    const handleTitleChanged = useCallback(async (id: string, title: string) => {
        setBinder((prev) => prev.map((m) => (m.id === id ? { ...m, title } : m)));
        try {
            await api.updateDocument({ id, title });
        } catch (e) {
            setError(String(e));
        }
    }, []);

    // ----- Versions saved on another computer -----

    /** Take the version on disk (nothing unsaved here). */
    const reloadFromOtherComputer = useCallback(
        async (device: string) => {
            const { changed } = await api.reloadFromDisk();
            setNewVersionFrom(null);
            await refresh();
            textReplaced();
            const shown = changed.slice(0, 3).join(", ") + (changed.length > 3 ? "…" : "");
            setStatus(
                changed.length
                    ? t("Updated with changes from {device} ({titles})", { device: deviceLabel(device), titles: shown })
                    : t("Updated from {device}", { device: deviceLabel(device) }),
            );
        },
        [refresh, textReplaced],
    );

    /** Another computer saved the project: reload it when nothing here is
     *  unsaved, otherwise combine both in the conflict dialog. `then` runs
     *  once the versions agree again. */
    const handleExternalChange = useCallback(
        async (then?: () => void) => {
            if (syncBusy.current) return;
            syncBusy.current = true;
            try {
                await flushEditors();
                const [dirty, poll] = await Promise.all([api.isProjectDirty(), api.syncPoll()]);
                if (dirty) {
                    // Stays busy until the conflict dialog closes.
                    setConflict({ then });
                    return;
                }
                if (then || readOnly || (prefs?.sync.auto_reload ?? true)) {
                    await reloadFromOtherComputer(poll.saved_by);
                    then?.();
                } else {
                    setNewVersionFrom(poll.saved_by);
                }
                syncBusy.current = false;
            } catch (e) {
                syncBusy.current = false;
                setError(String(e));
            }
        },
        [flushEditors, readOnly, prefs, reloadFromOtherComputer],
    );

    // Tell other computers this one still has the project open, and notice
    // versions they saved.
    useEffect(() => {
        const id = window.setInterval(async () => {
            if (syncBusy.current) return;
            try {
                const poll = await api.syncPoll();
                setOpenElsewhere(poll.open_elsewhere);
                if (poll.external_change) await handleExternalChange();
            } catch {
                // A folder that is briefly unavailable; try again next time.
            }
        }, SYNC_POLL_MS);
        return () => window.clearInterval(id);
    }, [handleExternalChange]);

    const conflictDone = useCallback(
        async (applied: boolean) => {
            const done = conflict;
            setConflict(null);
            syncBusy.current = false;
            if (!applied || !done) return;
            await refresh();
            textReplaced();
            setProject((p) => (p ? { ...p, dirty: false } : p));
            setStatus(t("Combined the changes from both versions."));
            if (done.copy) {
                const copy = done.copy;
                setConflictCopies((list) => list.filter((c) => c.path !== copy.path));
                if (confirm(t("Move the copy “{name}” to the recycle bin?", { name: copy.file_name }))) {
                    api.trashConflictCopy(copy.path).catch((e) => setError(String(e)));
                }
            }
            done.then?.();
        },
        [conflict, refresh, textReplaced],
    );

    /** Save and close the project here, then `after`. If another computer
     *  saved it meanwhile, combine both versions first. */
    const closeThen = useCallback(
        async (after: () => void | Promise<void>) => {
            await flushEditors();
            try {
                await api.closeProject();
            } catch (e) {
                if (isExternalChange(e)) {
                    syncBusy.current = true;
                    setConflict({ then: () => closeThen(after) });
                } else {
                    setError(String(e));
                }
                return;
            }
            await after();
        },
        [flushEditors],
    );

    const takeOver = useCallback(async () => {
        try {
            await api.syncTakeOver();
            refreshSyncStatus();
            setStatus(t("You can edit the project on this computer."));
        } catch (e) {
            setError(String(e));
        }
    }, [refreshSyncStatus]);

    // ----- Manual save -----
    const save = useCallback(async () => {
        try {
            // Flush every open editor's pending edits before writing the file.
            editorApisRef.current.forEach((ed) => ed.flush());
            await api.saveCurrentProject();
            setStatus(t("Project saved"));
            setProject((p) => (p ? { ...p, dirty: false } : p));
        } catch (e) {
            if (isExternalChange(e)) handleExternalChange();
            else setError(String(e));
        }
    }, [handleExternalChange]);

    // ----- Autosave loop (interval from the preferences; 30s by default) -----
    const autosaveOn = prefs?.saving.autosave ?? true;
    const autosaveSecs = prefs?.saving.autosave_interval_secs ?? 30;
    useEffect(() => {
        if (!autosaveOn) return;
        const id = window.setInterval(async () => {
            try {
                const wrote = await api.autosaveProject();
                if (wrote) {
                    setStatus(t("Autosaved"));
                    setProject((p) => (p ? { ...p, dirty: false } : p));
                }
            } catch (e) {
                if (isExternalChange(e)) handleExternalChange();
                else setError(String(e));
            }
        }, Math.max(5, autosaveSecs) * 1000);
        return () => window.clearInterval(id);
    }, [autosaveOn, autosaveSecs, handleExternalChange]);

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
            setError(t("No suitable parent folder. Select a folder first."));
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
                    case "open-project":
                        await closeThen(() => onBackToTemplates());
                        return;
                    case "import-scrivener":
                        await closeThen(() => onBackToTemplates("import"));
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
                        const name = project ? `${project.name} (${t("copy")}).scri` : `${t("Project")}.scri`;
                        const path = await api.pickSaveFile(t("Save Project As"), name);
                        if (path) {
                            await api.saveProjectAs(path);
                            setStatus(t("Saved as new project"));
                            await refresh();
                        }
                        return;
                    }
                    case "compile":
                        // Pending edits must reach the backend before compiling.
                        editorApisRef.current.forEach((ed) => ed.flush());
                        setCompileOpen(true);
                        return;
                    case "preferences":
                        setPrefsOpen(true);
                        return;
                    case "composition-mode":
                        if (readOnly && !compositionOpen) {
                            setStatus(t("The project is open read-only."));
                        } else if (compositionOpen) {
                            setCompositionOpen(false);
                        } else if (selectedId) {
                            setCompositionOpen(true);
                        } else {
                            setStatus(t("Select a document (or folder) to write in composition mode."));
                        }
                        return;
                    case "close-project":
                        await closeThen(onBackToTemplates);
                        return;
                    case "exit":
                        await closeThen(() => api.quitApp());
                        return;
                    case "backups":
                        await flushEditors();
                        setBackupsOpen(true);
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
                    case "find-replace":
                    case "replace":
                        await flushEditors();
                        setFindOpen(true);
                        return;
                    case "add-comment": {
                        const editor = editorApisRef.current.get(focusedPaneRef.current);
                        if (!editor || !editor.addComment()) {
                            setStatus(t("Select some text in the Text view to comment on it."));
                        }
                        return;
                    }
                    case "join-lines": {
                        const editor = editorApisRef.current.get(focusedPaneRef.current);
                        if (!editor) {
                            setStatus(t("Open a document in the Text view first."));
                            return;
                        }
                        const n = editor.joinBrokenLines();
                        setStatus(
                            n > 0
                                ? tn(n, "Joined {n} broken line into paragraphs.", "Joined {n} broken lines into paragraphs.")
                                : t("No lines cut at a fixed width were found."),
                        );
                        return;
                    }
                    case "take-snapshot": {
                        const sel = binder.find((d) => d.id === selectedId);
                        if (!sel || isFolderKind(sel.kind)) {
                            setStatus(t("Select a document to take a snapshot of it."));
                            return;
                        }
                        await flushEditors();
                        await api.createSnapshot(sel.id, "");
                        setStatus(t("Snapshot of “{title}” taken. See the Inspector's Snapshots tab.", { title: sel.title }));
                        setReloadToken((t) => t + 1);
                        return;
                    }
                    case "project-targets":
                        await flushEditors();
                        setGoalsOpen(true);
                        return;
                    case "writing-stats":
                        await flushEditors();
                        setStatsOpen(true);
                        return;
                    case "spelling":
                        setSpellingOpen(true);
                        return;
                    case "labels-status":
                        setLabelsOpen(true);
                        return;
                    case "timeline":
                        await flushEditors();
                        setTimelineOpen(true);
                        return;
                    case "new-character-sheet":
                    case "new-place-sheet": {
                        const research = binder.find((d) => d.kind === "research_root");
                        if (!research) return;
                        const id = await createSheet(binder, research.id, a === "new-character-sheet" ? "character" : "place");
                        setExpanded((prev) => new Set(prev).add(research.id));
                        await refresh();
                        selectDoc(id, "research");
                        return;
                    }
                    case "toggle-typewriter":
                        if (prefs) {
                            const on = !prefs.editor.typewriter_mode;
                            await savePrefs({ ...prefs, editor: { ...prefs.editor, typewriter_mode: on } });
                            setStatus(on ? t("Typewriter mode on") : t("Typewriter mode off"));
                        }
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
                        setStatus(t("Double-click the document title (or a binder row) to rename."));
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
                        if (selectedId && confirm(t("Delete permanently? This cannot be undone."))) {
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
                        setStatus(t("ScribeForge 0.1.0 — a desktop writing application."));
                        return;
                    case "shortcuts":
                        setStatus(
                            t(
                                "Ctrl+S save · Ctrl+N new doc · Ctrl+F find · Ctrl+B/I/U format · Ctrl+Shift+B/I panels · Ctrl+Shift+P compile · F11 composition · Ctrl+, preferences.",
                            ),
                        );
                        return;
                    case "reset-layout":
                        localStorage.removeItem(BINDER_KEY);
                        localStorage.removeItem(INSPECTOR_KEY);
                        setBinderWidth(BINDER_DEFAULT_WIDTH);
                        setInspectorWidth(INSPECTOR_DEFAULT_WIDTH);
                        return;
                    case "word-count":
                    case "project-stats":
                        setStatus(
                            t("{words} words in manuscript · {items} items in binder.", {
                                words: (project?.word_count ?? 0).toLocaleString(getLanguage()),
                                items: binder.length,
                            }),
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
        [selectedId, project, binder, save, compositionOpen, prefs, savePrefs, flushEditors, closeThen, readOnly],
    );

    // ----- Keyboard shortcuts -----
    useEffect(() => {
        function onKey(e: KeyboardEvent) {
            if (e.key === "F11" && !compositionOpen) {
                e.preventDefault();
                action("composition-mode");
                return;
            }
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
                    case "h":
                        e.preventDefault();
                        action("find-replace");
                        break;
                    case "5":
                        e.preventDefault();
                        action("take-snapshot");
                        break;
                    case "m":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("add-comment");
                        }
                        break;
                    case "t":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("toggle-typewriter");
                        }
                        break;
                    case "l":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("timeline");
                        }
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
                    case "p":
                        if (e.shiftKey) {
                            e.preventDefault();
                            action("compile");
                        }
                        break;
                    case ",":
                        e.preventDefault();
                        action("preferences");
                        break;
                }
            }
        }
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [action, compositionOpen]);

    // ----- Resizers -----
    // Dragging a resizer widens one side panel and narrows the editor; the
    // editor always keeps EDITOR_MIN_WIDTH. Double-click restores the default.
    const startResize = (which: "binder" | "inspector") => (e: React.MouseEvent) => {
        e.preventDefault();
        const handle = e.currentTarget as HTMLElement;
        const startX = e.clientX;
        const startW = which === "binder" ? binderWidth : inspectorWidth;
        const other = which === "binder" ? (inspectorOpen ? inspectorWidth : 0) : binderOpen ? binderWidth : 0;
        const max = Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, window.innerWidth - other - EDITOR_MIN_WIDTH));
        handle.classList.add("active");
        document.body.classList.add("col-resizing");
        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const next = which === "binder" ? startW + delta : startW - delta;
            const clamped = Math.max(PANEL_MIN_WIDTH, Math.min(max, next));
            if (which === "binder") setBinderWidth(clamped);
            else setInspectorWidth(clamped);
        };
        const onUp = () => {
            handle.classList.remove("active");
            document.body.classList.remove("col-resizing");
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
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
        if (!selectedId || inTrash) s.add("composition-mode");
        if (!selected || isFolderKind(selected.kind)) s.add("take-snapshot");
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
                    { label: "Import from Scrivener…", action: "import-scrivener" },
                    { separator: true, label: "" },
                    { label: "Save", action: "save", shortcut: "Ctrl+S" },
                    { label: "Save As…", action: "save-as" },
                    { label: "Backups…", action: "backups" },
                    { separator: true, label: "" },
                    { label: "Compile…", action: "compile", shortcut: "Ctrl+Shift+P" },
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
                    { label: "Find and Replace…", action: "find-replace", shortcut: "Ctrl+H" },
                    { label: "Search Project…", action: "search-project", shortcut: "Ctrl+Shift+F" },
                    { separator: true, label: "" },
                    { label: "Add Comment", action: "add-comment", shortcut: "Ctrl+Shift+M", disabled: !hasEditor },
                    { label: "Join Broken Lines", action: "join-lines", disabled: !hasEditor },
                ],
            },
            {
                label: "View",
                items: [
                    { label: binderOpen ? "Hide Binder" : "Show Binder", action: "toggle-binder", shortcut: "Ctrl+Shift+B" },
                    { label: inspectorOpen ? "Hide Inspector" : "Show Inspector", action: "toggle-inspector", shortcut: "Ctrl+Shift+I" },
                    { separator: true, label: "" },
                    { label: "Composition Mode", action: "composition-mode", shortcut: "F11", disabled: disabledActions.has("composition-mode") },
                    {
                        label: prefs?.editor.typewriter_mode ? "✓ Typewriter Mode" : "Typewriter Mode",
                        action: "toggle-typewriter",
                        shortcut: "Ctrl+Shift+T",
                    },
                    { label: "Timeline", action: "timeline", shortcut: "Ctrl+Shift+L" },
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
                    { label: "Take Snapshot", action: "take-snapshot", shortcut: "Ctrl+5", disabled: disabledActions.has("take-snapshot") },
                    { separator: true, label: "" },
                    { label: "New Character Sheet", action: "new-character-sheet" },
                    { label: "New Place Sheet", action: "new-place-sheet" },
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
                    { label: "Find and Replace…", action: "find-replace", shortcut: "Ctrl+H" },
                    { separator: true, label: "" },
                    { label: "Project Targets…", action: "project-targets" },
                    { label: "Writing Statistics…", action: "writing-stats" },
                    { label: "Spelling…", action: "spelling" },
                    { label: "Labels and Status…", action: "labels-status" },
                    { label: "Timeline", action: "timeline", shortcut: "Ctrl+Shift+L" },
                    { separator: true, label: "" },
                    { label: "Word Count", action: "word-count" },
                    { label: "Project Statistics", action: "project-stats" },
                    { separator: true, label: "" },
                    { label: "Preferences…", action: "preferences", shortcut: "Ctrl+," },
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
        [binderOpen, inspectorOpen, hasEditor, disabledActions, prefs],
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
                {error ? <div className="ws-error">{error}</div> : <div>{t("Loading project…")}</div>}
            </div>
        );
    }

    return (
        <OrganizationProvider onError={setError} onSaved={refresh}>
        <div className="ws-root">
            <MenuBar menus={menus} onAction={action} />
            <Toolbar onAction={action} disabledActions={disabledActions} />

            {readOnly && (
                <div className="sync-banner">
                    <strong>{t("Read-only")}</strong>
                    <span>
                        {openElsewhere !== null
                            ? t("This project is open on {device}. Changes saved there appear here.", {
                                  device: deviceLabel(openElsewhere),
                              })
                            : t("Opened read-only. Changes saved on the other computer appear here.")}
                    </span>
                    <span className="spacer" />
                    <button onClick={takeOver}>{t("Edit anyway")}</button>
                </div>
            )}
            {!readOnly && newVersionFrom !== null && (
                <div className="sync-banner">
                    <span>
                        {t("{device} saved a newer version of this project.", { device: deviceLabel(newVersionFrom) })}
                    </span>
                    <span className="spacer" />
                    <button onClick={() => reloadFromOtherComputer(newVersionFrom).catch((e) => setError(String(e)))}>
                        {t("Reload")}
                    </button>
                </div>
            )}

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
                        <div
                            className="binder-resizer"
                            title={t("Drag to resize · double-click to restore")}
                            onMouseDown={startResize("binder")}
                            onDoubleClick={() => setBinderWidth(BINDER_DEFAULT_WIDTH)}
                        />
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
                    suspended={compositionOpen}
                    readOnly={readOnly}
                    reloadToken={reloadToken}
                    toolbarExtra={
                        <button
                            className={`split-tb-btn${prefs?.editor.typewriter_mode ? " active" : ""}`}
                            title={t("Typewriter mode: keep the current line in the middle (Ctrl+Shift+T)")}
                            aria-pressed={!!prefs?.editor.typewriter_mode}
                            onClick={() => action("toggle-typewriter")}
                        >
                            {t("Typewriter")}
                        </button>
                    }
                />

                {inspectorOpen && (
                    <>
                        <div
                            className="inspector-resizer"
                            title={t("Drag to resize · double-click to restore")}
                            onMouseDown={startResize("inspector")}
                            onDoubleClick={() => setInspectorWidth(INSPECTOR_DEFAULT_WIDTH)}
                        />
                        <div style={{ width: `${inspectorWidth}px`, flexShrink: 0, height: "100%", display: "flex" }}>
                            <Inspector
                                documentId={selectedId}
                                meta={selected}
                                onError={setError}
                                onMetaChanged={refresh}
                                reloadToken={reloadToken}
                                flushEditors={flushEditors}
                                onDocumentRestored={async () => {
                                    await refresh();
                                    textReplaced();
                                    setStatus(t("Snapshot restored. The previous text was kept as a snapshot."));
                                }}
                                onOpenDocument={(id) => {
                                    const kind = binder.find((d) => d.id === id)?.kind ?? "document";
                                    selectDoc(id, kind);
                                }}
                                binder={binder}
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
                        {t("{n} words — {title}", { n: selected.word_count.toLocaleString(getLanguage()), title: selected.title })}
                    </span>
                )}
                {!error && !status && !selected && (
                    <span className="status-message">
                        {t("{words} words in manuscript · {items} items", {
                            words: project.word_count.toLocaleString(getLanguage()),
                            items: binder.length,
                        })}
                    </span>
                )}
                {goals && (goals.session_goal > 0 || goals.session_added > 0) && (
                    <button
                        type="button"
                        className="status-goal"
                        title={
                            goals.session_goal
                                ? t("This session: {n} words written of {goal}. Click for project targets.", {
                                      n: goals.session_added.toLocaleString(getLanguage()),
                                      goal: goals.session_goal.toLocaleString(getLanguage()),
                                  })
                                : t("This session: {n} words written. Click for project targets.", {
                                      n: goals.session_added.toLocaleString(getLanguage()),
                                  })
                        }
                        onClick={() => action("project-targets")}
                    >
                        {t("Session {n}", { n: goals.session_added.toLocaleString(getLanguage()) })}
                        {goals.session_goal > 0 && ` / ${goals.session_goal.toLocaleString(getLanguage())}`}
                        {goals.session_goal > 0 && <ProgressBar size="sm" value={goals.session_added} goal={goals.session_goal} />}
                    </button>
                )}
                {goals && goals.project_goal > 0 && (
                    <button
                        type="button"
                        className="status-goal"
                        title={
                            goals.words_per_day !== null
                                ? t("{n} words a day to reach the goal by {deadline} ({days} days left)", {
                                      n: goals.words_per_day.toLocaleString(getLanguage()),
                                      deadline: goals.deadline ?? "",
                                      days: goals.days_left ?? 0,
                                  })
                                : t("Manuscript goal. Click for project targets.")
                        }
                        onClick={() => action("project-targets")}
                    >
                        {t("Manuscript {n} / {goal}", {
                            n: goals.manuscript_words.toLocaleString(getLanguage()),
                            goal: goals.project_goal.toLocaleString(getLanguage()),
                        })}
                        <ProgressBar size="sm" value={goals.manuscript_words} goal={goals.project_goal} />
                        {goals.words_per_day !== null && goals.words_per_day > 0 && (
                            <span className="status-goal-daily">
                                {t("{n}/day", { n: goals.words_per_day.toLocaleString(getLanguage()) })}
                            </span>
                        )}
                    </button>
                )}
                {project.dirty && <span className="status-dirty">● {t("Unsaved changes")}</span>}
                {openElsewhere !== null && !readOnly && (
                    <span className="status-sync-warn" title={t("Writing on both at once may mean choosing between versions later.")}>
                        ⚠ {t("Also open on {device}", { device: deviceLabel(openElsewhere) })}
                    </span>
                )}
                {syncStatus && (
                    <span
                        className="status-sync"
                        title={
                            syncStatus.provider
                                ? t("Your cloud app copies this folder to your other computers.")
                                : t("This folder is not synced: the project is only on this computer.")
                        }
                    >
                        {syncStatus.provider ? `☁ ${providerFolderLabel(syncStatus.provider)}` : `💻 ${t("Only on this computer")}`}
                    </span>
                )}
                <span>{project.path}</span>
            </div>

            {compositionOpen && selected && (
                <Composition
                    target={selected}
                    binder={binder}
                    onContentChanged={handleContentChanged}
                    registerEditorApi={registerEditorApi}
                    onExit={() => setCompositionOpen(false)}
                    onError={setError}
                />
            )}

            {compileOpen && (
                <CompileDialog
                    binder={binder}
                    projectName={project.name}
                    author={project.author}
                    onClose={() => setCompileOpen(false)}
                    onError={setError}
                    onCompiled={(path) => setStatus(t("Compiled to {path}", { path }))}
                />
            )}

            {goalsOpen && (
                <WritingGoalsDialog
                    onClose={() => setGoalsOpen(false)}
                    onError={setError}
                    onChanged={(g) => {
                        setGoals(g);
                        setProject((p) => (p ? { ...p, dirty: true } : p));
                    }}
                />
            )}

            {statsOpen && <StatsDialog onClose={() => setStatsOpen(false)} onError={setError} />}

            {spellingOpen && (
                <SpellingDialog
                    onClose={() => setSpellingOpen(false)}
                    onError={setError}
                    onChanged={(s) => {
                        resetSpellcheck(s.language !== "off");
                        setProject((p) => (p ? { ...p, dirty: true } : p));
                    }}
                />
            )}

            {findOpen && (
                <FindReplaceDialog
                    currentDocumentId={selected && !isFolderKind(selected.kind) ? selected.id : null}
                    currentDocumentTitle={selected && !isFolderKind(selected.kind) ? selected.title : null}
                    flushEditors={flushEditors}
                    onOpenDocument={(id) => {
                        const kind = binder.find((d) => d.id === id)?.kind ?? "document";
                        selectDoc(id, kind);
                    }}
                    onReplaced={async (count, docs) => {
                        await refresh();
                        textReplaced();
                        setStatus(
                            `${tn(count, "Replaced {n} match", "Replaced {n} matches")} ${tn(docs.length, "in {n} document.", "in {n} documents.")}`,
                        );
                    }}
                    onClose={() => setFindOpen(false)}
                    onError={setError}
                />
            )}

            {labelsOpen && <LabelsDialog onClose={() => setLabelsOpen(false)} />}

            {timelineOpen && (
                <TimelineView
                    binder={binder}
                    currentDocumentId={selectedId}
                    onOpenDocument={(id) => {
                        setTimelineOpen(false);
                        const kind = binder.find((d) => d.id === id)?.kind ?? "document";
                        selectDoc(id, kind);
                    }}
                    onClose={() => setTimelineOpen(false)}
                    onError={setError}
                />
            )}

            {conflict && (
                <SyncConflictDialog copyPath={conflict.copy?.path} onDone={conflictDone} onError={setError} />
            )}

            {!conflict && conflictCopies.length > 0 && (
                <ConflictCopiesDialog
                    copies={conflictCopies}
                    onReview={async (copy) => {
                        await flushEditors();
                        syncBusy.current = true;
                        setConflict({ copy });
                    }}
                    onIgnore={() => setConflictCopies([])}
                />
            )}

            {backupsOpen && (
                <BackupsDialog
                    onClose={() => setBackupsOpen(false)}
                    onError={setError}
                    onRestored={async () => {
                        setBackupsOpen(false);
                        await refresh();
                        textReplaced();
                        setStatus(t("Backup restored."));
                    }}
                />
            )}

            {prefsOpen && (
                <PreferencesDialog
                    onClose={() => setPrefsOpen(false)}
                    onError={setError}
                    onSaved={() => setStatus(t("Preferences saved"))}
                />
            )}

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
        </OrganizationProvider>
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
                    <span className="dialog-title">{t("Search Project")}</span>
                </div>
                <div className="dialog-body">
                    <input
                        type="text"
                        autoFocus
                        placeholder={t("Search titles, content, synopsis, notes…")}
                        value={query}
                        onChange={(e) => onQuery(e.target.value)}
                        style={{ marginBottom: 12 }}
                    />
                    <div className="search-results">
                        {hits.length === 0 && query.trim() && (
                            <div className="recent-empty">{t("No results.")}</div>
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
                    <button onClick={onClose}>{t("Close")}</button>
                </div>
            </div>
        </div>
    );
}
