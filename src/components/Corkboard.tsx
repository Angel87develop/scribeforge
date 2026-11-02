/// Corkboard: Scrivener-style index cards for the children of a folder.
///
/// Each card shows the document title on top and its synopsis as the body.
/// The synopsis is a separate field from the document content, so editing a
/// card never touches the real text. While a document has no synopsis, the
/// card shows the beginning of its text (muted) as a starting point; the
/// first edit turns it into the card's own synopsis.
///
/// - The card title is independent from the document title: editing it never
///   renames the document. Until it is set, the card shows the document title.
/// - Double-click the card header (or press the open button) to open it.
/// - The last card ("+") adds a new document to the folder.
/// - Cards wear their label colour (a stripe, and a tint when "Colour by
///   label" is on) and show their status at the bottom.
/// - Grid mode: drag a card by its icon to reorder the folder.
/// - Freeform mode: drag cards anywhere by their header; positions are
///   saved per document and never change the binder order. "Tidy Up" puts
///   every card back on the grid. Each folder remembers its mode.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { api, type CardPos, type DocumentMetaDto, type RichDoc } from "../services/api";
import { useOrganization } from "../services/organization";
import { DocIcon, isKnownIcon } from "./DocIcons";
import { IconDocument, IconFolder, IconOpen, IconPlus } from "./Icons";
import { StatusBadge } from "./OrgBadges";
import "../styles/corkboard.css";
import "../styles/organization.css";
import { t, tn } from "../i18n";

const EXCERPT_CHARS = 400;
const SAVE_DELAY_MS = 600;
const CARD_W = 220;
const CARD_H = 190;
const GAP = 22;
const PAD = 16;
const TINT_KEY = "sf.cork.tint";
const modeKey = (folder: string) => `sf.cork.mode.${folder}`;

