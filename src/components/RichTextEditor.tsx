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

import { useEffect, useMemo, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import Color from "@tiptap/extension-color";
import FontFamily from "@tiptap/extension-font-family";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import TextStyle from "@tiptap/extension-text-style";
import Underline from "@tiptap/extension-underline";
import StarterKit from "@tiptap/starter-kit";
import type { JSONContent } from "@tiptap/core";
import type { ParaAttrs, RichDoc } from "../services/api";
import { pmToRichDoc, richDocToPm } from "./RichDocConversion";
import { SfEmDash, SfFontSize, SfParagraphAttrs } from "./SfExtensions";
import "../styles/editor.css";

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

    const debounceRef = useRef<number | null>(null);
    const editorHolder = useRef<ReturnType<typeof useEditor>>(null);

    const initialPm = useMemo<JSONContent>(() => richDocToPm(initialContent), [initialContent]);

    function pushNow() {
        const editor = editorHolder.current;
        if (!editor) return;
        const rich = pmToRichDoc(editor.getJSON());
        const words = countWordsRich(rich);
        onContentChangedRef.current(rich, words);
    }

    function schedulePush() {
        if (debounceRef.current !== null) window.clearTimeout(debounceRef.current);
        debounceRef.current = window.setTimeout(pushNow, 800);
    }

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
        ],
        // No Markdown: typing "# ", "**x**", "- ", "> ", "```"… or pasting
        // Markdown text must stay literal text, never become formatting.
        enableInputRules: false,
        enablePasteRules: false,
        content: initialPm,
        editable,
        autofocus: false,
        onFocus: () => {
            onFocusedRef.current?.(paneIdRef.current);
        },
        onSelectionUpdate: ({ editor }) => {
            registerFormatStateRef.current?.(computeFormatState(editor));
        },
        onTransaction: ({ editor }) => {
            registerFormatStateRef.current?.(computeFormatState(editor));
        },
        onUpdate: () => {
            schedulePush();
        },
    });

    editorHolder.current = editor;

    // Flush pending edits when unmounting (document switch or app close).
    useEffect(() => {
        return () => {
            if (debounceRef.current !== null) {
                window.clearTimeout(debounceRef.current);
                debounceRef.current = null;
            }
            pushNow();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

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
            focus: () => editor.commands.focus(),
            flush: pushNow,
        });
    }, [editor, registerApi]);

    // Announce the initial format state once the editor exists.
    useEffect(() => {
        if (editor) {
            registerFormatStateRef.current?.(computeFormatState(editor));
        }
    }, [editor]);

    return (
        <div className="rt-editor-host">
            <EditorContent editor={editor} className="rt-editor-content" />
        </div>
    );
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