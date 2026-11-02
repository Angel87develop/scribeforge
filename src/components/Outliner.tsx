/// Outliner: the contents of a folder (or a document with subdocuments) as a
/// table, one row per binder item, indented by depth.
///
/// - Columns: Title, Synopsis, Status, Label, Keywords, Words, Created and
///   Modified. Title is always shown; the rest can be switched on and off
///   from the Columns menu. The choice is remembered.
/// - Click a column header to sort (ascending, descending, off). Sorting
///   applies within each level, so the tree stays intact; it only changes
///   what you see, never the binder order.
/// - Title, synopsis, status, label and keywords are edited in place. Status
///   and label are picked from the project's definitions and shown in their
///   colours.
/// - Drag rows to reorder them or to drop one inside another, with the same
///   rules as the binder. Dragging is off while a sort is active, because
///   the rows on screen are not in binder order then.
/// - Double-click a row's icon (or the open button) to open it.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocumentMetaDto } from "../services/api";
import { useOrganization } from "../services/organization";
import { LabelChip, LabelSelect, StatusBadge, StatusSelect } from "./OrgBadges";
import { type DropZone, displayTitle, dropZoneAt, isFolderKind, isRootKind, planDrop } from "./binderTree";
import { DocIcon, isKnownIcon } from "./DocIcons";
import { IconChevronDown, IconChevronRight, IconDocument, IconFolder, IconOpen, IconPlus } from "./Icons";
import "../styles/outliner.css";
import { getLanguage, t, tn } from "../i18n";

const COLUMNS_KEY = "sf.outliner.columns";

type ColumnId = "title" | "synopsis" | "status" | "label" | "keywords" | "words" | "created" | "modified";

interface ColumnDef {
    id: ColumnId;
    label: string;
    width: string;
}

const COLUMNS: ColumnDef[] = [
    { id: "title", label: "Title", width: "minmax(180px, 1.3fr)" },
    { id: "synopsis", label: "Synopsis", width: "minmax(200px, 2fr)" },
    { id: "status", label: "Status", width: "120px" },
    { id: "label", label: "Label", width: "110px" },
    { id: "keywords", label: "Keywords", width: "140px" },
    { id: "words", label: "Words", width: "80px" },
    { id: "created", label: "Created", width: "110px" },
    { id: "modified", label: "Modified", width: "110px" },
];

const DEFAULT_COLUMNS: ColumnId[] = ["title", "synopsis", "status", "label", "words"];

function loadColumns(): ColumnId[] {
    try {
        const raw = localStorage.getItem(COLUMNS_KEY);
        if (raw) {
            const ids = JSON.parse(raw) as string[];
            const valid = COLUMNS.map((c) => c.id).filter((id) => ids.includes(id));
            if (!valid.includes("title")) valid.unshift("title");
            return valid;
        }
    } catch {
        // Fall back to the defaults below.
    }
    return DEFAULT_COLUMNS;
}

type Sort = { col: ColumnId; dir: 1 | -1 } | null;

