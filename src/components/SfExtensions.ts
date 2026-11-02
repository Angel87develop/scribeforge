/// Tiptap extensions for ScribeForge-specific attributes that the core
/// packages don't ship.
///
/// 1. `SfFontSize` — a `pt` attribute on the `textStyle` mark plus a
///    `setFontSize` command.
/// 2. `SfParagraphAttrs` — paragraph-level attributes on `paragraph`,
///    `heading` and `blockquote` nodes: named `style`, `lineHeight`,
///    `spaceBefore`, `spaceAfter`, `indentLeft`, `indentRight`,
///    `indentFirst` — mirroring the Rust `ParaAttrs` model — plus the
///    `updateParagraphAttrs` command used by the Paragraph Formatting dialog.
/// 3. `SfEmDash` — typing "--" turns into an em dash "—".
/// 4. `SfSmartTypography` — Spanish « » (or curly) quotes, "..." → "…",
///    and "- " at the start of a paragraph → dialogue dash "—".
/// 5. `SfComment` — the mark that anchors a margin comment to the text.

import { Extension, Mark, mergeAttributes, type Attribute } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

// ---------------------------------------------------------------------------
// Font size (textStyle mark attribute)
// ---------------------------------------------------------------------------

export const SfFontSize = Extension.create({
    name: "sfFontSize",

    addOptions() {
        return {
            types: ["textStyle"],
        };
    },

    addGlobalAttributes() {
        return [
            {
                types: this.options.types,
                attributes: {
                    pt: {
                        default: null,
                        // Parse "14pt" (or px fallback) back to a pt number.
                        parseHTML: (element) => {
                            const raw = element.style.fontSize;
                            if (!raw) return null;
                            const ptMatch = raw.match(/^([\d.]+)pt/);
                            if (ptMatch) return parseFloat(ptMatch[1]);
                            const pxMatch = raw.match(/^([\d.]+)px/);
                            if (pxMatch) return Math.round(parseFloat(pxMatch[1]) * 0.75 * 10) / 10;
                            return null;
                        },
                        renderHTML: (attrs) => {
                            if (!attrs.pt) return {};
                            return { style: `font-size: ${attrs.pt}pt` };
                        },
                    },
                },
            },
        ];
    },

    addCommands() {
        return {
            setFontSize:
                (pt: number) =>
                ({ chain }) => {
                    return chain().setMark("textStyle", { pt }).run();
                },
        };
    },
});

// ---------------------------------------------------------------------------
// Paragraph attributes (ParaAttrs mirror)
// ---------------------------------------------------------------------------

export interface SfParagraphAttrs {
    style: string | null;
    lineHeight: number | null;
    spaceBefore: number | null;
    spaceAfter: number | null;
    indentLeft: number | null;
    indentRight: number | null;
    indentFirst: number | null;
}

function parsePtStyle(raw: string): number | null {
    const m = raw.match(/^(-?[\d.]+)pt/);
    if (m) return parseFloat(m[1]);
    const px = raw.match(/^(-?[\d.]+)px/);
    if (px) return Math.round(parseFloat(px[1]) * 0.75 * 10) / 10;
    return null;
}

