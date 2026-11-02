/// Wiki-style links in the editor: `[[Title]]` or `[[Title|shown text]]`.
///
/// - Links are plain text in the document (so they survive any export) and
///   are highlighted with decorations; a link to a title no document has is
///   drawn as broken.
/// - Ctrl+click (Cmd+click) follows a link; the workspace decides what that
///   does (open the document, or offer to create it).
/// - Typing `[[` opens a list of document titles that narrows as you type;
///   Up/Down choose, Enter or Tab insert, Escape closes it.
///
/// The list of link targets (titles of the documents outside the Trash) is
/// shared by every editor and set by the workspace whenever the binder
/// changes.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { t } from "../i18n";

export interface LinkTarget {
    id: string;
    title: string;
    kind: string;
    /** Sheet kind ("character", "place"…), for the icon in the list. */
    sheet: string | null;
}

const LINK_RE = /\[\[([^[\]|\n]+)(?:\|([^[\]\n]*))?\]\]/g;
const OPEN_RE = /\[\[([^[\]|\n]*)$/;

let targets: LinkTarget[] = [];
let byTitle = new Map<string, LinkTarget>();
let follow: ((title: string, target: LinkTarget | null) => void) | null = null;
const views = new Set<EditorView>();

export const wikiKey = new PluginKey<DecorationSet>("sfWikiLinks");

const norm = (s: string) => s.trim().toLowerCase();

/** Replace the list of link targets and redraw every editor's links. */
export function setLinkTargets(list: LinkTarget[]) {
    targets = list;
    byTitle = new Map();
    for (const t of list) if (!byTitle.has(norm(t.title))) byTitle.set(norm(t.title), t);
    views.forEach((v) => v.dispatch(v.state.tr.setMeta(wikiKey, "refresh")));
}

export function setLinkFollower(fn: ((title: string, target: LinkTarget | null) => void) | null) {
    follow = fn;
}

export function resolveLink(title: string): LinkTarget | null {
    return byTitle.get(norm(title)) ?? null;
}

/** Titles matching what was typed after `[[`: prefix matches first. */
export function matchTargets(query: string, limit = 8): LinkTarget[] {
    const q = norm(query);
    const starts: LinkTarget[] = [];
    const contains: LinkTarget[] = [];
    for (const t of targets) {
        const n = norm(t.title);
        if (!q || n.startsWith(q)) starts.push(t);
        else if (n.includes(q)) contains.push(t);
    }
    return [...starts, ...contains].slice(0, limit);
}

function buildDecorations(state: EditorState): DecorationSet {
    const decos: Decoration[] = [];
    state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (node.type.spec.code) return false;
        const text = state.doc.textBetween(pos + 1, pos + node.nodeSize - 1, undefined, "￼");
        for (const m of text.matchAll(LINK_RE)) {
            const from = pos + 1 + (m.index ?? 0);
            const title = m[1].trim();
            if (!title) continue;
            const target = resolveLink(title);
            decos.push(
                Decoration.inline(from, from + m[0].length, {
                    class: target ? "sf-wikilink" : "sf-wikilink broken",
                    title: target
                        ? t("Ctrl+click to open “{title}”", { title: target.title })
                        : t("No document is called “{title}”. Ctrl+click to create it.", { title }),
                }, { title }),
            );
        }
        return false;
    });
    return DecorationSet.create(state.doc, decos);
}

// ---------------------------------------------------------------------------
// Autocomplete after "[["
// ---------------------------------------------------------------------------

export interface LinkQuery {
    /** Text typed after `[[`. */
    query: string;
    /** Document position right after `[[`. */
    from: number;
    items: LinkTarget[];
    index: number;
}

const queries = new WeakMap<EditorView, LinkQuery | null>();
const listeners = new WeakMap<EditorView, (q: LinkQuery | null) => void>();
/** Position of a `[[` whose list was closed with Escape. */
const dismissed = new WeakMap<EditorView, number>();

/** Receive the autocomplete state of an editor (null when closed). */
export function onLinkQuery(view: EditorView, fn: ((q: LinkQuery | null) => void) | null) {
    if (fn) listeners.set(view, fn);
    else listeners.delete(view);
}

function setQuery(view: EditorView, q: LinkQuery | null) {
    queries.set(view, q);
    listeners.get(view)?.(q);
}

function updateQuery(view: EditorView) {
    const { state } = view;
    const sel = state.selection;
    if (!sel.empty || !view.editable) return setQuery(view, null);
    const $from = sel.$from;
    if ($from.parent.type.spec.code) return setQuery(view, null);
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, "￼");
    const m = OPEN_RE.exec(before);
    if (!m) return setQuery(view, null);
    const from = sel.from - m[1].length;
    if (dismissed.get(view) === from) return setQuery(view, null);
    const prev = queries.get(view);
    const items = matchTargets(m[1]);
    const index = prev && prev.from === from ? Math.min(prev.index, Math.max(0, items.length - 1)) : 0;
    setQuery(view, { query: m[1], from, items, index });
}

/** Insert the chosen title and close the brackets. */
export function acceptLink(view: EditorView, target: LinkTarget) {
    const q = queries.get(view);
    if (!q) return;
    const { state } = view;
    const to = state.selection.from;
    const after = state.doc.textBetween(to, Math.min(to + 2, state.selection.$from.end()));
    const end = after === "]]" ? to + 2 : to;
    view.dispatch(state.tr.insertText(`${target.title}]]`, q.from, end));
    setQuery(view, null);
    view.focus();
}

export const SfWikiLinks = Extension.create({
    name: "sfWikiLinks",

    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: wikiKey,
                state: {
                    init: (_, state) => buildDecorations(state),
                    apply(tr, set, _old, state) {
                        if (tr.docChanged || tr.getMeta(wikiKey)) return buildDecorations(state);
                        return set;
                    },
                },
                props: {
                    decorations(state) {
                        return wikiKey.getState(state);
                    },
                    handleClick(view, pos, event) {
                        if (!(event.ctrlKey || event.metaKey)) return false;
                        const found = wikiKey.getState(view.state)?.find(pos, pos)[0];
                        if (!found) return false;
                        const title = (found.spec as { title: string }).title;
                        follow?.(title, resolveLink(title));
                        return true;
                    },
                    handleKeyDown(view, event) {
                        const q = queries.get(view);
                        if (!q) return false;
                        if (event.key === "Escape") {
                            dismissed.set(view, q.from);
                            setQuery(view, null);
                            return true;
                        }
                        if (q.items.length === 0) return false;
                        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                            const d = event.key === "ArrowDown" ? 1 : -1;
                            setQuery(view, { ...q, index: (q.index + d + q.items.length) % q.items.length });
                            return true;
                        }
                        if (event.key === "Enter" || event.key === "Tab") {
                            acceptLink(view, q.items[q.index]);
                            return true;
                        }
                        return false;
                    },
                },
                view(view) {
                    views.add(view);
                    return {
                        update(v, prev) {
                            if (!v.state.doc.eq(prev.doc) || !v.state.selection.eq(prev.selection)) updateQuery(v);
                        },
                        destroy() {
                            views.delete(view);
                            setQuery(view, null);
                        },
                    };
                },
            }),
        ];
    },
});
