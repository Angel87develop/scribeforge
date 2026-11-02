/// Helpers shared by the views that work on the binder tree (Binder,
/// Outliner, Scrivenings, Compile): kind checks, tree-order traversal and the
/// drag-and-drop rules.

import type { DocumentMetaDto } from "../services/api";
import { t } from "../i18n";

export function isFolderKind(kind: string): boolean {
    return kind === "folder" || kind === "draft_root" || kind === "research_root" || kind === "trash_root";
}

export function isRootKind(kind: string): boolean {
    return kind === "draft_root" || kind === "research_root" || kind === "trash_root";
}

/** The names the three root folders are created with (in `model.rs`). */
const ROOT_DEFAULT_TITLES: Record<string, string> = {
    draft_root: "Manuscript",
    research_root: "Research",
    trash_root: "Trash",
};

/** Title to show for a binder item. The root folders are stored with their
 *  English default names, so those are shown translated; any other title,
 *  including a root the user renamed, is shown as written. */
export function displayTitle(m: { kind: string; title: string }): string {
    return ROOT_DEFAULT_TITLES[m.kind] === m.title ? t(m.title) : m.title;
}

/** Children of `parent`, in binder order. */
export function childrenOf(binder: DocumentMetaDto[], parent: string | null): DocumentMetaDto[] {
    return binder.filter((d) => d.parent === parent).sort((a, b) => a.order - b.order);
}

export interface TreeRow {
    meta: DocumentMetaDto;
    /** 0 for the direct children of the root. */
    depth: number;
    hasChildren: boolean;
}

/** Every descendant of `rootId`, parents before children, in binder order. */
export function descendants(binder: DocumentMetaDto[], rootId: string): TreeRow[] {
    const byParent = new Map<string | null, DocumentMetaDto[]>();
    for (const d of binder) {
        const arr = byParent.get(d.parent) ?? [];
        arr.push(d);
        byParent.set(d.parent, arr);
    }
    for (const arr of byParent.values()) arr.sort((a, b) => a.order - b.order);
    const out: TreeRow[] = [];
    const walk = (parent: string, depth: number) => {
        for (const d of byParent.get(parent) ?? []) {
            const kids = byParent.get(d.id) ?? [];
            out.push({ meta: d, depth, hasChildren: kids.length > 0 });
            walk(d.id, depth + 1);
        }
    };
    walk(rootId, 0);
    return out;
}

/** True if `ancestor` is `id` or one of its ancestors. */
export function isAncestorOf(binder: DocumentMetaDto[], ancestor: string, id: string): boolean {
    const byId = new Map(binder.map((d) => [d.id, d]));
    let cur: string | null = id;
    while (cur) {
        if (cur === ancestor) return true;
        cur = byId.get(cur)?.parent ?? null;
    }
    return false;
}

export type DropZone = "before" | "into" | "after";

/** Where on a row the pointer is: top quarter, middle, bottom quarter. */
export function dropZoneAt(e: React.DragEvent, allowSiblings: boolean): DropZone {
    if (!allowSiblings) return "into";
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const f = (e.clientY - rect.top) / Math.max(1, rect.height);
    if (f < 0.25) return "before";
    if (f > 0.75) return "after";
    return "into";
}

export type DropPlan =
    | { kind: "move"; parent: string; index: number }
    | { kind: "trash" };

/**
 * Decide what dropping `draggedId` on `targetId` does. Returns null when the
 * drop is not allowed (roots, cycles, inside a trashed folder…).
 *
 * `index` is the position among the new siblings not counting the dragged
 * node, which is what `move_document` expects.
 */
export function planDrop(
    binder: DocumentMetaDto[],
    draggedId: string,
    targetId: string,
    zone: DropZone,
): DropPlan | null {
    const dragged = binder.find((d) => d.id === draggedId);
    const target = binder.find((d) => d.id === targetId);
    if (!dragged || !target || draggedId === targetId) return null;
    if (isRootKind(dragged.kind)) return null;
    // Roots only accept drops into them.
    const z: DropZone = isRootKind(target.kind) ? "into" : zone;
    const parentId = z === "into" ? target.id : target.parent;
    if (!parentId) return null;
    // Never into itself or its own subtree.
    if (isAncestorOf(binder, draggedId, parentId)) return null;
    const parent = binder.find((d) => d.id === parentId);
    if (!parent) return null;
    if (parent.kind === "trash_root") return dragged.in_trash ? null : { kind: "trash" };
    if (parent.in_trash) return null;

    const siblings = childrenOf(binder, parentId).filter((d) => d.id !== draggedId);
    let index: number;
    if (z === "into") {
        index = siblings.length;
    } else {
        const at = siblings.findIndex((d) => d.id === targetId);
        index = z === "before" ? at : at + 1;
    }
    return { kind: "move", parent: parentId, index: Math.max(0, index) };
}