function paraAttrSpecs(): Record<string, Attribute> {
    const specs: Record<string, Attribute> = {};
    specs.style = {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-para-style"),
        renderHTML: (attrs) =>
            attrs && (attrs as Record<string, unknown>).style
                ? { "data-para-style": String((attrs as Record<string, unknown>).style) }
                : {},
    };
    specs.lineHeight = {
        default: null,
        parseHTML: (el) => {
            const raw = (el as HTMLElement).style.lineHeight;
            if (!raw) return null;
            const n = parseFloat(raw);
            return Number.isFinite(n) ? n : null;
        },
        renderHTML: (attrs) => {
            const v = (attrs as Record<string, unknown>)?.lineHeight;
            return v != null ? { style: `line-height: ${v}` } : {};
        },
    };
    const ptAttrs: Record<string, string> = {
        spaceBefore: "marginTop",
        spaceAfter: "marginBottom",
        indentLeft: "marginLeft",
        indentRight: "marginRight",
        indentFirst: "textIndent",
    };
    for (const [name, cssProp] of Object.entries(ptAttrs)) {
        specs[name] = {
            default: null,
            parseHTML: (el) => parsePtStyle((el as HTMLElement).style.getPropertyValue(cssProp)),
            renderHTML: (attrs) => {
                const v = (attrs as Record<string, unknown>)?.[name];
                if (v == null) return {};
                const styleName =
                    name === "spaceBefore"
                        ? "margin-top"
                        : name === "spaceAfter"
                            ? "margin-bottom"
                            : name === "indentLeft"
                                ? "margin-left"
                                : name === "indentRight"
                                    ? "margin-right"
                                    : "text-indent";
                return { style: `${styleName}: ${v}pt` };
            },
        };
    }
    return specs;
}

export const SfParagraphAttrs = Extension.create({
    name: "sfParagraphAttrs",

    addGlobalAttributes() {
        return [
            {
                types: ["paragraph", "heading", "blockquote"],
                attributes: paraAttrSpecs(),
            },
        ];
    },

    addCommands() {
        return {
            updateParagraphAttrs:
                (attrs: Partial<SfParagraphAttrs>) =>
                ({ chain }) => {
                    // Apply to whichever block type the cursor sits in.
                    return chain()
                        .updateAttributes("paragraph", attrs)
                        .updateAttributes("heading", attrs)
                        .updateAttributes("blockquote", attrs)
                        .run();
                },
            resetParagraphAttrs:
                () =>
                ({ chain }) => {
                    const cleared: SfParagraphAttrs = {
                        style: null,
                        lineHeight: null,
                        spaceBefore: null,
                        spaceAfter: null,
                        indentLeft: null,
                        indentRight: null,
                        indentFirst: null,
                    };
                    return chain()
                        .updateAttributes("paragraph", cleared)
                        .updateAttributes("heading", cleared)
                        .updateAttributes("blockquote", cleared)
                        .run();
                },
        };
    },
});

// ---------------------------------------------------------------------------
// Em dash ("--" → "—")
// ---------------------------------------------------------------------------

/// Implemented with `handleTextInput` instead of an input rule, because the
/// editor disables input rules (no Markdown shortcuts). Skipped inside code
/// blocks and inline code, where "--" is meaningful.
export const SfEmDash = Extension.create({
    name: "sfEmDash",

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey("sfEmDash"),
                props: {
                    handleTextInput(view, from, to, text) {
                        if (text !== "-" || from !== to || from < 1) return false;
                        const { state } = view;
                        const $from = state.doc.resolve(from);
                        if ($from.parent.type.spec.code) return false;
                        if ($from.marks().some((m) => m.type.spec.code)) return false;
                        if ($from.parentOffset < 1) return false;
                        if (state.doc.textBetween(from - 1, from) !== "-") return false;
                        view.dispatch(state.tr.insertText("\u2014", from - 1, to));
                        return true;
                    },
                },
            }),
        ];
    },
});

// ---------------------------------------------------------------------------
// Smart typography: quotes, ellipsis, dialogue dash
// ---------------------------------------------------------------------------

export interface TypographyOptions {
    /** What `"` becomes: « » (angular), “ ” (curly) or itself (off). */
    quotes: "angular" | "curly" | "off";
    /** "..." → "…" */
    ellipsis: boolean;
    /** "- " at the start of a paragraph → "—" (Spanish dialogue). */
    dialogueDash: boolean;
}

/// Shared by every editor; the preferences update it when they change.
const typography: TypographyOptions = { quotes: "angular", ellipsis: true, dialogueDash: true };

export function setTypographyOptions(opts: TypographyOptions) {
    Object.assign(typography, opts);
}

