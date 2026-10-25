/// Binder: hierarchical project tree with full CRUD.
///
/// Features:
/// - Expand/collapse folders, click to select, double-click to rename inline.
/// - Documents can hold sub-documents ("New Subdocument"); any row with
///   children gets an expand chevron.
/// - Drag-and-drop to reorder or reparent (with cycle rules).
/// - Right-click context menu adapted to the node kind (Document, Folder,
///   Trash, Root, etc.).
/// - "Change Icon" submenu: custom per-document icons (see DocIcons).
/// - Header with New Document / New Folder buttons (targeted at the current
///   selection, or Draft root if nothing is selected).
/// - Roots (Draft / Research / Trash) cannot be deleted, renamed, or moved.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DocumentMetaDto } from "../services/api";
import { DocIcon, groupIconId, ICON_GROUPS, ICON_SINGLES, isKnownIcon } from "./DocIcons";
import {
    IconChevronDown,
    IconChevronRight,
    IconDocument,
    IconFolder,
    IconFolderOpen,
    IconPlus,
    IconRefresh,
    IconTrash,
} from "./Icons";
import "../styles/binder.css";

interface TreeNode {
    meta: DocumentMetaDto;
    children: TreeNode[];
}

function kindIsFolder(kind: string): boolean {
    return (
        kind === "folder" ||
        kind === "draft_root" ||
        kind === "research_root" ||
        kind === "trash_root"
    );
}

function kindIsRoot(kind: string): boolean {
    return kind === "draft_root" || kind === "research_root" || kind === "trash_root";
}

function buildTree(binder: DocumentMetaDto[]): TreeNode[] {
    const byParent = new Map<string | null, DocumentMetaDto[]>();
    for (const item of binder) {
        const arr = byParent.get(item.parent) ?? [];
        arr.push(item);
        byParent.set(item.parent, arr);
    }
    const make = (parent: string | null): TreeNode[] => {
        const items = byParent.get(parent) ?? [];
        items.sort((a, b) => a.order - b.order);
        return items.map((item) => ({
            meta: item,
            children: make(item.id),
        }));
    };
    return make(null);
}

