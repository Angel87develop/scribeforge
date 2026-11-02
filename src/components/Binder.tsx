/// Binder: hierarchical project tree with full CRUD.
///
/// Features:
/// - Expand/collapse folders, click to select, double-click to rename inline.
/// - Documents can hold sub-documents ("New Subdocument"); any row with
///   children gets an expand chevron.
/// - Drag-and-drop: the top or bottom edge of a row reorders, the middle
///   drops the item inside the row, so a document dropped on another
///   document becomes its subdocument (with cycle rules).
/// - Right-click context menu adapted to the node kind (Document, Folder,
///   Trash, Root, etc.).
/// - "Change Icon" submenu: custom per-document icons (see DocIcons).
/// - Header with New Document / New Folder buttons (targeted at the current
///   selection, or Draft root if nothing is selected).
/// - Roots (Draft / Research / Trash) cannot be deleted, renamed, or moved.
/// - Each row shows its label colour and its status (see Labels and Status).
/// - Collection tabs above the tree: a manual collection lists the documents
///   added to it; a saved search lists whatever matches it now. Right-click
///   a tab to edit, move or delete it.
/// - Character and place sheets can be created from the context menu.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Collection, type DocumentMetaDto } from "../services/api";
import { CollectionDialog } from "../dialogs/CollectionDialog";
import { LabelDot, StatusBadge } from "./OrgBadges";
import { addSheet, createSheet, type SheetKind } from "./sheetTemplates";
import { displayTitle, dropZoneAt, planDrop, type DropZone } from "./binderTree";
import { DocIcon, groupIconId, ICON_GROUPS, ICON_SINGLES, isKnownIcon } from "./DocIcons";
import {
    IconChevronDown,
    IconChevronRight,
    IconDocument,
    IconFolder,
    IconFolderOpen,
    IconPlus,
    IconRefresh,
    IconSearch,
    IconTrash,
} from "./Icons";
import "../styles/binder.css";
import "../styles/organization.css";
import { t } from "../i18n";

