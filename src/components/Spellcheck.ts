/// Spell checking inside the editor.
///
/// A ProseMirror plugin collects the words of the document, asks the Rust
/// core which ones are misspelled (Hunspell dictionaries for Spanish and
/// English, plus the project's personal dictionary) and underlines them with
/// inline decorations. Answers are cached per word and shared by every open
/// editor, so after the first check only new words reach the backend.
///
/// The word being typed is not underlined until the cursor leaves it. The
/// WebView's own spell checker is turned off on the editor so it never draws
/// a second underline.

import { Extension } from "@tiptap/core";
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { api } from "../services/api";

/** Letters (any script, with accents) joined by inner apostrophes. */
const WORD_RE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu;

/** word → misspelled? */
const cache = new Map<string, boolean>();
/** Words ignored for this run of the app ("Ignore" in the context menu). */
const ignored = new Set<string>();
let enabled = true;
const views = new Set<EditorView>();

export const spellKey = new PluginKey<DecorationSet>("sfSpellcheck");

interface SpellMeta {
    decorations: DecorationSet;
}

/** Forget cached answers (language or dictionary changed) and recheck. */
export function resetSpellcheck(on: boolean) {
    enabled = on;
    cache.clear();
    views.forEach((v) => scheduleCheck(v, 0));
}

/** A word was added to the personal dictionary or ignored. */
export function acceptWord(word: string, mode: "dictionary" | "ignore") {
    if (mode === "ignore") ignored.add(word);
    cache.set(word, false);
    views.forEach((v) => scheduleCheck(v, 0));
}

/** The misspelled word under a document position, if any. */
export function misspelledAt(state: EditorState, pos: number): { from: number; to: number; word: string } | null {
    const set = spellKey.getState(state);
    if (!set) return null;
    const found = set.find(pos, pos);
    const d = found[0];
    if (!d) return null;
    return { from: d.from, to: d.to, word: (d.spec as { word: string }).word };
}

interface WordAt {
    from: number;
    to: number;
    word: string;
}

function collectWords(state: EditorState): WordAt[] {
    const out: WordAt[] = [];
    const codeMark = state.schema.marks.code;
    state.doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        if (node.type.spec.code) return false;
        // One character per position: text as is, every leaf as one char.
        const text = state.doc.textBetween(pos + 1, pos + node.nodeSize - 1, undefined, "￼");
        for (const m of text.matchAll(WORD_RE)) {
            const from = pos + 1 + (m.index ?? 0);
            const to = from + m[0].length;
            if (codeMark && state.doc.rangeHasMark(from, to, codeMark)) continue;
            out.push({ from, to, word: m[0] });
        }
        return false;
    });
    return out;
}

const timers = new WeakMap<EditorView, number>();
const lastTyping = new WeakMap<EditorView, number>();

function scheduleCheck(view: EditorView, delay: number) {
    const t = timers.get(view);
    if (t !== undefined) window.clearTimeout(t);
    timers.set(
        view,
        window.setTimeout(() => {
            timers.delete(view);
            void check(view);
        }, delay),
    );
}

async function check(view: EditorView) {
    if (!views.has(view)) return;
    if (!enabled) {
        view.dispatch(view.state.tr.setMeta(spellKey, { decorations: DecorationSet.empty } as SpellMeta));
        return;
    }
    const words = collectWords(view.state);
    const unknown = [...new Set(words.map((w) => w.word))].filter((w) => !cache.has(w) && !ignored.has(w));
    if (unknown.length > 0) {
        try {
            // Batches keep each call small on long documents.
            for (let i = 0; i < unknown.length; i += 2000) {
                const batch = unknown.slice(i, i + 2000);
                const bad = new Set(await api.spellCheck(batch));
                for (const w of batch) cache.set(w, bad.has(w));
            }
        } catch {
            return; // No project or no backend (browser preview): stay quiet.
        }
    }
    if (!views.has(view)) return;
    // The document may have changed while waiting; recollect positions.
    const state = view.state;
    const typing = Date.now() - (lastTyping.get(view) ?? 0) < 1500;
    const head = state.selection.head;
    const decos: Decoration[] = [];
    for (const w of collectWords(state)) {
        if (!cache.get(w.word) || ignored.has(w.word)) continue;
        if (typing && head >= w.from && head <= w.to) continue;
        decos.push(Decoration.inline(w.from, w.to, { class: "sf-misspelled" }, { word: w.word }));
    }
    view.dispatch(
        state.tr.setMeta(spellKey, { decorations: DecorationSet.create(state.doc, decos) } as SpellMeta),
    );
    // Recheck once typing settles, so the last word gets its underline.
    if (typing) scheduleCheck(view, 1600);
}

export const SfSpellcheck = Extension.create({
    name: "sfSpellcheck",

    addProseMirrorPlugins() {
        return [
            new Plugin<DecorationSet>({
                key: spellKey,
                state: {
                    init: () => DecorationSet.empty,
                    apply(tr, set) {
                        const meta = tr.getMeta(spellKey) as SpellMeta | undefined;
                        if (meta) return meta.decorations;
                        return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
                    },
                },
                props: {
                    decorations(state) {
                        return spellKey.getState(state);
                    },
                },
                view(view) {
                    views.add(view);
                    scheduleCheck(view, 300);
                    return {
                        update(v, prev) {
                            if (!v.state.doc.eq(prev.doc)) {
                                lastTyping.set(v, Date.now());
                                scheduleCheck(v, 500);
                            }
                        },
                        destroy() {
                            views.delete(view);
                            const t = timers.get(view);
                            if (t !== undefined) window.clearTimeout(t);
                        },
                    };
                },
            }),
        ];
    },
});