interface Props {
    binder: DocumentMetaDto[];
    selectedId: string | null;
    expanded: Set<string>;
    onSelect: (id: string, kind: string) => void;
    onToggle: (id: string) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

type MenuState =
    | null
    | { x: number; y: number; target: DocumentMetaDto };

export function Binder({
    binder,
    selectedId,
    expanded,
    onSelect,
    onToggle,
    onRefresh,
    onError,
}: Props) {
    const tree = useMemo(() => buildTree(binder), [binder]);
    const [menu, setMenu] = useState<MenuState>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const dragId = useRef<string | null>(null);

    // Close the context menu on any click elsewhere.
    const closeMenu = () => setMenu(null);

    // Resolve a sensible default parent for "new" actions: the selected node
    // if it's a folder, otherwise the selected node's parent, otherwise Draft
    // root.
    function defaultParentId(): string | null {
        if (!selectedId) {
            const draft = binder.find((d) => d.kind === "draft_root");
            return draft ? draft.id : null;
        }
        const sel = binder.find((d) => d.id === selectedId);
        if (!sel) return null;
        if (kindIsFolder(sel.kind)) return sel.id;
        return sel.parent;
    }

    async function handleCreate(kind: "document" | "folder" | "research") {
        const parent = defaultParentId();
        if (!parent) {
            onError("No suitable parent folder. Select a folder first.");
            return;
        }
        try {
            await api.createDocument(parent, kind);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    // Create under an explicit parent (context menu target), then make sure
    // the parent is expanded so the new item is visible.
    async function handleCreateUnder(parent: string, kind: "document" | "folder") {
        setMenu(null);
        try {
            await api.createDocument(parent, kind);
            if (!expanded.has(parent)) onToggle(parent);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleSetIcon(id: string, icon: string) {
        setMenu(null);
        try {
            await api.updateDocument({ id, icon });
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleRename(id: string, title: string) {
        try {
            await api.renameDocument(id, title);
            setRenamingId(null);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleDuplicate(id: string) {
        try {
            await api.duplicateDocument(id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleTrash(id: string) {
        try {
            await api.moveToTrash(id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleRestore(id: string) {
        try {
            await api.restoreFromTrash(id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handlePurge(id: string) {
        if (!confirm("Delete permanently? This cannot be undone.")) return;
        try {
            await api.purgeDocument(id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleEmptyTrash() {
        if (!confirm("Empty the Trash? All items will be permanently deleted.")) return;
        try {
            await api.emptyTrash();
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    function startDrag(id: string) {
        dragId.current = id;
    }

    async function handleDrop(targetId: string, before: boolean) {
        const dragging = dragId.current;
        dragId.current = null;
        if (!dragging || dragging === targetId) return;
        const target = binder.find((d) => d.id === targetId);
        if (!target) return;
        // Can't drop a root anywhere.
        if (kindIsRoot(dragging)) return;
        // Decide parent + index.
        let parentId: string;
        let index: number;
        if (kindIsFolder(target.kind) && !before) {
            // Dropped onto a folder (not on its top edge): reparent into it.
            parentId = target.id;
            index = -1; // append
        } else {
            // Dropped on the gap before/after a row: reorder among siblings.
            parentId = target.parent ?? "";
            const siblings = binder
                .filter((d) => d.parent === target.parent)
                .sort((a, b) => a.order - b.order);
            const targetIndex = siblings.findIndex((d) => d.id === targetId);
            index = before ? targetIndex : targetIndex + 1;
            if (index < 0) index = 0;
        }
        try {
            await api.moveDocument(dragging, parentId, index);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    function renderNode(node: TreeNode, depth: number): React.ReactNode {
        const m = node.meta;
        const isFolder = kindIsFolder(m.kind);
        const hasChildren = node.children.length > 0;
        const expandable = isFolder || hasChildren;
        const isOpen = expanded.has(m.id);
        const isSelected = selectedId === m.id;
        const isRoot = kindIsRoot(m.kind);
        const isTrash = m.kind === "trash_root";
        const isRenaming = renamingId === m.id;

        return (
            <div key={m.id}>
                <div
                    className={`binder-row${isSelected ? " selected" : ""}${m.in_trash ? " in-trash" : ""}`}
                    style={{ paddingLeft: 4 + depth * 16 }}
                    draggable={!isRoot}
                    onDragStart={() => startDrag(m.id)}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        const before = e.clientY < rect.top + rect.height / 2;
                        handleDrop(m.id, before);
                    }}
                    onClick={() => {
                        if (isFolder) onToggle(m.id);
                        onSelect(m.id, m.kind);
                    }}
                    onDoubleClick={(e) => {
                        if (!isRoot) {
                            e.stopPropagation();
                            setRenamingId(m.id);
                        }
                    }}
                    onContextMenu={(e) => {
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, target: m });
                    }}
                >
                    {expandable ? (
                        <span
                            className="binder-chevron-hit"
                            onClick={(e) => {
                                // Documents only toggle from the chevron.
                                if (!isFolder) {
                                    e.stopPropagation();
                                    onToggle(m.id);
                                }
                            }}
                        >
                            {isOpen ? (
                                <IconChevronDown size={14} className="binder-chevron" />
                            ) : (
                                <IconChevronRight size={14} className="binder-chevron" />
                            )}
                        </span>
                    ) : (
                        <span className="binder-chevron-spacer" />
                    )}
                    {isFolder ? (
                        <>
                            {isKnownIcon(m.icon) ? (
                                <DocIcon id={m.icon} size={15} className="binder-icon" />
                            ) : isTrash ? (
                                <IconTrash size={15} className="binder-icon" />
                            ) : isOpen ? (
                                <IconFolderOpen size={15} className="binder-icon" />
                            ) : (
                                <IconFolder size={15} className="binder-icon" />
                            )}
                        </>
                    ) : (
                        isKnownIcon(m.icon) ? (
                            <DocIcon id={m.icon} size={15} className="binder-icon" />
                        ) : (
                            <IconDocument size={15} className="binder-icon" />
                        )
                    )}
                    {isRenaming ? (
                        <InlineRename
                            initial={m.title}
                            onCommit={(title) => handleRename(m.id, title)}
                            onCancel={() => setRenamingId(null)}
                        />
                    ) : (
                        <span className="binder-title">{m.title}</span>
                    )}
                    {m.word_count > 0 && (
                        <span className="binder-words">{m.word_count}w</span>
                    )}
                </div>
                {expandable && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
            </div>
        );
    }

    return (
        <div className="binder-root" onClick={closeMenu}>
            <div className="binder-header">
                <span className="binder-header-title">Binder</span>
                <div className="binder-header-actions">
                    <button
                        className="subtle binder-header-btn"
                        title="New Document"
                        onClick={() => handleCreate("document")}
                    >
                        <IconPlus size={14} />
                    </button>
                    <button
                        className="subtle binder-header-btn"
                        title="New Folder"
                        onClick={() => handleCreate("folder")}
                    >
                        <IconFolder size={14} />
                    </button>
                    <button
                        className="subtle binder-header-btn"
                        title="Refresh"
                        onClick={onRefresh}
                    >
                        <IconRefresh size={14} />
                    </button>
                </div>
            </div>
            <div className="binder-tree">
                {tree.map((n) => renderNode(n, 0))}
            </div>
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    target={menu.target}
                    onClose={closeMenu}
                    onRename={(id) => {
                        setRenamingId(id);
                        setMenu(null);
                    }}
                    onDuplicate={handleDuplicate}
                    onTrash={handleTrash}
                    onRestore={handleRestore}
                    onPurge={handlePurge}
                    onEmptyTrash={handleEmptyTrash}
                    onSetIcon={handleSetIcon}
                    onCreate={(kind) => handleCreateUnder(menu.target.id, kind)}
                />
            )}
        </div>
    );
}

// ---------------------------------------------------------------------------
// Inline rename
// ---------------------------------------------------------------------------

function InlineRename({
    initial,
    onCommit,
    onCancel,
}: {
    initial: string;
    onCommit: (title: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    return (
        <input
            className="binder-rename-input"
            value={value}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => value.trim() && onCommit(value.trim())}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault();
                    if (value.trim()) onCommit(value.trim());
                    else onCancel();
                } else if (e.key === "Escape") {
                    e.preventDefault();
                    onCancel();
                }
            }}
            onClick={(e) => e.stopPropagation()}
        />
    );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

interface MenuProps {
    x: number;
    y: number;
    target: DocumentMetaDto;
    onClose: () => void;
    onRename: (id: string) => void;
    onDuplicate: (id: string) => void;
    onTrash: (id: string) => void;
    onRestore: (id: string) => void;
    onPurge: (id: string) => void;
    onEmptyTrash: () => void;
    onSetIcon: (id: string, icon: string) => void;
    onCreate: (kind: "document" | "folder") => void;
}

function ContextMenu({
    x,
    y,
    target,
    onClose,
    onRename,
    onDuplicate,
    onTrash,
    onRestore,
    onPurge,
    onEmptyTrash,
    onSetIcon,
    onCreate,
}: MenuProps) {
    const isRoot = kindIsRoot(target.kind);
    const isTrashRoot = target.kind === "trash_root";
    const isFolder = kindIsFolder(target.kind);
    const inTrash = target.in_trash;

    const items: React.ReactNode[] = [];

    if (!isFolder && !inTrash) {
        items.push(
            <MenuItem key="new-subdoc" label="New Subdocument" icon={<IconDocument size={14} />} onClick={() => onCreate("document")} />,
            <MenuSep key="sep-sub" />,
        );
    }

    if (isFolder && !inTrash) {
        items.push(
            <MenuItem key="new-doc" label="New Document" icon={<IconDocument size={14} />} onClick={() => onCreate("document")} />,
            <MenuItem key="new-folder" label="New Folder" icon={<IconFolder size={14} />} onClick={() => onCreate("folder")} />,
            <MenuSep key="sep1" />,
        );
    }

    if (!isRoot && !inTrash) {
        items.push(
            <MenuItem key="rename" label="Rename" onClick={() => onRename(target.id)} />,
            <MenuItem key="duplicate" label="Duplicate" onClick={() => onDuplicate(target.id)} />,
            <MenuItem key="trash" label="Move to Trash" icon={<IconTrash size={14} />} onClick={() => onTrash(target.id)} />,
        );
    }

    if (!inTrash && !isTrashRoot) {
        items.push(
            <MenuSep key="sep-icon" />,
            <Flyout key="icon" label="Change Icon">
                <MenuItem label="Reset Icon to Default" onClick={() => onSetIcon(target.id, "")} />
                <MenuSep />
                {ICON_GROUPS.map((g) => (
                    <Flyout key={g.label} label={g.label} icon={<DocIcon id={groupIconId(g)} size={16} />}>
                        {g.items.map((it) => (
                            <MenuItem
                                key={it.id}
                                label={it.label}
                                icon={<DocIcon id={it.id} size={16} />}
                                checked={target.icon === it.id}
                                onClick={() => onSetIcon(target.id, it.id)}
                            />
                        ))}
                    </Flyout>
                ))}
                <MenuSep />
                {ICON_SINGLES.map((it) => (
                    <MenuItem
                        key={it.id}
                        label={it.label}
                        icon={<DocIcon id={it.id} size={16} />}
                        checked={target.icon === it.id}
                        onClick={() => onSetIcon(target.id, it.id)}
                    />
                ))}
            </Flyout>,
        );
    }

    if (inTrash && !isTrashRoot) {
        items.push(
            <MenuItem key="restore" label="Restore" onClick={() => onRestore(target.id)} />,
            <MenuItem key="purge" label="Delete Permanently" onClick={() => onPurge(target.id)} />,
        );
    }

    if (isTrashRoot) {
        items.push(<MenuItem key="empty" label="Empty Trash" icon={<IconTrash size={14} />} onClick={onEmptyTrash} />);
    }

    if (items.length === 0) {
        return null;
    }

    // Clamp position to viewport.
    const top = Math.min(y, window.innerHeight - (items.length * 28 + 12));
    const left = Math.min(x, window.innerWidth - 220);

    return (
        <>
            <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
            <div className="ctx-menu" style={{ top, left }} onClick={(e) => e.stopPropagation()}>
                {items}
            </div>
        </>
    );
}

function MenuItem({
    label,
    icon,
    checked,
    onClick,
}: {
    label: string;
    icon?: React.ReactNode;
    checked?: boolean;
    onClick: () => void;
}) {
    return (
        <button className={`ctx-item${checked ? " checked" : ""}`} onClick={onClick}>
            {icon && <span className="ctx-item-icon">{icon}</span>}
            <span>{label}</span>
        </button>
    );
}

/// Menu item that opens a nested menu to its right on hover. The nested menu
/// is `position: fixed` (so a scrolling parent never clips it) but stays a
/// DOM child of the item, so moving the pointer into it keeps it open.
function Flyout({
    label,
    icon,
    children,
}: {
    label: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
}) {
    const rowRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const closeTimer = useRef<number | null>(null);
    const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

    const cancelClose = () => {
        if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
        }
    };
    useEffect(() => cancelClose, []);

    function open() {
        cancelClose();
        const rect = rowRef.current?.getBoundingClientRect();
        if (rect) setPos({ left: rect.right - 2, top: rect.top - 5 });
    }

    // Once rendered, keep the nested menu inside the viewport.
    useEffect(() => {
        const el = menuRef.current;
        const row = rowRef.current?.getBoundingClientRect();
        if (!el || !pos || !row) return;
        const r = el.getBoundingClientRect();
        let { left, top } = pos;
        if (r.right > window.innerWidth - 4) left = Math.max(4, row.left - r.width + 2);
        if (r.bottom > window.innerHeight - 4) top = Math.max(4, window.innerHeight - r.height - 4);
        if (left !== pos.left || top !== pos.top) setPos({ left, top });
    }, [pos]);

    return (
        <div
            ref={rowRef}
            className={`ctx-flyout${pos ? " open" : ""}`}
            onMouseEnter={open}
            onMouseLeave={() => {
                cancelClose();
                closeTimer.current = window.setTimeout(() => setPos(null), 180);
            }}
        >
            <button className="ctx-item" onClick={open}>
                <span className="ctx-item-icon">{icon}</span>
                <span>{label}</span>
                <IconChevronRight size={12} className="ctx-item-arrow" />
            </button>
            {pos && (
                <div ref={menuRef} className="ctx-menu ctx-submenu" style={{ left: pos.left, top: pos.top }}>
                    {children}
                </div>
            )}
        </div>
    );
}

function MenuSep() {
    return <div className="ctx-sep" />;
}
