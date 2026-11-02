/// Rich-text editor built on Tiptap (ProseMirror).
///
/// Design goals (vs the previous execCommand editor):
/// - The editor instance is created once per `documentId` (the parent mounts
///   it with `key={doc.id}`) and stays mounted while the document is open —
///   no innerHTML rewrite on autosave, no caret jumps.
/// - Toolbar buttons use `onMouseDown={e => e.preventDefault()}` so the
///   editor never loses focus or selection. Single-click works.
/// - Format state is driven by editor events (`onSelectionUpdate`,
///   `onTransaction`), not by polling `document.queryCommandState`.
/// - Content is converted to/from the Rust `RichDoc` model only at the
///   boundaries (open document, debounced autosave, flush on unmount/switch).
///   Only edits are pushed back: an editor that is remounted after the text
///   changed elsewhere (find and replace, restoring a snapshot) never writes
///   its stale copy over the new one.
/// - Writing aids: spell checking with a suggestions menu on right-click,
///   smart typography, margin comments (when the parent passes `comments`)
///   and typewriter scrolling (from the preferences).
/// - `[[wiki links]]` to other documents, with a title list while typing.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import { api, type CommentDto, type ParaAttrs, type RichDoc } from "../services/api";
import { usePreferences } from "../services/preferences";
import { CommentMargin } from "./CommentMargin";
import { pmToRichDoc, richDocToPm } from "./RichDocConversion";
import { SfComment, SfEmDash, SfFontSize, SfParagraphAttrs, SfSmartTypography } from "./SfExtensions";
import { acceptWord, misspelledAt, SfSpellcheck } from "./Spellcheck";
import { acceptLink, onLinkQuery, SfWikiLinks, type LinkQuery } from "./WikiLinks";
import { DocIcon } from "./DocIcons";
import { endsInSplitWord, looksHardWrapped, looksLikeLine, unwrapPlainText, wrapJoins } from "./LineJoin";
import "../styles/editor.css";
import "../styles/writing.css";
import { t } from "../i18n";

// ---------------------------------------------------------------------------
// Format state — what the toolbar reads
// ---------------------------------------------------------------------------

export interface FormatState {
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strike: boolean;
    code: boolean;
    align: "left" | "center" | "right" | "justify";
    fontFamily: string | null;
    fontSize: number | null;
    color: string | null;
    highlight: string | null;
    /** Named paragraph style (data-para-style), null when none. */
    paragraphStyle: string | null;
    /** Active block type: "paragraph" | "heading" | "blockquote" | "codeBlock" | null. */
    blockType: string | null;
    headingLevel: number | null;
    /** Paragraph attributes of the block at the cursor. */
    paragraphAttrs: ParaAttrs;
}

function emptyFormatState(): FormatState {
    return {
        bold: false,
        italic: false,
        underline: false,
        strike: false,
        code: false,
        align: "left",
        fontFamily: null,
        fontSize: null,
        color: null,
        highlight: null,
        paragraphStyle: null,
        blockType: null,
        headingLevel: null,
        paragraphAttrs: {},
    };
}

/** The value the paragraph-style dropdown should show for this state. */
export function blockStyleValue(f: FormatState | null): string {
    if (!f) return "";
    if (f.blockType === "heading" && f.headingLevel) return `heading_${f.headingLevel}`;
    if (f.blockType === "blockquote") return "block_quote";
    if (f.blockType === "codeBlock") return "code_block";
    if (f.paragraphStyle) return f.paragraphStyle;
    return "";
}

// ---------------------------------------------------------------------------
// Imperative API surface for the parent toolbar
// ---------------------------------------------------------------------------