const TAB_KEY = "sf.binder.collection";

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
    const [dropHint, setDropHint] = useState<{ id: string; zone: DropZone } | null>(null);

    // ----- Collections -----
    const [collections, setCollections] = useState<Collection[]>([]);
    const [activeTab, setActiveTab] = useState<string | null>(() => localStorage.getItem(TAB_KEY));
    const [items, setItems] = useState<DocumentMetaDto[]>([]);
    const [collectionDialog, setCollectionDialog] = useState<
        { collection: Collection | null; kind: "manual" | "search"; items?: string[] } | null
    >(null);
    const [tabMenu, setTabMenu] = useState<{ x: number; y: number; collection: Collection } | null>(null);
    const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
    const active = collections.find((c) => c.id === activeTab) ?? null;

    useEffect(() => {
        api.listCollections()
            .then(setCollections)
            .catch(() => undefined);
    }, []);

    const chooseTab = useCallback((id: string | null) => {
        setActiveTab(id);
        if (id) localStorage.setItem(TAB_KEY, id);
        else localStorage.removeItem(TAB_KEY);
    }, []);

    // Re-evaluate the active collection whenever the binder changes.
    useEffect(() => {
        if (!active) {
            setItems([]);
            return;
        }
        let cancelled = false;
        api.collectionItems(active.id)
            .then((list) => !cancelled && setItems(list))
            .catch((e) => onError(String(e)));
        return () => {
            cancelled = true;
        };
    }, [active, binder, onError]);

    async function collectionAction(p: Promise<Collection[]>) {
        try {
            setCollections(await p);
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleNewSheet(parent: string, kind: SheetKind) {
        setMenu(null);
        try {
            const id = await createSheet(binder, parent, kind);
            if (!expanded.has(parent)) onToggle(parent);
            onRefresh();
            onSelect(id, "document");
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleAddSheet(target: DocumentMetaDto, kind: SheetKind) {
        setMenu(null);
        try {
            await addSheet(target, kind);
            onRefresh();
            onSelect(target.id, target.kind);
        } catch (e) {
            onError(String(e));
        }
    }

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
            onError(t("No suitable parent folder. Select a folder first."));
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
        if (!confirm(t("Delete permanently? This cannot be undone."))) return;
        try {
            await api.purgeDocument(id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleEmptyTrash() {
        if (!confirm(t("Empty the Trash? All items will be permanently deleted."))) return;
        try {
            await api.emptyTrash();
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    function startDrag(e: React.DragEvent, id: string) {
        dragId.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
    }

    // Dropping on the top or bottom quarter of a row reorders; dropping on
    // the middle puts the item inside the row (folder or document alike).
    async function handleDrop(targetId: string, zone: DropZone) {
        const dragging = dragId.current;
        dragId.current = null;
        setDropHint(null);
        if (!dragging) return;
        const plan = planDrop(binder, dragging, targetId, zone);
        if (!plan) return;
        try {
            if (plan.kind === "trash") {
                await api.moveToTrash(dragging);
            } else {
                await api.moveDocument(dragging, plan.parent, plan.index);
                if (zone === "into" && !expanded.has(plan.parent)) onToggle(plan.parent);
            }
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
        const hint = dropHint?.id === m.id ? ` drop-${dropHint.zone}` : "";

        return (
            <div key={m.id}>
                <div
                    className={`binder-row${isSelected ? " selected" : ""}${m.in_trash ? " in-trash" : ""}${hint}`}
                    style={{ paddingLeft: 4 + depth * 16 }}
                    draggable={!isRoot}
                    onDragStart={(e) => startDrag(e, m.id)}
                    onDragEnd={() => {
                        dragId.current = null;
                        setDropHint(null);
                    }}
                    onDragOver={(e) => {
                        const dragging = dragId.current;
                        if (!dragging) return;
                        const zone = dropZoneAt(e, !isRoot);
                        if (!planDrop(binder, dragging, m.id, zone)) {
                            if (dropHint) setDropHint(null);
                            return;
                        }
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        if (dropHint?.id !== m.id || dropHint.zone !== zone) {
                            setDropHint({ id: m.id, zone });
                        }
                    }}
                    onDragLeave={(e) => {
                        if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
                            setDropHint((h) => (h?.id === m.id ? null : h));
                        }
                    }}
                    onDrop={(e) => {
                        e.preventDefault();
                        handleDrop(m.id, dropZoneAt(e, !isRoot));
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
                        <span className="binder-title">{displayTitle(m)}</span>
                    )}
                    {!isRoot && <LabelDot name={m.labels[0]} />}
                    {!isRoot && !m.in_trash && <StatusBadge name={m.status} compact />}
                    {m.word_count > 0 && (
                        <span className="binder-words">{t("{n}w", { n: m.word_count })}</span>
                    )}
                </div>
                {expandable && isOpen && node.children.map((c) => renderNode(c, depth + 1))}
            </div>
        );
    }

    return (
        <div className="binder-root" onClick={closeMenu}>
            <div className="binder-header">
                <span className="binder-header-title">{t("Binder")}</span>
                <div className="binder-header-actions">
                    <button
                        className="subtle binder-header-btn"
                        title={t("New Document")}
                        onClick={() => handleCreate("document")}
                    >
                        <IconPlus size={14} />
                    </button>
                    <button
                        className="subtle binder-header-btn"
                        title={t("New Folder")}
                        onClick={() => handleCreate("folder")}
                    >
                        <IconFolder size={14} />
                    </button>
                    <button
                        className="subtle binder-header-btn"
                        title={t("Refresh")}
                        onClick={onRefresh}
                    >
                        <IconRefresh size={14} />
                    </button>
                </div>
            </div>
            <div className="collection-tabs" role="tablist" aria-label={t("Binder and collections")}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={!active}
                    className={`collection-tab${!active ? " active" : ""}`}
                    onClick={() => chooseTab(null)}
                >
                    {t("Binder")}
                </button>
                {collections.map((c) => (
                    <button
                        key={c.id}
                        type="button"
                        role="tab"
                        aria-selected={active?.id === c.id}
                        className={`collection-tab${active?.id === c.id ? " active" : ""}`}
                        title={c.kind === "search" ? t("{name} (saved search)", { name: c.name }) : c.name}
                        onClick={() => chooseTab(c.id)}
                        onDoubleClick={() => setCollectionDialog({ collection: c, kind: c.kind })}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setTabMenu({ x: e.clientX, y: e.clientY, collection: c });
                        }}
                    >
                        {c.color && <span className="label-dot" style={{ background: c.color }} />}
                        {c.kind === "search" && <IconSearch size={11} />}
                        {c.name}
                    </button>
                ))}
                <button
                    type="button"
                    className="collection-tab add"
                    title={t("New collection or saved search")}
                    aria-label={t("New collection or saved search")}
                    onClick={(e) => {
                        const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                        setAddMenu({ x: r.left, y: r.bottom + 2 });
                    }}
                >
                    <IconPlus size={12} />
                </button>
            </div>
            {active ? (
                <div className="binder-tree collection-list">
                    {items.length === 0 && (
                        <div className="collection-empty">
                            {active.kind === "search"
                                ? t("Nothing matches this search right now.")
                                : t("Empty. Right-click documents in the binder and choose Add to Collection.")}
                        </div>
                    )}
                    {items.map((m) => (
                        <div
                            key={m.id}
                            className={`binder-row${selectedId === m.id ? " selected" : ""}`}
                            style={{ paddingLeft: 8 }}
                            onClick={() => onSelect(m.id, m.kind)}
                            onContextMenu={(e) => {
                                e.preventDefault();
                                if (active.kind === "manual") setMenu({ x: e.clientX, y: e.clientY, target: m });
                            }}
                        >
                            {isKnownIcon(m.icon) ? (
                                <DocIcon id={m.icon} size={15} className="binder-icon" />
                            ) : kindIsFolder(m.kind) ? (
                                <IconFolder size={15} className="binder-icon" />
                            ) : (
                                <IconDocument size={15} className="binder-icon" />
                            )}
                            <span className="binder-title">{m.title}</span>
                            <LabelDot name={m.labels[0]} />
                            <StatusBadge name={m.status} compact />
                            {m.word_count > 0 && (
                                <span className="binder-words">{t("{n}w", { n: m.word_count })}</span>
                            )}
                        </div>
                    ))}
                </div>
            ) : (
                <div className="binder-tree">{tree.map((n) => renderNode(n, 0))}</div>
            )}
            {addMenu && (
                <>
                    <div className="ctx-backdrop" onClick={() => setAddMenu(null)} />
                    <div className="ctx-menu" style={{ left: addMenu.x, top: addMenu.y }}>
                        <MenuItem
                            label={t("New Collection…")}
                            onClick={() => {
                                setAddMenu(null);
                                setCollectionDialog({ collection: null, kind: "manual" });
                            }}
                        />
                        <MenuItem
                            label={t("New Saved Search…")}
                            icon={<IconSearch size={13} />}
                            onClick={() => {
                                setAddMenu(null);
                                setCollectionDialog({ collection: null, kind: "search" });
                            }}
                        />
                    </div>
                </>
            )}
            {tabMenu && (
                <>
                    <div className="ctx-backdrop" onClick={() => setTabMenu(null)} />
                    <div className="ctx-menu" style={{ left: tabMenu.x, top: tabMenu.y }}>
                        <MenuItem
                            label={t("Edit…")}
                            onClick={() => {
                                setCollectionDialog({ collection: tabMenu.collection, kind: tabMenu.collection.kind });
                                setTabMenu(null);
                            }}
                        />
                        <MenuItem
                            label={t("Move Left")}
                            onClick={() => {
                                const i = collections.findIndex((c) => c.id === tabMenu.collection.id);
                                collectionAction(api.moveCollection(tabMenu.collection.id, Math.max(0, i - 1)));
                                setTabMenu(null);
                            }}
                        />
                        <MenuItem
                            label={t("Move Right")}
                            onClick={() => {
                                const i = collections.findIndex((c) => c.id === tabMenu.collection.id);
                                collectionAction(api.moveCollection(tabMenu.collection.id, i + 1));
                                setTabMenu(null);
                            }}
                        />
                        <MenuSep />
                        <MenuItem
                            label={t("Delete Collection")}
                            icon={<IconTrash size={13} />}
                            onClick={() => {
                                const c = tabMenu.collection;
                                setTabMenu(null);
                                if (!confirm(t("Delete the collection “{name}”? The documents in it are not deleted.", { name: c.name }))) return;
                                if (activeTab === c.id) chooseTab(null);
                                collectionAction(api.deleteCollection(c.id));
                            }}
                        />
                    </div>
                </>
            )}
            {collectionDialog && (
                <CollectionDialog
                    collection={collectionDialog.collection}
                    kind={collectionDialog.kind}
                    initialItems={collectionDialog.items}
                    onSaved={(list, id) => {
                        setCollections(list);
                        chooseTab(id);
                    }}
                    onClose={() => setCollectionDialog(null)}
                    onError={onError}
                />
            )}
            {menu && (
                <ContextMenu
                    x={menu.x}
                    y={menu.y}
                    target={menu.target}
                    collections={collections.filter((c) => c.kind === "manual")}
                    activeCollection={active?.kind === "manual" ? active : null}
                    onAddToCollection={(cid) => {
                        setMenu(null);
                        collectionAction(api.addToCollection(cid, [menu.target.id]));
                    }}
                    onNewCollectionWith={() => {
                        const id = menu.target.id;
                        setMenu(null);
                        setCollectionDialog({ collection: null, kind: "manual", items: [id] });
                    }}
                    onRemoveFromCollection={(cid) => {
                        setMenu(null);
                        collectionAction(api.removeFromCollection(cid, menu.target.id));
                    }}
                    onNewSheet={(kind) => handleNewSheet(menu.target.id, kind)}
                    onAddSheet={(kind) => handleAddSheet(menu.target, kind)}
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
    /** Manual collections the target can be added to. */
    collections: Collection[];
    /** The manual collection being shown, if any. */
    activeCollection: Collection | null;
    onAddToCollection: (collectionId: string) => void;
    onNewCollectionWith: () => void;
    onRemoveFromCollection: (collectionId: string) => void;
    onNewSheet: (kind: SheetKind) => void;
    onAddSheet: (kind: SheetKind) => void;
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
    collections,
    activeCollection,
    onAddToCollection,
    onNewCollectionWith,
    onRemoveFromCollection,
    onNewSheet,
    onAddSheet,
}: MenuProps) {
    const isRoot = kindIsRoot(target.kind);
    const isTrashRoot = target.kind === "trash_root";
    const isFolder = kindIsFolder(target.kind);
    const inTrash = target.in_trash;

    const items: React.ReactNode[] = [];

    if (activeCollection) {
        items.push(
            <MenuItem
                key="remove-from-collection"
                label={t("Remove from “{name}”", { name: activeCollection.name })}
                onClick={() => onRemoveFromCollection(activeCollection.id)}
            />,
        );
        // Opening the menu from a collection list: nothing else applies.
        const top = Math.min(y, window.innerHeight - 40);
        const left = Math.min(x, window.innerWidth - 240);
        return (
            <>
                <div className="ctx-backdrop" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
                <div className="ctx-menu" style={{ top, left }} onClick={(e) => e.stopPropagation()}>
                    {items}
                </div>
            </>
        );
    }

    if (!isFolder && !inTrash) {
        items.push(
            <MenuItem key="new-subdoc" label={t("New Subdocument")} icon={<IconDocument size={14} />} onClick={() => onCreate("document")} />,
            <MenuSep key="sep-sub" />,
        );
    }

    if (isFolder && !inTrash && !isTrashRoot) {
        items.push(
            <MenuItem key="new-doc" label={t("New Document")} icon={<IconDocument size={14} />} onClick={() => onCreate("document")} />,
            <MenuItem key="new-folder" label={t("New Folder")} icon={<IconFolder size={14} />} onClick={() => onCreate("folder")} />,
            <MenuItem
                key="new-character"
                label={t("New Character Sheet")}
                icon={<DocIcon id="character:sheet" size={14} />}
                onClick={() => onNewSheet("character")}
            />,
            <MenuItem
                key="new-place"
                label={t("New Place Sheet")}
                icon={<DocIcon id="location:sheet" size={14} />}
                onClick={() => onNewSheet("place")}
            />,
            <MenuSep key="sep1" />,
        );
    }

    if (!isFolder && !inTrash && !target.sheet_kind) {
        items.push(
            <Flyout key="add-sheet" label={t("Add Sheet")}>
                <MenuItem label={t("Character Sheet")} icon={<DocIcon id="character:sheet" size={14} />} onClick={() => onAddSheet("character")} />
                <MenuItem label={t("Place Sheet")} icon={<DocIcon id="location:sheet" size={14} />} onClick={() => onAddSheet("place")} />
            </Flyout>,
        );
    }

    if (!isRoot && !inTrash) {
        items.push(
            <Flyout key="add-to-collection" label={t("Add to Collection")}>
                {collections.map((c) => (
                    <MenuItem
                        key={c.id}
                        label={c.name}
                        icon={c.color ? <span className="label-dot" style={{ background: c.color }} /> : undefined}
                        checked={c.items.includes(target.id)}
                        onClick={() => onAddToCollection(c.id)}
                    />
                ))}
                {collections.length > 0 && <MenuSep />}
                <MenuItem label={t("New Collection…")} onClick={onNewCollectionWith} />
            </Flyout>,
            <MenuSep key="sep-coll" />,
        );
    }

    if (!isRoot && !inTrash) {
        items.push(
            <MenuItem key="rename" label={t("Rename")} onClick={() => onRename(target.id)} />,
            <MenuItem key="duplicate" label={t("Duplicate")} onClick={() => onDuplicate(target.id)} />,
            <MenuItem key="trash" label={t("Move to Trash")} icon={<IconTrash size={14} />} onClick={() => onTrash(target.id)} />,
        );
    }

    if (!inTrash && !isTrashRoot) {
        items.push(
            <MenuSep key="sep-icon" />,
            <Flyout key="icon" label={t("Change Icon")}>
                <MenuItem label={t("Reset Icon to Default")} onClick={() => onSetIcon(target.id, "")} />
                <MenuSep />
                {ICON_GROUPS.map((g) => (
                    <Flyout key={g.label} label={t(g.label)} icon={<DocIcon id={groupIconId(g)} size={16} />}>
                        {g.items.map((it) => (
                            <MenuItem
                                key={it.id}
                                label={t(it.label)}
                                icon={<DocIcon id={it.id} size={16} />}
                                checked={target.icon === it.id}
                                onClick={() => onSetIcon(target.id, it.id)}
                            />
                        ))}
                    </Flyout>
                ))}
                <MenuSep />
                {[...ICON_SINGLES].sort((a, b) => t(a.label).localeCompare(t(b.label))).map((it) => (
                    <MenuItem
                        key={it.id}
                        label={t(it.label)}
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
            <MenuItem key="restore" label={t("Restore")} onClick={() => onRestore(target.id)} />,
            <MenuItem key="purge" label={t("Delete Permanently")} onClick={() => onPurge(target.id)} />,
        );
    }

    if (isTrashRoot) {
        items.push(<MenuItem key="empty" label={t("Empty Trash")} icon={<IconTrash size={14} />} onClick={onEmptyTrash} />);
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