interface Props {
    folderId: string;
    binder: DocumentMetaDto[];
    /** Opens a card's document (or sub-folder) in this pane. */
    onOpenDocument: (id: string, kind: string) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

function isFolderKind(kind: string): boolean {
    return kind === "folder" || kind.endsWith("_root");
}

/** Plain text of a RichDoc, for the card excerpt. */
function richDocToPlain(doc: RichDoc): string {
    return doc.blocks
        .map((b) => {
            if (b.type === "code_block") return b.text ?? "";
            const spans = b.spans ?? (b.items ?? []).flatMap((i) => i.spans ?? []);
            return spans.map((s) => s.text).join("");
        })
        .filter((t) => t.trim().length > 0)
        .join("\n");
}

/** Where card `i` sits on the grid, for cards without a free position. */
function slot(i: number, cols: number): CardPos {
    return { x: PAD + (i % cols) * (CARD_W + GAP), y: PAD + Math.floor(i / cols) * (CARD_H + GAP) };
}

export function Corkboard({
    folderId,
    binder,
    onOpenDocument,
    onRefresh,
    onError,
}: Props) {
    const { labelColor } = useOrganization();
    const children = useMemo(
        () =>
            binder
                .filter((d) => d.parent === folderId)
                .sort((a, b) => a.order - b.order),
        [binder, folderId],
    );
    const [selected, setSelected] = useState<string | null>(null);
    const [excerpts, setExcerpts] = useState<Record<string, string>>({});
    const [mode, setMode] = useState<"grid" | "free">(() =>
        localStorage.getItem(modeKey(folderId)) === "free" ? "free" : "grid",
    );
    const [tint, setTint] = useState(() => localStorage.getItem(TINT_KEY) !== "0");
    const boardRef = useRef<HTMLDivElement>(null);
    const [cols, setCols] = useState(4);

    useEffect(() => {
        setMode(localStorage.getItem(modeKey(folderId)) === "free" ? "free" : "grid");
    }, [folderId]);

    // Columns that fit, for the default freeform layout.
    useLayoutEffect(() => {
        const el = boardRef.current;
        if (!el) return;
        const measure = () => setCols(Math.max(1, Math.floor((el.clientWidth - PAD) / (CARD_W + GAP))));
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    // Load text excerpts for documents that don't have a synopsis yet.
    const needExcerpt = children
        .filter((d) => !isFolderKind(d.kind) && !d.synopsis)
        .map((d) => d.id)
        .join(",");
    useEffect(() => {
        if (!needExcerpt) return;
        let cancelled = false;
        Promise.all(
            needExcerpt.split(",").map((id) =>
                api.getDocument(id)
                    .then((d) => [id, richDocToPlain(d.content).slice(0, EXCERPT_CHARS)] as const)
                    .catch(() => [id, ""] as const),
            ),
        ).then((pairs) => {
            if (cancelled) return;
            setExcerpts((prev) => {
                const next = { ...prev };
                for (const [id, text] of pairs) next[id] = text;
                return next;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [needExcerpt]);

    async function addCard() {
        try {
            const meta = await api.createDocument(folderId, "document");
            setSelected(meta.id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    function chooseMode(m: "grid" | "free") {
        localStorage.setItem(modeKey(folderId), m);
        setMode(m);
    }

    // ----- Grid: drag a card's icon to reorder -----
    const dragId = useRef<string | null>(null);
    const [dropHint, setDropHint] = useState<{ id: string; side: "before" | "after" } | null>(null);

    async function dropOn(targetId: string, side: "before" | "after") {
        const dragged = dragId.current;
        dragId.current = null;
        setDropHint(null);
        if (!dragged || dragged === targetId) return;
        const rest = children.filter((d) => d.id !== dragged);
        const at = rest.findIndex((d) => d.id === targetId);
        if (at < 0) return;
        try {
            await api.moveDocument(dragged, folderId, side === "before" ? at : at + 1);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    // ----- Freeform: positions, dragging by the header -----
    const [positions, setPositions] = useState<Record<string, CardPos>>({});
    useEffect(() => {
        const next: Record<string, CardPos> = {};
        children.forEach((d, i) => {
            next[d.id] = d.card_pos ?? slot(i, cols);
        });
        setPositions(next);
    }, [children, cols]);

    const freeDrag = useRef<{ id: string; startX: number; startY: number; orig: CardPos; moved: boolean } | null>(null);

    const startFreeDrag = useCallback(
        (e: React.PointerEvent, id: string) => {
            if (mode !== "free" || e.button !== 0) return;
            if ((e.target as HTMLElement).closest("textarea, button")) return;
            const orig = positions[id];
            if (!orig) return;
            // On the title field a plain click still edits it; the drag only
            // starts once the pointer moves.
            if (!(e.target as HTMLElement).closest("input")) e.preventDefault();
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
            freeDrag.current = { id, startX: e.clientX, startY: e.clientY, orig, moved: false };
            setSelected(id);
        },
        [mode, positions],
    );

    const moveFreeDrag = useCallback((e: React.PointerEvent) => {
        const d = freeDrag.current;
        if (!d) return;
        const dx = e.clientX - d.startX;
        const dy = e.clientY - d.startY;
        if (!d.moved && Math.abs(dx) + Math.abs(dy) < 3) return;
        if (!d.moved) {
            (document.activeElement as HTMLElement | null)?.blur();
            window.getSelection()?.removeAllRanges();
        }
        d.moved = true;
        setPositions((prev) => ({
            ...prev,
            [d.id]: { x: Math.max(0, d.orig.x + dx), y: Math.max(0, d.orig.y + dy) },
        }));
    }, []);

    const endFreeDrag = useCallback(() => {
        const d = freeDrag.current;
        freeDrag.current = null;
        if (!d || !d.moved) return;
        setPositions((prev) => {
            const pos = prev[d.id];
            if (pos) {
                api.updateDocument({ id: d.id, card_pos: { x: Math.round(pos.x), y: Math.round(pos.y) } })
                    .catch((err) => onError(String(err)));
            }
            return prev;
        });
    }, [onError]);

    async function tidyUp() {
        try {
            await api.resetCardPositions(folderId);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    const free = mode === "free";
    const canvas = free
        ? Object.values(positions).reduce(
              (acc, p) => ({ w: Math.max(acc.w, p.x + CARD_W + PAD), h: Math.max(acc.h, p.y + CARD_H + PAD) }),
              { w: 0, h: 0 },
          )
        : null;
    const addPos = free ? slot(children.length, cols) : null;

    return (
        <div className="cork-wrap">
            <div className="cork-bar">
                <div className="view-switch" role="tablist" aria-label={t("Corkboard mode")}>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={!free}
                        className={!free ? "active" : ""}
                        onClick={() => chooseMode("grid")}
                        title={t("Cards in binder order; drag a card's icon to reorder")}
                    >
                        {t("Grid")}
                    </button>
                    <button
                        type="button"
                        role="tab"
                        aria-selected={free}
                        className={free ? "active" : ""}
                        onClick={() => chooseMode("free")}
                        title={t("Place cards anywhere; the binder order does not change")}
                    >
                        {t("Freeform")}
                    </button>
                </div>
                <label className="prefs-check cork-tint">
                    <input
                        type="checkbox"
                        checked={tint}
                        onChange={(e) => {
                            localStorage.setItem(TINT_KEY, e.target.checked ? "1" : "0");
                            setTint(e.target.checked);
                        }}
                    />
                    {t("Colour by label")}
                </label>
                {free && (
                    <button type="button" className="split-tb-btn" onClick={tidyUp} title={t("Put every card back on the grid")}>
                        {t("Tidy Up")}
                    </button>
                )}
                <span className="cork-hint">
                    {free ? t("Drag cards by their header.") : t("Drag a card by its icon to reorder.")}
                </span>
            </div>
            <div
                ref={boardRef}
                className={`corkboard${free ? " free" : ""}`}
                onMouseDown={(e) => {
                    if (e.target === e.currentTarget) setSelected(null);
                }}
                onPointerMove={moveFreeDrag}
                onPointerUp={endFreeDrag}
                onPointerCancel={endFreeDrag}
            >
                {free && canvas && (
                    <div className="cork-canvas" style={{ width: canvas.w, height: Math.max(canvas.h, (addPos?.y ?? 0) + CARD_H + PAD) }} />
                )}
                {children.map((d) => {
                    const color = labelColor(d.labels[0]);
                    const pos = positions[d.id];
                    const hint = dropHint?.id === d.id ? ` drop-${dropHint.side}` : "";
                    return (
                        <IndexCard
                            key={d.id}
                            meta={d}
                            excerpt={excerpts[d.id] ?? ""}
                            selected={selected === d.id}
                            labelColor={color}
                            tint={tint}
                            extraClass={hint}
                            style={free && pos ? { left: pos.x, top: pos.y, zIndex: selected === d.id ? 2 : 1 } : undefined}
                            onHeadPointerDown={(e) => startFreeDrag(e, d.id)}
                            gripProps={
                                free
                                    ? undefined
                                    : {
                                          draggable: true,
                                          onDragStart: (e) => {
                                              dragId.current = d.id;
                                              e.dataTransfer.effectAllowed = "move";
                                              e.dataTransfer.setData("text/plain", d.id);
                                          },
                                          onDragEnd: () => {
                                              dragId.current = null;
                                              setDropHint(null);
                                          },
                                      }
                            }
                            cardDropProps={
                                free
                                    ? undefined
                                    : {
                                          onDragOver: (e) => {
                                              if (!dragId.current || dragId.current === d.id) return;
                                              e.preventDefault();
                                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                              const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
                                              if (dropHint?.id !== d.id || dropHint.side !== side) setDropHint({ id: d.id, side });
                                          },
                                          onDragLeave: (e) => {
                                              if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                                  setDropHint((h) => (h?.id === d.id ? null : h));
                                              }
                                          },
                                          onDrop: (e) => {
                                              e.preventDefault();
                                              const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                              void dropOn(d.id, e.clientX < r.left + r.width / 2 ? "before" : "after");
                                          },
                                      }
                            }
                            onSelect={() => setSelected(d.id)}
                            onOpen={() => onOpenDocument(d.id, d.kind)}
                            onRefresh={onRefresh}
                            onError={onError}
                        />
                    );
                })}
                <button
                    type="button"
                    className="cork-card cork-card-add"
                    style={free && addPos ? { left: addPos.x, top: addPos.y } : undefined}
                    onClick={addCard}
                    title={t("New document in this folder")}
                >
                    <IconPlus size={22} />
                    <span>{t("New card")}</span>
                </button>
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Index card
// ---------------------------------------------------------------------------

interface CardProps {
    meta: DocumentMetaDto;
    excerpt: string;
    selected: boolean;
    labelColor: string | null;
    tint: boolean;
    extraClass: string;
    style?: React.CSSProperties;
    onHeadPointerDown: (e: React.PointerEvent) => void;
    gripProps?: React.HTMLAttributes<HTMLSpanElement> & { draggable?: boolean };
    cardDropProps?: React.HTMLAttributes<HTMLDivElement>;
    onSelect: () => void;
    onOpen: () => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

function IndexCard({
    meta,
    excerpt,
    selected,
    labelColor,
    tint,
    extraClass,
    style,
    onHeadPointerDown,
    gripProps,
    cardDropProps,
    onSelect,
    onOpen,
    onRefresh,
    onError,
}: CardProps) {
    const folder = isFolderKind(meta.kind);
    const cardTitle = meta.card_title || meta.title;
    const [title, setTitle] = useState(cardTitle);
    const [body, setBody] = useState(meta.synopsis);
    const editingTitle = useRef(false);
    const editingBody = useRef(false);
    const saveTimer = useRef<number | null>(null);
    const pendingBody = useRef<string | null>(null);

    // Follow outside changes (binder rename, inspector synopsis) unless the
    // user is editing that field right now.
    useEffect(() => {
        if (!editingTitle.current) setTitle(cardTitle);
    }, [cardTitle]);
    useEffect(() => {
        if (!editingBody.current) setBody(meta.synopsis);
    }, [meta.synopsis]);

    const flushBody = useCallback(() => {
        if (saveTimer.current !== null) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
        }
        const text = pendingBody.current;
        if (text === null) return Promise.resolve();
        pendingBody.current = null;
        return api.updateDocument({ id: meta.id, synopsis: text })
            .then(() => undefined)
            .catch((e) => onError(String(e)));
    }, [meta.id, onError]);

    // Save anything pending if the card goes away (folder switch, etc.).
    useEffect(() => () => {
        void flushBody();
    }, [flushBody]);

    // Saves the card's own title; the document title is never touched.
    // Clearing the field goes back to showing the document title.
    function commitTitle() {
        editingTitle.current = false;
        const t = title.trim();
        if (t === cardTitle) return;
        const stored = t === meta.title ? "" : t;
        if (!t) setTitle(meta.title);
        api.updateDocument({ id: meta.id, card_title: stored })
            .then(() => onRefresh())
            .catch((e) => onError(String(e)));
    }

    // No synopsis yet: the body shows the document's text as a starting point.
    const showingExcerpt = !body && !folder;
    const bodyValue = showingExcerpt ? excerpt : body;

    const accent = labelColor
        ? ({ "--card-accent": labelColor, ...(tint ? { "--card-tint": `${labelColor}22` } : {}) } as React.CSSProperties)
        : {};

    return (
        <div
            className={`cork-card${selected ? " selected" : ""}${folder ? " folder" : ""}${labelColor ? " labelled" : ""}${tint && labelColor ? " tinted" : ""}${extraClass}`}
            style={{ ...accent, ...style }}
            onMouseDown={onSelect}
            {...cardDropProps}
        >
            <div
                className="cork-card-head"
                onDoubleClick={onOpen}
                onPointerDown={onHeadPointerDown}
                title={
                    meta.labels[0]
                        ? t("Label: {name} · double-click to open", { name: meta.labels[0] })
                        : t("Double-click to open")
                }
            >
                <span className={`cork-card-icon${gripProps ? " grip" : ""}`} {...gripProps}>
                    {isKnownIcon(meta.icon) ? (
                        <DocIcon id={meta.icon} size={15} />
                    ) : folder ? (
                        <IconFolder size={14} />
                    ) : (
                        <IconDocument size={14} />
                    )}
                </span>
                <input
                    className="cork-card-title"
                    value={title}
                    spellCheck={false}
                    onFocus={() => {
                        editingTitle.current = true;
                    }}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            setTitle(cardTitle);
                            editingTitle.current = false;
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                />
                <button
                    type="button"
                    className="cork-card-open"
                    title={folder ? t("Open folder") : t("Open document")}
                    onClick={onOpen}
                >
                    <IconOpen size={13} />
                </button>
            </div>
            <textarea
                className={`cork-card-body${showingExcerpt ? " excerpt" : ""}`}
                value={bodyValue}
                placeholder={folder ? t("Folder synopsis…") : t("Write a synopsis…")}
                onFocus={() => {
                    editingBody.current = true;
                }}
                onChange={(e) => {
                    const text = e.target.value;
                    setBody(text);
                    pendingBody.current = text;
                    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
                    saveTimer.current = window.setTimeout(() => void flushBody(), SAVE_DELAY_MS);
                }}
                onBlur={() => {
                    editingBody.current = false;
                    const hadPending = pendingBody.current !== null;
                    void flushBody().then(() => {
                        // Refresh the binder so the inspector & cards agree.
                        if (hadPending) onRefresh();
                    });
                }}
            />
            <div className="cork-card-foot">
                {meta.status && <StatusBadge name={meta.status} />}
                {!folder && meta.word_count > 0 && <span>{tn(meta.word_count, "{n} word", "{n} words")}</span>}
            </div>
        </div>
    );
}