export interface EditorApi {
    setBold: () => void;
    setItalic: () => void;
    setUnderline: () => void;
    setStrike: () => void;
    setCode: () => void;
    setAlign: (a: "left" | "center" | "right" | "justify") => void;
    setFontFamily: (family: string) => void;
    setFontSize: (pt: number) => void;
    setColor: (hex: string) => void;
    unsetColor: () => void;
    setHighlight: (hex: string) => void;
    unsetHighlight: () => void;
    toggleBulletList: () => void;
    toggleOrderedList: () => void;
    /** Interpret a block-style id: heading_1, block_quote, code_block, verse… */
    applyBlockStyle: (id: string) => void;
    /** Interpret a character-style id: emphasis, strong, code, highlight… */
    applyCharacterStyle: (id: string) => void;
    applyParagraphAttrs: (attrs: ParaAttrs) => void;
    resetParagraphAttrs: () => void;
    getParagraphAttrs: () => ParaAttrs;
    /** Anchor a new margin comment to the selection; null when nothing is
     *  selected or the editor has no comment margin. */
    addComment: () => string | null;
    /** Join paragraphs that are really lines of text cut at a fixed width
     *  (pasted from a PDF), in the selection or the whole document. Returns
     *  how many line breaks were removed. */
    joinBrokenLines: () => number;
    focus: () => void;
    flush: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface Props {
    /** Kept for interface stability; the parent remounts per document id. */
    documentId?: string;
    initialContent: RichDoc;
    editable?: boolean;
    /** Which split pane this editor belongs to ("primary" | "secondary"). */
    paneId?: string;
    onContentChanged: (doc: RichDoc, wordCount: number) => void;
    registerApi?: (api: EditorApi) => void;
    registerFormatState?: (state: FormatState) => void;
    /** Called when this editor gains focus (for split-pane focus tracking). */
    onFocused?: (paneId: string) => void;
    /** Margin comments of this document; enables the comment margin. */
    comments?: CommentDto[];
    onCommentsChange?: (comments: CommentDto[]) => void;
}

function computeFormatState(editor: NonNullable<ReturnType<typeof useEditor>>): FormatState {
    const s = emptyFormatState();
    s.bold = editor.isActive("bold");
    s.italic = editor.isActive("italic");
    s.underline = editor.isActive("underline");
    s.strike = editor.isActive("strike");
    s.code = editor.isActive("code");
    s.align = editor.isActive({ textAlign: "center" })
        ? "center"
        : editor.isActive({ textAlign: "right" })
            ? "right"
            : editor.isActive({ textAlign: "justify" })
                ? "justify"
                : "left";

    // FontFamily / FontSize / Color all live on the textStyle mark.
    const ts = editor.getAttributes("textStyle");
    if (typeof ts.fontFamily === "string" && ts.fontFamily) s.fontFamily = ts.fontFamily;
    if (typeof ts.pt === "number" && ts.pt) s.fontSize = ts.pt;
    if (typeof ts.color === "string" && ts.color) s.color = ts.color;

    const hi = editor.getAttributes("highlight");
    if (typeof hi.color === "string" && hi.color) s.highlight = hi.color;

    // Block type & paragraph attributes.
    const pa = editor.getAttributes("paragraph");
    const ha = editor.getAttributes("heading");
    const attrs: Record<string, unknown> = { ...pa, ...ha };
    if (editor.isActive("heading")) {
        s.blockType = "heading";
        s.headingLevel = typeof attrs.level === "number" ? attrs.level : null;
    } else if (editor.isActive("blockquote")) {
        s.blockType = "blockquote";
    } else if (editor.isActive("codeBlock")) {
        s.blockType = "codeBlock";
    } else if (editor.isActive("paragraph")) {
        s.blockType = "paragraph";
    }
    if (typeof attrs.style === "string" && attrs.style) s.paragraphStyle = attrs.style;

    const para: ParaAttrs = {};
    const num = (v: unknown): number | undefined =>
        typeof v === "number" && Number.isFinite(v) ? v : undefined;
    if (num(attrs.lineHeight) !== undefined) para.line_height = num(attrs.lineHeight);
    if (num(attrs.spaceBefore) !== undefined) para.space_before = num(attrs.spaceBefore);
    if (num(attrs.spaceAfter) !== undefined) para.space_after = num(attrs.spaceAfter);
    if (num(attrs.indentLeft) !== undefined) para.indent_left = num(attrs.indentLeft);
    if (num(attrs.indentRight) !== undefined) para.indent_right = num(attrs.indentRight);
    if (num(attrs.indentFirst) !== undefined) para.indent_first = num(attrs.indentFirst);
    s.paragraphAttrs = para;
    return s;
}

export function RichTextEditor({
    initialContent,
    editable = true,
    paneId = "primary",
    onContentChanged,
    registerApi,
    registerFormatState,
    onFocused,
    comments,
    onCommentsChange,
}: Props) {
    // Refs so the Tiptap event callbacks always see the latest handlers
    // without forcing the editor instance to be recreated.
    const onContentChangedRef = useRef(onContentChanged);
    onContentChangedRef.current = onContentChanged;
    const registerFormatStateRef = useRef(registerFormatState);
    registerFormatStateRef.current = registerFormatState;
    const onFocusedRef = useRef(onFocused);
    onFocusedRef.current = onFocused;
    const paneIdRef = useRef(paneId);
    paneIdRef.current = paneId;

    const commentsRef = useRef(comments);
    commentsRef.current = comments;
    const onCommentsChangeRef = useRef(onCommentsChange);
    onCommentsChangeRef.current = onCommentsChange;
    const [activeComment, setActiveComment] = useState<string | null>(null);
    const commentsOn = comments !== undefined && !!onCommentsChange;
    const commentsOnRef = useRef(commentsOn);
    commentsOnRef.current = commentsOn;

    const { prefs } = usePreferences();
    const typewriter = !!prefs?.editor.typewriter_mode;
    const typewriterRef = useRef(typewriter);
    typewriterRef.current = typewriter;
    const hostRef = useRef<HTMLDivElement>(null);
    const rowRef = useRef<HTMLDivElement>(null);
    const pointerAtRef = useRef(0);

    const [spellMenu, setSpellMenu] = useState<SpellMenuState | null>(null);
    const [linkQuery, setLinkQuery] = useState<LinkQuery | null>(null);

    const debounceRef = useRef<number | null>(null);
    const dirtyRef = useRef(false);
    const editorHolder = useRef<ReturnType<typeof useEditor>>(null);

    const initialPm = useMemo<JSONContent>(() => richDocToPm(initialContent), [initialContent]);

    function pushNow() {
        const editor = editorHolder.current;
        if (debounceRef.current !== null) {
            window.clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
        if (!editor || !dirtyRef.current) return;
        dirtyRef.current = false;
        const rich = pmToRichDoc(editor.getJSON());
        const words = countWordsRich(rich);
        onContentChangedRef.current(rich, words);
    }

    function schedulePush() {
        dirtyRef.current = true;
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(pushNow, 800);
    }

    /** Typewriter mode: scroll so the caret sits mid-height. Skipped right
     *  after a click, so clicking a line does not make the text jump. */
    const centerCaret = useCallback(() => {
        const editor = editorHolder.current;
        if (!typewriterRef.current || !editor || !editor.isFocused) return;
        if (Date.now() - pointerAtRef.current < 400) return;
        const scroller = scrollParent(hostRef.current);
        if (!scroller) return;
        let coords: { top: number; bottom: number };
        try {
            coords = editor.view.coordsAtPos(editor.state.selection.head);
        } catch {
            return;
        }
        const rect = scroller.getBoundingClientRect();
        const delta = (coords.top + coords.bottom) / 2 - (rect.top + rect.height / 2);
        if (Math.abs(delta) > 1) scroller.scrollTop += delta;
    }, []);

    const editor = useEditor({
        extensions: [
            StarterKit,
            Underline,
            TextAlign.configure({ types: ["paragraph", "heading", "blockquote"] }),
            // TextStyle must come before the extensions that extend it.
            TextStyle,
            FontFamily,
            SfFontSize,
            Color,
            Highlight.configure({ multicolor: true }),
            SfParagraphAttrs,
            SfEmDash,
            SfSmartTypography,
            SfComment,
            SfSpellcheck,
            SfWikiLinks,
        ],
        // No Markdown: typing "# ", "**x**", "- ", "> ", "```"… or pasting
        // Markdown text must stay literal text, never become formatting.
        enableInputRules: false,
        enablePasteRules: false,
        content: initialPm,
        editable,
        autofocus: false,
        editorProps: {
            // The WebView checker would draw a second underline.
            attributes: { spellcheck: "false" },
            // Text copied from a PDF arrives as one line per row; rejoin it
            // so it does not become one paragraph per line.
            transformPastedText: (text) => unwrapPlainText(text),
        },
        onFocus: () => {
            onFocusedRef.current?.(paneIdRef.current);
            requestAnimationFrame(centerCaret);
        },
        onSelectionUpdate: ({ editor }) => {
            registerFormatStateRef.current?.(computeFormatState(editor));
            if (commentsOnRef.current) {
                const mark = editor.state.selection.$from.marks().find((m) => m.type.name === "comment");
                if (mark?.attrs.id) setActiveComment(String(mark.attrs.id));
            }
            requestAnimationFrame(centerCaret);
        },
        onTransaction: ({ editor }) => {
            registerFormatStateRef.current?.(computeFormatState(editor));
        },
        onUpdate: () => {
            schedulePush();
            requestAnimationFrame(centerCaret);
        },
    });

    editorHolder.current = editor;

    // Flush pending edits when unmounting (document switch or app close).
    useEffect(() => {
        return () => pushNow();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // The "[[" title list of this editor.
    useEffect(() => {
        if (!editor) return;
        const view = editor.view;
        onLinkQuery(view, setLinkQuery);
        return () => onLinkQuery(view, null);
    }, [editor]);

    // Turning typewriter mode on centres the current line at once.
    useEffect(() => {
        if (typewriter) requestAnimationFrame(centerCaret);
    }, [typewriter, centerCaret]);

    // Expose the imperative API to the parent.
    useEffect(() => {
        if (!editor || !registerApi) return;
        registerApi({
            setBold: () => editor.chain().focus().toggleBold().run(),
            setItalic: () => editor.chain().focus().toggleItalic().run(),
            setUnderline: () => editor.chain().focus().toggleUnderline().run(),
            setStrike: () => editor.chain().focus().toggleStrike().run(),
            setCode: () => editor.chain().focus().toggleCode().run(),
            setAlign: (a) => editor.chain().focus().setTextAlign(a).run(),
            setFontFamily: (family) => {
                if (family) editor.chain().focus().setFontFamily(family).run();
                else editor.chain().focus().unsetFontFamily().run();
            },
            setFontSize: (pt) => editor.commands.setFontSize(pt),
            setColor: (hex) => editor.chain().focus().setColor(hex).run(),
            unsetColor: () => editor.chain().focus().unsetColor().run(),
            setHighlight: (hex) =>
                editor.chain().focus().setHighlight({ color: hex }).run(),
            unsetHighlight: () => editor.chain().focus().unsetHighlight().run(),
            toggleBulletList: () => editor.chain().focus().toggleBulletList().run(),
            toggleOrderedList: () => editor.chain().focus().toggleOrderedList().run(),
            applyBlockStyle: (id) => {
                // Leave a block quote first unless that is the target style,
                // so every style below applies to a plain paragraph.
                if (id !== "block_quote" && editor.isActive("blockquote")) {
                    editor.chain().focus().lift("blockquote").run();
                }
                if (id.startsWith("heading_")) {
                    const level = Math.min(
                        6,
                        Math.max(1, parseInt(id.slice("heading_".length), 10) || 1),
                    ) as 1 | 2 | 3 | 4 | 5 | 6;
                    editor.chain().focus().setHeading({ level }).run();
                } else if (id === "block_quote") {
                    if (editor.isActive("blockquote")) {
                        editor.chain().focus().setParagraph().run();
                    } else {
                        editor.chain().focus().setParagraph().setBlockquote().run();
                    }
                } else if (id === "code_block") {
                    editor.chain().focus().toggleCodeBlock().run();
                } else if (id === "" || id === "paragraph") {
                    // "No Style": plain paragraph, cleared style attribute.
                    editor.chain()
                        .focus()
                        .setParagraph()
                        .updateAttributes("paragraph", { style: null })
                        .run();
                } else {
                    // Named paragraph style (attribution, caption, verse…).
                    editor.chain()
                        .focus()
                        .setParagraph()
                        .updateAttributes("paragraph", { style: id })
                        .run();
                }
            },
            applyCharacterStyle: (id) => {
                switch (id) {
                    case "emphasis":
                        editor.chain().focus().toggleItalic().run();
                        break;
                    case "strong":
                        editor.chain().focus().toggleBold().run();
                        break;
                    case "code":
                        editor.chain().focus().toggleCode().run();
                        break;
                    case "underline":
                        editor.chain().focus().toggleUnderline().run();
                        break;
                    case "strikethrough":
                        editor.chain().focus().toggleStrike().run();
                        break;
                    case "highlight":
                        editor.chain().focus().toggleHighlight({ color: "#ffff00" }).run();
                        break;
                }
            },
            applyParagraphAttrs: (attrs) => {
                const patch: Record<string, number | string | null> = {};
                if (attrs.line_height !== undefined) patch.lineHeight = attrs.line_height;
                if (attrs.space_before !== undefined) patch.spaceBefore = attrs.space_before;
                if (attrs.space_after !== undefined) patch.spaceAfter = attrs.space_after;
                if (attrs.indent_left !== undefined) patch.indentLeft = attrs.indent_left;
                if (attrs.indent_right !== undefined) patch.indentRight = attrs.indent_right;
                if (attrs.indent_first !== undefined) patch.indentFirst = attrs.indent_first;
                if (attrs.style !== undefined) patch.style = attrs.style;
                if (attrs.align !== undefined) {
                    editor.chain().focus().setTextAlign(attrs.align as "left").run();
                }
                if (Object.keys(patch).length > 0) {
                    editor.commands.updateParagraphAttrs(patch);
                }
            },
            resetParagraphAttrs: () => editor.commands.resetParagraphAttrs(),
            getParagraphAttrs: () => computeFormatState(editor).paragraphAttrs,
            addComment: () => {
                const type = editor.schema.marks.comment;
                if (!editor.isEditable || !commentsOnRef.current || !type) return null;
                let { from, to } = editor.state.selection;
                if (from === to) {
                    // A selection made a moment ago (double-click) may not
                    // have reached the editor state yet; read the DOM's.
                    const dom = window.getSelection();
                    const view = editor.view;
                    if (dom && !dom.isCollapsed && dom.anchorNode && dom.focusNode && view.dom.contains(dom.anchorNode)) {
                        const a = view.posAtDOM(dom.anchorNode, dom.anchorOffset);
                        const b = view.posAtDOM(dom.focusNode, dom.focusOffset);
                        [from, to] = [Math.min(a, b), Math.max(a, b)];
                    }
                }
                if (from === to) return null;
                const id = crypto.randomUUID();
                editor.view.dispatch(editor.state.tr.addMark(from, to, type.create({ id })));
                const now = new Date().toISOString();
                onCommentsChangeRef.current?.([
                    ...(commentsRef.current ?? []),
                    { id, text: "", resolved: false, created_at: now, modified_at: now },
                ]);
                setActiveComment(id);
                return id;
            },
            joinBrokenLines: () => {
                if (!editor.isEditable) return 0;
                const { state } = editor;
                const { from, to, empty } = state.selection;
                // Runs of consecutive sibling paragraphs. A paragraph too
                // long to be a single line is a real one and ends a run.
                type Para = { pos: number; text: string; parent: unknown; index: number };
                const runs: Para[][] = [];
                let run: Para[] = [];
                state.doc.nodesBetween(empty ? 0 : from, empty ? state.doc.content.size : to, (node, pos, parent, index) => {
                    if (node.type.name !== "paragraph") return true;
                    const p = { pos, text: node.textContent, parent, index };
                    const prev = run[run.length - 1];
                    const continues = prev && prev.parent === parent && prev.index + 1 === index;
                    if (!continues || !looksLikeLine(p.text)) {
                        if (run.length > 1) runs.push(run);
                        run = [];
                    }
                    if (looksLikeLine(p.text)) run.push(p);
                    return false;
                });
                if (run.length > 1) runs.push(run);

                const tr = state.tr;
                let joined = 0;
                // Work backwards so earlier positions stay valid.
                for (const r of runs.reverse()) {
                    const lines = r.map((p) => p.text);
                    if (!looksHardWrapped(lines)) continue;
                    const joins = wrapJoins(lines);
                    for (let i = r.length - 2; i >= 0; i--) {
                        if (!joins[i]) continue;
                        const a = tr.doc.nodeAt(r[i].pos);
                        if (!a) continue;
                        const textEnd = r[i].pos + 1 + a.content.size;
                        tr.join(r[i].pos + a.nodeSize);
                        if (endsInSplitWord(r[i].text, r[i + 1].text)) {
                            tr.delete(textEnd - 1, textEnd);
                        } else if (!/\s$/.test(r[i].text) && !/^\s/.test(r[i + 1].text)) {
                            tr.insertText(" ", textEnd);
                        }
                        joined++;
                    }
                }
                if (joined > 0) editor.view.dispatch(tr.scrollIntoView());
                return joined;
            },
            focus: () => editor.commands.focus(),
            flush: pushNow,
        });
    }, [editor, registerApi]);

    // Follow read-only changes (e.g. the same document opened in the other
    // pane) without recreating the editor or emitting a content update.
    useEffect(() => {
        if (editor && editor.isEditable !== editable) editor.setEditable(editable, false);
    }, [editor, editable]);

    // Announce the initial format state once the editor exists.
    useEffect(() => {
        if (editor) {
            registerFormatStateRef.current?.(computeFormatState(editor));
        }
    }, [editor]);

    // Right-click on an underlined word: suggestions, add to dictionary,
    // ignore. Anywhere else the normal menu shows.
    function onContextMenu(e: React.MouseEvent) {
        if (!editor) return;
        const at = editor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        const hit = at ? misspelledAt(editor.state, at.pos) : null;
        if (!hit) return;
        e.preventDefault();
        setSpellMenu({ x: e.clientX, y: e.clientY, ...hit, suggestions: null });
        api.spellSuggest(hit.word)
            .then((s) => setSpellMenu((m) => (m && m.from === hit.from ? { ...m, suggestions: s } : m)))
            .catch(() => setSpellMenu((m) => (m && m.from === hit.from ? { ...m, suggestions: [] } : m)));
    }

    function replaceWord(menu: SpellMenuState, word: string) {
        setSpellMenu(null);
        if (!editor || !editor.isEditable) return;
        // Only if the word is still where it was when the menu opened.
        if (editor.state.doc.textBetween(menu.from, menu.to) !== menu.word) return;
        editor.view.dispatch(editor.state.tr.insertText(word, menu.from, menu.to));
        editor.commands.focus();
    }

    const showMargin = commentsOn && !!editor && (comments?.length ?? 0) > 0;

    return (
        <div
            ref={hostRef}
            className={`rt-editor-host${typewriter ? " typewriter" : ""}${showMargin ? " with-comments" : ""}`}
            onMouseDown={() => {
                pointerAtRef.current = Date.now();
            }}
            onContextMenu={onContextMenu}
        >
            <div ref={rowRef} className="rt-editor-row">
                <EditorContent editor={editor} className="rt-editor-content" />
                {showMargin && editor && (
                    <CommentMargin
                        editor={editor}
                        comments={comments ?? []}
                        onChange={(c) => onCommentsChangeRef.current?.(c)}
                        activeId={activeComment}
                        onActivate={setActiveComment}
                        container={rowRef.current}
                        readOnly={!editable}
                    />
                )}
            </div>
            {linkQuery && editor && <LinkList query={linkQuery} editor={editor} />}
            {spellMenu && (
                <>
                    <div
                        className="ctx-backdrop"
                        onMouseDown={(e) => {
                            e.preventDefault();
                            setSpellMenu(null);
                        }}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setSpellMenu(null);
                        }}
                    />
                    <div className="ctx-menu spell-menu" style={{ left: spellMenu.x, top: spellMenu.y }}>
                        {spellMenu.suggestions === null && <div className="ctx-item disabled">{t("Looking for suggestions…")}</div>}
                        {spellMenu.suggestions?.length === 0 && <div className="ctx-item disabled">{t("No suggestions")}</div>}
                        {spellMenu.suggestions?.map((s) => (
                            <button
                                key={s}
                                className="ctx-item spell-suggestion"
                                disabled={!editable}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => replaceWord(spellMenu, s)}
                            >
                                {s}
                            </button>
                        ))}
                        <div className="ctx-sep" />
                        <button
                            className="ctx-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                const w = spellMenu.word;
                                setSpellMenu(null);
                                api.addToDictionary(w)
                                    .then(() => acceptWord(w, "dictionary"))
                                    .catch(() => undefined);
                            }}
                        >
                            {t("Add “{word}” to Dictionary", { word: spellMenu.word })}
                        </button>
                        <button
                            className="ctx-item"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                                acceptWord(spellMenu.word, "ignore");
                                setSpellMenu(null);
                            }}
                        >
                            {t("Ignore")}
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

/** The list of document titles shown after typing "[[". */
function LinkList({ query, editor }: { query: LinkQuery; editor: NonNullable<ReturnType<typeof useEditor>> }) {
    let pos: { left: number; top: number };
    try {
        const c = editor.view.coordsAtPos(query.from);
        pos = { left: c.left, top: c.bottom + 4 };
    } catch {
        return null;
    }
    return (
        <div className="link-list" style={{ left: pos.left, top: pos.top }} role="listbox" aria-label={t("Link to document")}>
            {query.items.length === 0 ? (
                <div className="link-list-empty">
                    {t("No document called “{title}”. Close with ]] to link it anyway.", { title: query.query })}
                </div>
            ) : (
                query.items.map((t, i) => (
                    <button
                        key={t.id}
                        type="button"
                        role="option"
                        aria-selected={i === query.index}
                        className={`link-list-item${i === query.index ? " active" : ""}`}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            acceptLink(editor.view, t);
                        }}
                    >
                        <DocIcon
                            id={t.sheet === "character" ? "character:sheet" : t.sheet === "place" ? "location:sheet" : "notes:grey"}
                            size={14}
                        />
                        {t.title}
                    </button>
                ))
            )}
            <div className="link-list-hint">{t("↑↓ choose · Enter insert · Esc close")}</div>
        </div>
    );
}

interface SpellMenuState {
    x: number;
    y: number;
    from: number;
    to: number;
    word: string;
    /** Null while loading. */
    suggestions: string[] | null;
}

/** The nearest element that scrolls vertically (the editor host itself in
 *  the normal view, the Scrivenings list or composition page otherwise). */
function scrollParent(el: HTMLElement | null): HTMLElement | null {
    let cur = el;
    while (cur) {
        const oy = getComputedStyle(cur).overflowY;
        if ((oy === "auto" || oy === "scroll") && cur.scrollHeight > cur.clientHeight) return cur;
        cur = cur.parentElement;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function countWordsRich(doc: RichDoc): number {
    return doc.blocks
        .map((b) => {
            if (b.type === "code_block") return b.text ?? "";
            const spans = b.spans ?? (b.items ?? []).flatMap((i) => i.spans ?? []);
            return spans.map((s) => s.text).join("");
        })
        .join(" ")
        .split(/\s+/)
        .filter(Boolean).length;
}