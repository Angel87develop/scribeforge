/// Split editor: two `EditorPane`s side by side or stacked, with a draggable
/// divider between them.
///
/// State:
/// - `split`: "none" | "vertical" (side by side) | "horizontal" (stacked)
/// - `ratio`: 0..1 of the space the primary pane takes.
/// - `primaryId` / `secondaryId`: the document ids shown in each pane.
/// - `activePane`: "primary" | "secondary" — which pane currently has focus.
///   The workspace selection (binder highlight, inspector) always mirrors the
///   active pane's document, and picking a document in the binder opens it in
///   the active pane.
///   A pane becomes active only when the user clicks inside it.
///
/// A single `FormatBar` sits above both panes and drives the active pane.
///
/// All state is persisted in localStorage so a closed-and-reopened project
/// restores the layout. If a stored id is no longer in the binder, the pane
/// falls back to "empty" rather than crashing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DocumentMetaDto, RichDoc } from "../services/api";
import { EditorPane } from "./EditorPane";
import { FormatBar } from "./FormatBar";
import { ParagraphFormatDialog } from "./ParagraphFormatDialog";
import type { EditorApi, FormatState } from "./RichTextEditor";
import "../styles/split-editor.css";
import { t } from "../i18n";

const SPLIT_KEY = "sf.editor.split";
const SPLIT_RATIO_KEY = "sf.editor.ratio";
const SPLIT_SECONDARY_KEY = "sf.editor.secondary.id";

type Split = "none" | "vertical" | "horizontal";
type PaneKey = "primary" | "secondary";

function loadSplit(): Split {
    const v = localStorage.getItem(SPLIT_KEY);
    if (v === "vertical" || v === "horizontal") return v;
    return "none";
}

interface Props {
    binder: DocumentMetaDto[];
    /** Workspace selection (binder / inspector): opened in the active pane. */
    selectedId: string | null;
    /** Reports the active pane's document back to the workspace. */
    onSelect: (id: string | null, kind: string | null) => void;
    onContentChanged: (id: string, doc: RichDoc, wordCount: number) => void;
    onTitleChanged: (id: string, title: string) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
    /** Registers pane editor APIs with the workspace (for save-flush). */
    registerEditorApi?: (paneKey: string, api: EditorApi | null) => void;
    /** Tracks which pane last had focus (for clipboard actions). */
    onPaneFocused?: (paneKey: string) => void;
    /** Unmounts the panes (keeping the layout) while composition mode edits
     *  the same documents, so two editors never write one document. */
    suspended?: boolean;
    /** Bumped when document text changed outside the editors. */
    reloadToken?: number;
    /** Extra controls for the bar under the editor (typewriter toggle…). */
    toolbarExtra?: React.ReactNode;
}