/** Characters after which a quote opens rather than closes. */
const OPENS_AFTER = /[\s([{«“‘—–\-/￼]/;

/// The quote character to insert for a typed `"` or `'`. Angular quotes
/// nest Spanish-style: « … “ … ” … ».
function smartQuote(typed: string, textBefore: string): string | null {
    if (typography.quotes === "off") return null;
    const prev = textBefore.slice(-1);
    const opening = prev === "" || OPENS_AFTER.test(prev);
    if (typed === "'") return opening ? "‘" : "’";
    if (typography.quotes === "curly") return opening ? "“" : "”";
    // Angular: track which quotes are still open in this paragraph.
    const stack: string[] = [];
    for (const ch of textBefore) {
        if (ch === "«" || ch === "“") stack.push(ch);
        else if ((ch === "»" || ch === "”") && stack.length) stack.pop();
    }
    const top = stack[stack.length - 1];
    if (opening) return top === "«" ? "“" : "«";
    return top === "“" ? "”" : "»";
}

/// Implemented with `handleTextInput` (input rules are disabled). Nothing is
/// changed inside code blocks or inline code.
export const SfSmartTypography = Extension.create({
    name: "sfSmartTypography",

    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey("sfSmartTypography"),
                props: {
                    handleTextInput(view, from, to, text) {
                        if (text.length !== 1) return false;
                        const { state } = view;
                        const $from = state.doc.resolve(from);
                        if ($from.parent.type.spec.code) return false;
                        if ($from.marks().some((m) => m.type.spec.code)) return false;
                        const blockStart = from - $from.parentOffset;
                        const before = state.doc.textBetween(blockStart, from, undefined, "￼");

                        if (text === '"' || text === "'") {
                            const q = smartQuote(text, before);
                            if (!q) return false;
                            view.dispatch(state.tr.insertText(q, from, to));
                            return true;
                        }
                        if (text === "." && typography.ellipsis && from === to && before.endsWith("..")) {
                            view.dispatch(state.tr.insertText("…", from - 2, to));
                            return true;
                        }
                        if (text === " " && typography.dialogueDash && from === to && before === "-") {
                            view.dispatch(state.tr.insertText("—", from - 1, to));
                            return true;
                        }
                        return false;
                    },
                },
            }),
        ];
    },
});

// ---------------------------------------------------------------------------
// Comment anchors
// ---------------------------------------------------------------------------

/// The anchor of a margin comment: a mark carrying the comment id. Several
/// comments may overlap, so the mark does not exclude itself; it does not
/// grow when typing at its edges.
export const SfComment = Mark.create({
    name: "comment",
    excludes: "",
    inclusive: false,

    addAttributes() {
        return {
            id: {
                default: null,
                parseHTML: (el) => (el as HTMLElement).getAttribute("data-comment-id"),
                renderHTML: (attrs) => ({ "data-comment-id": String(attrs.id ?? "") }),
            },
        };
    },

    parseHTML() {
        return [{ tag: "span[data-comment-id]" }];
    },

    renderHTML({ HTMLAttributes }) {
        return ["span", mergeAttributes(HTMLAttributes, { class: "sf-comment" }), 0];
    },
});

// ---------------------------------------------------------------------------
// Command type augmentation
// ---------------------------------------------------------------------------

declare module "@tiptap/core" {
    interface Commands<ReturnType> {
        sfFontSize: {
            /** Set the font size (in points) on the selection. */
            setFontSize: (pt: number) => ReturnType;
        };
        sfParagraphAttrs: {
            /** Merge paragraph-level attributes into the block(s) at the selection. */
            updateParagraphAttrs: (attrs: Partial<SfParagraphAttrs>) => ReturnType;
            /** Clear all paragraph-level attributes on the block(s) at the selection. */
            resetParagraphAttrs: () => ReturnType;
        };
    }
}