interface Props {
    rootId: string;
    binder: DocumentMetaDto[];
    onOpenDocument: (id: string, kind: string) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

function sortValue(
    d: DocumentMetaDto,
    col: ColumnId,
    totals: Map<string, number>,
    statusOrder: string[],
): string | number {
    switch (col) {
        case "title":
            return d.title.toLowerCase();
        case "synopsis":
            return d.synopsis.toLowerCase();
        case "status":
            return statusOrder.indexOf(d.status) >= 0 ? statusOrder.indexOf(d.status) : 99;
        case "label":
            return (d.labels[0] ?? "").toLowerCase();
        case "keywords":
            return d.labels.slice(1).join(", ").toLowerCase();
        case "words":
            return totals.get(d.id) ?? d.word_count;
        case "created":
            return d.created_at;
        case "modified":
            return d.modified_at;
    }
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(getLanguage());
}

export function Outliner({ rootId, binder, onOpenDocument, onRefresh, onError }: Props) {
    const { statuses } = useOrganization();
    const statusOrder = useMemo(() => statuses.map((s) => s.name), [statuses]);
    const [columns, setColumns] = useState<ColumnId[]>(loadColumns);
    const [sort, setSort] = useState<Sort>(null);
    const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
    const [columnsMenu, setColumnsMenu] = useState(false);
    const [selected, setSelected] = useState<string | null>(null);
    const [editing, setEditing] = useState<{ id: string; col: ColumnId } | null>(null);
    const dragId = useRef<string | null>(null);
    const [dropHint, setDropHint] = useState<{ id: string; zone: DropZone } | null>(null);

    useEffect(() => {
        localStorage.setItem(COLUMNS_KEY, JSON.stringify(columns));
    }, [columns]);

    // Word totals including subdocuments, for folders and parent documents.
    const totals = useMemo(() => {
        const byParent = new Map<string | null, DocumentMetaDto[]>();
        for (const d of binder) {
            const arr = byParent.get(d.parent) ?? [];
            arr.push(d);
            byParent.set(d.parent, arr);
        }
        const out = new Map<string, number>();
        const total = (d: DocumentMetaDto): number => {
            const cached = out.get(d.id);
            if (cached !== undefined) return cached;
            const sum = d.word_count + (byParent.get(d.id) ?? []).reduce((n, c) => n + total(c), 0);
            out.set(d.id, sum);
            return sum;
        };
        binder.forEach(total);
        return out;
    }, [binder]);

    // Rows in tree order, each level sorted when a sort is active.
    const rows = useMemo(() => {
        const byParent = new Map<string | null, DocumentMetaDto[]>();
        for (const d of binder) {
            const arr = byParent.get(d.parent) ?? [];
            arr.push(d);
            byParent.set(d.parent, arr);
        }
        const out: { meta: DocumentMetaDto; depth: number; hasChildren: boolean }[] = [];
        const walk = (parent: string, depth: number) => {
            const kids = [...(byParent.get(parent) ?? [])].sort((a, b) => a.order - b.order);
            if (sort) {
                kids.sort((a, b) => {
                    const va = sortValue(a, sort.col, totals, statusOrder);
                    const vb = sortValue(b, sort.col, totals, statusOrder);
                    return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir;
                });
            }
            for (const d of kids) {
                const hasChildren = (byParent.get(d.id) ?? []).length > 0;
                out.push({ meta: d, depth, hasChildren });
                if (hasChildren && !collapsed.has(d.id)) walk(d.id, depth + 1);
            }
        };
        walk(rootId, 0);
        return out;
    }, [binder, rootId, sort, collapsed, totals, statusOrder]);

    const shown = COLUMNS.filter((c) => columns.includes(c.id));
    const grid = shown.map((c) => c.width).join(" ");

    function toggleSort(col: ColumnId) {
        setSort((s) => {
            if (!s || s.col !== col) return { col, dir: 1 };
            if (s.dir === 1) return { col, dir: -1 };
            return null;
        });
    }

    async function save(id: string, patch: Parameters<typeof api.updateDocument>[0]) {
        setEditing(null);
        try {
            await api.updateDocument({ ...patch, id });
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function drop(targetId: string, zone: DropZone) {
        const dragging = dragId.current;
        dragId.current = null;
        setDropHint(null);
        if (!dragging) return;
        const plan = planDrop(binder, dragging, targetId, zone);
        if (!plan) return;
        try {
            if (plan.kind === "trash") await api.moveToTrash(dragging);
            else await api.moveDocument(dragging, plan.parent, plan.index);
            if (zone === "into") {
                setCollapsed((c) => {
                    const n = new Set(c);
                    n.delete(targetId);
                    return n;
                });
            }
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function addDocument() {
        try {
            await api.createDocument(rootId, "document");
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    function cell(d: DocumentMetaDto, col: ColumnId, depth: number, hasChildren: boolean) {
        const isEditing = editing?.id === d.id && editing.col === col;
        const folder = isFolderKind(d.kind);
        switch (col) {
            case "title":
                return (
                    <div className="outliner-cell outliner-title" style={{ paddingLeft: 6 + depth * 18 }}>
                        {hasChildren ? (
                            <button
                                type="button"
                                className="outliner-chevron"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setCollapsed((c) => {
                                        const n = new Set(c);
                                        if (n.has(d.id)) n.delete(d.id);
                                        else n.add(d.id);
                                        return n;
                                    });
                                }}
                            >
                                {collapsed.has(d.id) ? <IconChevronRight size={12} /> : <IconChevronDown size={12} />}
                            </button>
                        ) : (
                            <span className="outliner-chevron-spacer" />
                        )}
                        <span
                            className="outliner-icon"
                            title={t("Double-click to open")}
                            onDoubleClick={() => onOpenDocument(d.id, d.kind)}
                        >
                            {isKnownIcon(d.icon) ? (
                                <DocIcon id={d.icon} size={14} />
                            ) : folder ? (
                                <IconFolder size={14} />
                            ) : (
                                <IconDocument size={14} />
                            )}
                        </span>
                        {isEditing ? (
                            <CellInput
                                initial={d.title}
                                onCommit={(v) => {
                                    if (v.trim() && v.trim() !== d.title) save(d.id, { id: d.id, title: v.trim() });
                                    else setEditing(null);
                                }}
                                onCancel={() => setEditing(null)}
                            />
                        ) : (
                            <span className="outliner-text" onDoubleClick={() => setEditing({ id: d.id, col })}>
                                {displayTitle(d)}
                            </span>
                        )}
                        <button
                            type="button"
                            className="outliner-open"
                            title={t("Open")}
                            onClick={(e) => {
                                e.stopPropagation();
                                onOpenDocument(d.id, d.kind);
                            }}
                        >
                            <IconOpen size={12} />
                        </button>
                    </div>
                );
            case "synopsis":
                return (
                    <div className="outliner-cell outliner-synopsis" onDoubleClick={() => setEditing({ id: d.id, col })}>
                        {isEditing ? (
                            <CellInput
                                multiline
                                initial={d.synopsis}
                                onCommit={(v) => (v !== d.synopsis ? save(d.id, { id: d.id, synopsis: v }) : setEditing(null))}
                                onCancel={() => setEditing(null)}
                            />
                        ) : (
                            <span className={d.synopsis ? "" : "outliner-muted"}>
                                {d.synopsis || t("Double-click to add a synopsis")}
                            </span>
                        )}
                    </div>
                );
            case "status":
                return (
                    <div className="outliner-cell outliner-status">
                        <StatusBadge name={d.status} compact />
                        <StatusSelect
                            className="outliner-select"
                            value={d.status}
                            onChange={(v) => save(d.id, { id: d.id, status: v })}
                        />
                    </div>
                );
            case "label":
                return (
                    <div className="outliner-cell" onDoubleClick={() => setEditing({ id: d.id, col })}>
                        {isEditing ? (
                            <LabelSelect
                                className="outliner-select"
                                value={d.labels[0] ?? ""}
                                onChange={(v) => save(d.id, { id: d.id, labels: [v.trim(), ...d.labels.slice(1)] })}
                            />
                        ) : d.labels[0] ? (
                            <LabelChip name={d.labels[0]} />
                        ) : (
                            <span className="outliner-muted">—</span>
                        )}
                    </div>
                );
            case "keywords":
                return (
                    <div className="outliner-cell" onDoubleClick={() => setEditing({ id: d.id, col })}>
                        {isEditing ? (
                            <CellInput
                                initial={d.labels.slice(1).join(", ")}
                                onCommit={(v) =>
                                    save(d.id, {
                                        id: d.id,
                                        labels: [
                                            d.labels[0] ?? "",
                                            ...v.split(",").map((k) => k.trim()).filter(Boolean),
                                        ],
                                    })
                                }
                                onCancel={() => setEditing(null)}
                            />
                        ) : (
                            <span className={d.labels.length > 1 ? "" : "outliner-muted"}>
                                {d.labels.slice(1).join(", ") || "—"}
                            </span>
                        )}
                    </div>
                );
            case "words": {
                const total = totals.get(d.id) ?? d.word_count;
                return (
                    <div className="outliner-cell outliner-num" title={total !== d.word_count ? t("{n} in this item", { n: d.word_count }) : undefined}>
                        {total.toLocaleString(getLanguage())}
                    </div>
                );
            }
            case "created":
                return <div className="outliner-cell outliner-muted">{formatDate(d.created_at)}</div>;
            case "modified":
                return <div className="outliner-cell outliner-muted">{formatDate(d.modified_at)}</div>;
        }
    }

    const totalWords = totals.get(rootId) ?? 0;

    return (
        <div className="outliner-root" onClick={() => setColumnsMenu(false)}>
            <div className="outliner-toolbar">
                <button type="button" className="split-tb-btn" onClick={addDocument} title={t("New document here")}>
                    <IconPlus size={12} /> {t("New")}
                </button>
                {sort && (
                    <span className="outliner-hint">
                        {t("Sorted by {column} (display only; drag is off).", {
                            column: t(COLUMNS.find((c) => c.id === sort.col)?.label ?? "").toLowerCase(),
                        })}{" "}
                        <button type="button" className="outliner-link" onClick={() => setSort(null)}>
                            {t("Back to binder order")}
                        </button>
                    </span>
                )}
                <span className="spacer" />
                <div className="outliner-columns-wrap" onClick={(e) => e.stopPropagation()}>
                    <button type="button" className="split-tb-btn" onClick={() => setColumnsMenu((v) => !v)}>
                        {t("Columns")} <IconChevronDown size={11} />
                    </button>
                    {columnsMenu && (
                        <div className="outliner-columns-menu">
                            {COLUMNS.filter((c) => c.id !== "title").map((c) => (
                                <label key={c.id} className="outliner-columns-item">
                                    <input
                                        type="checkbox"
                                        checked={columns.includes(c.id)}
                                        onChange={(e) =>
                                            setColumns((cols) =>
                                                e.target.checked
                                                    ? COLUMNS.map((x) => x.id).filter((id) => cols.includes(id) || id === c.id)
                                                    : cols.filter((id) => id !== c.id),
                                            )
                                        }
                                    />
                                    {t(c.label)}
                                </label>
                            ))}
                            <div className="ctx-sep" />
                            <button type="button" className="ctx-item" onClick={() => setColumns(DEFAULT_COLUMNS)}>
                                {t("Reset columns")}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            <div className="outliner-table">
                <div className="outliner-header" style={{ gridTemplateColumns: grid }}>
                    {shown.map((c) => (
                        <button
                            key={c.id}
                            type="button"
                            className={`outliner-th${sort?.col === c.id ? " sorted" : ""}`}
                            onClick={() => toggleSort(c.id)}
                            title={t("Click to sort")}
                        >
                            {t(c.label)}
                            {sort?.col === c.id && <span className="outliner-sort">{sort.dir === 1 ? "▲" : "▼"}</span>}
                        </button>
                    ))}
                </div>
                {rows.length === 0 && <div className="outliner-empty">{t("Nothing here yet.")}</div>}
                {rows.map(({ meta: d, depth, hasChildren }) => {
                    const hint = dropHint?.id === d.id ? ` drop-${dropHint.zone}` : "";
                    return (
                        <div
                            key={d.id}
                            className={`outliner-row${selected === d.id ? " selected" : ""}${hint}`}
                            style={{ gridTemplateColumns: grid }}
                            onClick={() => setSelected(d.id)}
                            draggable={!sort && !isRootKind(d.kind) && !editing}
                            onDragStart={(e) => {
                                dragId.current = d.id;
                                e.dataTransfer.effectAllowed = "move";
                                e.dataTransfer.setData("text/plain", d.id);
                            }}
                            onDragEnd={() => {
                                dragId.current = null;
                                setDropHint(null);
                            }}
                            onDragOver={(e) => {
                                const dragging = dragId.current;
                                if (!dragging) return;
                                const zone = dropZoneAt(e, true);
                                if (!planDrop(binder, dragging, d.id, zone)) return;
                                e.preventDefault();
                                if (dropHint?.id !== d.id || dropHint.zone !== zone) setDropHint({ id: d.id, zone });
                            }}
                            onDragLeave={(e) => {
                                if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                                    setDropHint((h) => (h?.id === d.id ? null : h));
                                }
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                drop(d.id, dropZoneAt(e, true));
                            }}
                        >
                            {shown.map((c) => (
                                <div key={c.id} className="outliner-td">
                                    {cell(d, c.id, depth, hasChildren)}
                                </div>
                            ))}
                        </div>
                    );
                })}
            </div>
            <div className="outliner-footer">
                {tn(rows.length, "{n} item", "{n} items")} · {tn(totalWords, "{n} word", "{n} words")}
            </div>
        </div>
    );
}

function CellInput({
    initial,
    multiline,
    onCommit,
    onCancel,
}: {
    initial: string;
    multiline?: boolean;
    onCommit: (v: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    const done = useRef(false);
    const commit = () => {
        if (done.current) return;
        done.current = true;
        onCommit(value);
    };
    const keys = (e: React.KeyboardEvent) => {
        if (e.key === "Escape") {
            e.preventDefault();
            done.current = true;
            onCancel();
        } else if (e.key === "Enter" && (!multiline || e.ctrlKey)) {
            e.preventDefault();
            commit();
        }
    };
    const common = {
        autoFocus: true,
        value,
        className: "outliner-input",
        onBlur: commit,
        onKeyDown: keys,
        onClick: (e: React.MouseEvent) => e.stopPropagation(),
        onDoubleClick: (e: React.MouseEvent) => e.stopPropagation(),
    };
    return multiline ? (
        <textarea {...common} rows={3} onChange={(e) => setValue(e.target.value)} />
    ) : (
        <input type="text" {...common} onChange={(e) => setValue(e.target.value)} />
    );
}