export function SplitEditor({
    binder,
    selectedId,
    onSelect,
    onContentChanged,
    onTitleChanged,
    onRefresh,
    onError,
    registerEditorApi,
    onPaneFocused,
    suspended = false,
    reloadToken = 0,
    toolbarExtra,
}: Props) {
    const [split, setSplit] = useState<Split>(() => loadSplit());
    const [ratio, setRatio] = useState<number>(() => {
        const v = localStorage.getItem(SPLIT_RATIO_KEY);
        const n = v ? parseFloat(v) : 0.5;
        return Number.isFinite(n) && n > 0.1 && n < 0.9 ? n : 0.5;
    });
    const [secondaryId, setSecondaryId] = useState<string | null>(() => {
        const id = localStorage.getItem(SPLIT_SECONDARY_KEY);
        // Validate against binder when possible — but allow null if binder not
        // yet loaded. We'll re-validate below.
        return id;
    });
    const [primaryId, setPrimaryId] = useState<string | null>(selectedId);
    const [activePane, setActivePane] = useState<PaneKey>("primary");
    const dragging = useRef(false);

    // Latest values for the selection-sync effects below.
    const live = useRef({ split, activePane, primaryId, secondaryId, selectedId, binder, onSelect });
    live.current = { split, activePane, primaryId, secondaryId, selectedId, binder, onSelect };

    // Workspace selection changed (binder click, new document…): open it in
    // the active pane.
    useEffect(() => {
        const l = live.current;
        const pane: PaneKey = l.split === "none" ? "primary" : l.activePane;
        const current = pane === "primary" ? l.primaryId : l.secondaryId;
        if (selectedId === current) return;
        if (pane === "primary") setPrimaryId(selectedId);
        else setSecondaryId(selectedId);
    }, [selectedId]);

    // Active pane (or its document) changed: mirror it in the workspace
    // selection so the binder and inspector follow the pane being edited.
    useEffect(() => {
        const l = live.current;
        const pane: PaneKey = split === "none" ? "primary" : activePane;
        const id = pane === "primary" ? primaryId : secondaryId;
        if (id === l.selectedId) return;
        const kind = l.binder.find((d) => d.id === id)?.kind ?? null;
        l.onSelect(id, kind);
    }, [split, activePane, primaryId, secondaryId]);

    // Per-pane editor APIs and format state, so the shared format bar can
    // follow whichever pane is active.
    const [apis, setApis] = useState<Partial<Record<PaneKey, EditorApi>>>({});
    const apisRef = useRef(apis);
    apisRef.current = apis;
    const [formats, setFormats] = useState<Partial<Record<PaneKey, FormatState>>>({});
    const [paraDialogOpen, setParaDialogOpen] = useState(false);

    const handleRegisterApi = useCallback(
        (paneKey: string, api: EditorApi | null) => {
            setApis((prev) => {
                const k = paneKey as PaneKey;
                if ((prev[k] ?? null) === api) return prev;
                const next = { ...prev };
                if (api) next[k] = api;
                else delete next[k];
                return next;
            });
            registerEditorApi?.(paneKey, api);
        },
        [registerEditorApi],
    );

    const handleFormatChange = useCallback((paneKey: string, f: FormatState | null) => {
        setFormats((prev) => {
            const k = paneKey as PaneKey;
            if ((prev[k] ?? null) === f) return prev;
            const next = { ...prev };
            if (f) next[k] = f;
            else delete next[k];
            return next;
        });
    }, []);

    const handlePaneFocused = useCallback(
        (paneKey: string) => {
            setActivePane(paneKey as PaneKey);
            onPaneFocused?.(paneKey);
        },
        [onPaneFocused],
    );

    // A corkboard card was opened: show that document in the same pane.
    const handleOpenDocument = useCallback((paneKey: string, id: string) => {
        setActivePane(paneKey as PaneKey);
        if (paneKey === "primary") setPrimaryId(id);
        else setSecondaryId(id);
    }, []);

    // Click activation: a mouse press anywhere in a pane makes it the active
    // one. A press on the blank area around the text (not on the text, the
    // title bar or a control) also puts the caret in that pane's editor.
    const clickActivate = useCallback(
        (pane: PaneKey, e: React.MouseEvent) => {
            setActivePane(pane);
            onPaneFocused?.(pane);
            const target = e.target as HTMLElement;
            if (target.closest(".rt-editor-host") && !target.closest(".ProseMirror")) {
                e.preventDefault();
                apisRef.current[pane]?.focus();
            }
        },
        [onPaneFocused],
    );

    // Persist state on change.
    useEffect(() => {
        localStorage.setItem(SPLIT_KEY, split);
    }, [split]);
    useEffect(() => {
        localStorage.setItem(SPLIT_RATIO_KEY, String(ratio));
    }, [ratio]);
    useEffect(() => {
        if (secondaryId) localStorage.setItem(SPLIT_SECONDARY_KEY, secondaryId);
        else localStorage.removeItem(SPLIT_SECONDARY_KEY);
    }, [secondaryId]);

    // Drop pane documents that are no longer in the binder (purged, or a
    // stale id restored from localStorage). Skipped until the binder loads.
    useEffect(() => {
        if (binder.length === 0) return;
        if (primaryId && !binder.some((d) => d.id === primaryId)) {
            setPrimaryId(null);
        }
        if (secondaryId && !binder.some((d) => d.id === secondaryId)) {
            setSecondaryId(null);
            setSplit("none");
            setActivePane("primary");
        }
    }, [binder, primaryId, secondaryId]);

    // Titles come from the binder so a rename anywhere shows up at once.
    const primaryTitle = useMemo(
        () => binder.find((d) => d.id === primaryId)?.title,
        [binder, primaryId],
    );
    const secondaryTitle = useMemo(
        () => binder.find((d) => d.id === secondaryId)?.title,
        [binder, secondaryId],
    );

    // Same-document guard (Prueba E): editing the same document in two
    // independent ProseMirror instances would silently overwrite edits, so
    // any document the primary pane shows as text (alone or inside
    // Scrivenings) is read-only in the secondary pane, with a visible
    // explanation.
    const [displayed, setDisplayed] = useState<Record<PaneKey, string[]>>({ primary: [], secondary: [] });
    const handleDisplayed = useCallback((paneKey: string, ids: string[]) => {
        setDisplayed((prev) => {
            const k = paneKey as PaneKey;
            if (prev[k].join(",") === ids.join(",")) return prev;
            return { ...prev, [k]: ids };
        });
    }, []);
    const lockedForSecondary = useMemo(
        () => new Set(split === "none" ? [] : displayed.primary),
        [split, displayed.primary],
    );
    const sameDoc = split !== "none" && displayed.secondary.some((id) => lockedForSecondary.has(id));

    const beginSplit = useCallback((dir: Split) => {
        // Pick a different document for the secondary pane, if available.
        if (dir !== "none") {
            const others = binder
                .filter((d) => d.kind === "document" && d.id !== primaryId)
                .sort((a, b) => b.modified_at.localeCompare(a.modified_at));
            const pick = others[0]?.id ?? primaryId;
            setSecondaryId(pick);
        }
        setSplit(dir);
    }, [binder, primaryId]);

    const swapPanes = useCallback(() => {
        if (!secondaryId) return;
        setPrimaryId(secondaryId);
        setSecondaryId(primaryId);
        setActivePane("primary");
    }, [secondaryId, primaryId]);

    // Close one pane of the split; the other one stays as the single editor.
    const closePane = useCallback((pane: PaneKey) => {
        if (pane === "primary") setPrimaryId(secondaryId);
        setSplit("none");
        setSecondaryId(null);
        setActivePane("primary");
        onPaneFocused?.("primary");
    }, [secondaryId, onPaneFocused]);
    const closeSecondary = useCallback(() => closePane("secondary"), [closePane]);
    const closePrimary = useCallback(() => closePane("primary"), [closePane]);

    // Divider drag.
    const startDivider = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            dragging.current = true;
            const container = e.currentTarget.parentElement as HTMLElement;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const isVertical = split === "vertical";
            const total = isVertical ? rect.width : rect.height;
            const onMove = (ev: MouseEvent) => {
                if (!dragging.current) return;
                const offset = isVertical ? ev.clientX - rect.left : ev.clientY - rect.top;
                const r = Math.max(0.15, Math.min(0.85, offset / total));
                setRatio(r);
            };
            const onUp = () => {
                dragging.current = false;
                document.removeEventListener("mousemove", onMove);
                document.removeEventListener("mouseup", onUp);
                document.body.style.cursor = "";
            };
            document.body.style.cursor = isVertical ? "col-resize" : "row-resize";
            document.addEventListener("mousemove", onMove);
            document.addEventListener("mouseup", onUp);
        },
        [split],
    );

    const containerStyle = split === "vertical"
        ? { flexDirection: "row" as const }
        : { flexDirection: "column" as const };

    // Sizes leave room for the 6px divider so both panes stay aligned.
    const primarySize = split === "none" ? "100%" : `calc(${ratio * 100}% - 3px)`;
    const secondarySize = split === "none" ? "0%" : `calc(${(1 - ratio) * 100}% - 3px)`;

    // The shared format bar always drives the active pane.
    const barPane: PaneKey = split === "none" ? "primary" : activePane;
    const barApi = apis[barPane] ?? null;
    const barFormat = formats[barPane] ?? null;

    return (
        <div className="split-editor-root">
            <FormatBar
                editorApi={barApi}
                format={barFormat}
                onParagraphFormatting={() => setParaDialogOpen(true)}
                onAddComment={() => {
                    if (barApi && !barApi.addComment()) {
                        onError(t("Select some text in the Text view to comment on it."));
                    }
                }}
            />

            <div className="split-panes" style={containerStyle}>
                {suspended && <div className="editor-pane-empty">{t("Composition mode is open.")}</div>}
                {!suspended && (
                <div
                    className={`split-pane split-pane-primary${split !== "none" && activePane === "primary" ? " active" : ""}`}
                    style={split === "none" ? { flex: "1 1 auto" } : { flex: `0 0 ${primarySize}` }}
                    onMouseDown={(e) => clickActivate("primary", e)}
                >
                    <EditorPane
                        paneKey="primary"
                        binder={binder}
                        onOpenDocument={handleOpenDocument}
                        documentId={primaryId}
                        title={primaryTitle}
                        onClose={split !== "none" ? closePrimary : undefined}
                        onTitleChanged={onTitleChanged}
                        onContentChanged={onContentChanged}
                        onRefresh={onRefresh}
                        onError={onError}
                        registerEditorApi={handleRegisterApi}
                        onPaneFocused={handlePaneFocused}
                        onFormatChange={handleFormatChange}
                        onDisplayedIds={handleDisplayed}
                        reloadToken={reloadToken}
                    />
                </div>
                )}

                {!suspended && split !== "none" && (
                    <>
                        <div
                            className={`split-divider split-divider-${split}`}
                            onMouseDown={startDivider}
                            title={t("Drag to resize")}
                        >
                            <span className="split-divider-grip" />
                        </div>
                        <div
                            className={`split-pane split-pane-secondary${activePane === "secondary" ? " active" : ""}`}
                            style={{ flex: `0 0 ${secondarySize}` }}
                            onMouseDown={(e) => clickActivate("secondary", e)}
                        >
                            <EditorPane
                                paneKey="secondary"
                                binder={binder}
                                onOpenDocument={handleOpenDocument}
                                documentId={secondaryId}
                                title={secondaryTitle}
                                onClose={closeSecondary}
                                lockedIds={lockedForSecondary}
                                onDisplayedIds={handleDisplayed}
                                onTitleChanged={onTitleChanged}
                                onContentChanged={onContentChanged}
                                onRefresh={onRefresh}
                                onError={onError}
                                registerEditorApi={handleRegisterApi}
                                onPaneFocused={handlePaneFocused}
                                onFormatChange={handleFormatChange}
                                reloadToken={reloadToken}
                            />
                        </div>
                    </>
                )}
            </div>

            <div className="split-toolbar">
                <button
                    className={`split-tb-btn${split === "none" ? " active" : ""}`}
                    title={t("Single editor")}
                    onClick={() => {
                        if (split !== "none") closeSecondary();
                        else setSplit("none");
                    }}
                    disabled={split === "none"}
                >
                    {t("Single")}
                </button>
                <button
                    className={`split-tb-btn${split === "vertical" ? " active" : ""}`}
                    title={t("Split vertically (side by side)")}
                    onClick={() => beginSplit("vertical")}
                >
                    {t("Vertical")}
                </button>
                <button
                    className={`split-tb-btn${split === "horizontal" ? " active" : ""}`}
                    title={t("Split horizontally (stacked)")}
                    onClick={() => beginSplit("horizontal")}
                >
                    {t("Horizontal")}
                </button>
                {split !== "none" && (
                    <>
                        <span className="split-tb-sep" />
                        <button
                            className="split-tb-btn"
                            title={t("Toggle orientation")}
                            onClick={() => setSplit(split === "vertical" ? "horizontal" : "vertical")}
                        >
                            {t("Toggle orientation")}
                        </button>
                        <button
                            className="split-tb-btn"
                            title={t("Swap panes")}
                            onClick={swapPanes}
                        >
                            {t("Swap")}
                        </button>
                        <button
                            className="split-tb-btn"
                            title={t("Close secondary pane")}
                            onClick={closeSecondary}
                        >
                            {t("Close")}
                        </button>
                        {sameDoc && (
                            <span
                                className="split-pane-warn"
                                title={t("A document shown here is also open in the primary pane. It is read-only in the second pane to avoid overwrites.")}
                            >
                                ⚠ {t("Same document in both panes — read-only in the second pane")}
                            </span>
                        )}
                    </>
                )}
                {toolbarExtra && <span className="split-tb-extra">{toolbarExtra}</span>}
            </div>

            {paraDialogOpen && (
                <ParagraphFormatDialog
                    editorApi={barApi}
                    format={barFormat}
                    onClose={() => setParaDialogOpen(false)}
                    onError={onError}
                />
            )}
        </div>
    );
}
