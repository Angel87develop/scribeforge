/// Bidirectional conversion between ScribeForge's `RichDoc` block/span model
/// and ProseMirror's JSON document model (the format Tiptap uses).
///
/// Both models are nested trees, but ProseMirror uses nested "content"
/// arrays while our model flattens spans inside each block. We translate at
/// the boundary so the `.scri` file keeps its stable, documented format.

import type { JSONContent } from "@tiptap/core";
import type { Mark, ParaAttrs, RichBlock, RichDoc, RichSpan } from "../services/api";

// ---------------------------------------------------------------------------
// RichDoc -> ProseMirror JSON
// ---------------------------------------------------------------------------

function spanToPmInline(span: RichSpan): JSONContent {
    const others: { type: string; attrs?: Record<string, unknown> }[] = [];
    // FontFamily / FontSize / Color all live on the single `textStyle` mark,
    // so they must be merged into one mark instance, not three.
    const textStyles: Record<string, unknown> = {};
    for (const m of span.marks ?? []) {
        switch (m.type) {
            case "font_family":
                textStyles.fontFamily = m.family;
                break;
            case "font_size":
                textStyles.pt = m.pt;
                break;
            case "color":
                textStyles.color = m.hex;
                break;
            default: {
                const mark = markToPm(m);
                if (mark) others.push(mark);
            }
        }
    }
    if (Object.keys(textStyles).length > 0) {
        others.push({ type: "textStyle", attrs: textStyles });
    }
    const text = span.text;
    return {
        type: "text",
        text,
        ...(others.length ? { marks: others } : {}),
    } as JSONContent;
}

function markToPm(m: Mark): { type: string; attrs?: Record<string, unknown> } | null {
    switch (m.type) {
        case "bold":
        case "italic":
        case "underline":
        case "strikethrough":
            return { type: m.type };
        case "code_span":
            return { type: "code" };
        case "link":
            return { type: "link", attrs: { href: m.href } };
        case "highlight":
            return { type: "highlight", attrs: { color: m.hex } };
        default:
            return null;
    }
}

function pmMarkToMark(m: { type: string; attrs?: Record<string, unknown> }): Mark[] {
    switch (m.type) {
        case "bold":
            return [{ type: "bold" }];
        case "italic":
            return [{ type: "italic" }];
        case "underline":
            return [{ type: "underline" }];
        case "strikethrough":
            return [{ type: "strikethrough" }];
        case "code":
            return [{ type: "code_span" }];
        case "link":
            return [{ type: "link", href: String(m.attrs?.href ?? "#") }];
        case "highlight":
            return [{ type: "highlight", hex: String(m.attrs?.color ?? "#ffff00") }];
        case "textStyle": {
            // One textStyle mark may carry fontFamily, fontSize (pt) and color.
            const out: Mark[] = [];
            const attrs = m.attrs ?? {};
            if (typeof attrs.fontFamily === "string" && attrs.fontFamily) {
                out.push({ type: "font_family", family: attrs.fontFamily });
            }
            if (typeof attrs.pt === "number") {
                out.push({ type: "font_size", pt: attrs.pt });
            }
            if (typeof attrs.color === "string" && attrs.color) {
                out.push({ type: "color", hex: attrs.color });
            }
            return out;
        }
        default:
            return [];
    }
}

function paraAttrsToPm(a: ParaAttrs | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    if (a?.align) out.textAlign = a.align;
    if (a?.line_height) out.lineHeight = a.line_height;
    if (a?.space_before) out.spaceBefore = a.space_before;
    if (a?.space_after) out.spaceAfter = a.space_after;
    if (a?.indent_left) out.indentLeft = a.indent_left;
    if (a?.indent_right) out.indentRight = a.indent_right;
    if (a?.indent_first) out.indentFirst = a.indent_first;
    if (a?.style) out.style = a.style;
    return out;
}

function pmAttrsToPara(attrs: Record<string, unknown> | undefined): ParaAttrs {
    const a = attrs ?? {};
    const out: ParaAttrs = {};
    if (typeof a.textAlign === "string") out.align = a.textAlign as ParaAttrs["align"];
    if (typeof a.lineHeight === "number") out.line_height = a.lineHeight;
    if (typeof a.spaceBefore === "number") out.space_before = a.spaceBefore;
    if (typeof a.spaceAfter === "number") out.space_after = a.spaceAfter;
    if (typeof a.indentLeft === "number") out.indent_left = a.indentLeft;
    if (typeof a.indentRight === "number") out.indent_right = a.indentRight;
    if (typeof a.indentFirst === "number") out.indent_first = a.indentFirst;
    if (typeof a.style === "string") out.style = a.style;
    return out;
}

function paragraphPm(attrs: ParaAttrs | undefined, spans: RichSpan[] | undefined): JSONContent {
    return {
        type: "paragraph",
        attrs: paraAttrsToPm(attrs),
        content: (spans ?? []).map(spanToPmInline),
    } as JSONContent;
}

function headingPm(level: number, attrs: ParaAttrs | undefined, spans: RichSpan[] | undefined): JSONContent {
    return {
        type: "heading",
        attrs: { level, ...paraAttrsToPm(attrs) },
        content: (spans ?? []).map(spanToPmInline),
    } as JSONContent;
}

function blockquotePm(attrs: ParaAttrs | undefined, spans: RichSpan[] | undefined): JSONContent {
    return {
        type: "blockquote",
        attrs: paraAttrsToPm(attrs),
        content: [paragraphPm(undefined, spans)],
    } as JSONContent;
}

function listItemPm(spans: RichSpan[] | undefined): JSONContent {
    return {
        type: "listItem",
        content: [paragraphPm(undefined, spans)],
    } as JSONContent;
}

function listPm(kind: "ordered" | "bullet", items: { spans?: RichSpan[] }[] | undefined): JSONContent {
    const content = (items ?? []).map((i) => listItemPm(i.spans));
    return {
        type: kind === "ordered" ? "orderedList" : "bulletList",
        content,
    } as JSONContent;
}

function codeBlockPm(text: string): JSONContent {
    return {
        type: "codeBlock",
        content: text ? [{ type: "text", text } as JSONContent] : [],
    } as JSONContent;
}

export function richDocToPm(doc: RichDoc): JSONContent {
    const content: JSONContent[] = [];
    for (const b of doc.blocks) {
        switch (b.type) {
            case "paragraph":
                content.push(paragraphPm(b.attrs, b.spans));
                break;
            case "heading":
                content.push(headingPm(b.level ?? 2, b.attrs, b.spans));
                break;
            case "block_quote":
                content.push(blockquotePm(b.attrs, b.spans));
                break;
            case "list_ordered":
                content.push(listPm("ordered", b.items));
                break;
            case "list_unordered":
                content.push(listPm("bullet", b.items));
                break;
            case "code_block":
                content.push(codeBlockPm(b.text ?? ""));
                break;
            case "divider":
                content.push({ type: "horizontalRule" } as JSONContent);
                break;
        }
    }
    if (content.length === 0) {
        content.push(paragraphPm(undefined, [{ text: "", marks: [] }]));
    }
    return { type: "doc", content } as JSONContent;
}

// ---------------------------------------------------------------------------
// ProseMirror JSON -> RichDoc
// ---------------------------------------------------------------------------

function inlineToSpans(node: JSONContent): RichSpan[] {
    const out: RichSpan[] = [];
    const walk = (n: JSONContent, marks: Mark[]) => {
        if (!n || typeof n !== "object") return;
        const obj = n as Record<string, unknown>;
        if (obj.type === "text") {
            const text = String(obj.text ?? "");
            const pmMarks = (obj.marks as { type: string; attrs?: Record<string, unknown> }[]) ?? [];
            const extra: Mark[] = [];
            for (const pm of pmMarks) {
                extra.push(...pmMarkToMark(pm));
            }
            const all = [...marks, ...extra];
            out.push({ text, marks: all.length ? all : undefined });
        } else if (obj.type === "hardBreak") {
            out.push({ text: "\n" });
        } else if (Array.isArray(obj.content)) {
            const pmMarks = (obj.marks as { type: string; attrs?: Record<string, unknown> }[]) ?? [];
            const extra: Mark[] = [];
            for (const pm of pmMarks) {
                extra.push(...pmMarkToMark(pm));
            }
            for (const child of obj.content as JSONContent[]) {
                walk(child, [...marks, ...extra]);
            }
        }
    };
    walk(node, []);
    return out;
}

export function pmToRichDoc(pm: JSONContent): RichDoc {
    const root = pm as Record<string, unknown>;
    const blocks: RichBlock[] = [];
    const content = (root.content as JSONContent[]) ?? [];

    for (const node of content) {
        const n = node as Record<string, unknown>;
        const attrs = pmAttrsToPara(n.attrs as Record<string, unknown> | undefined);
        switch (n.type) {
            case "paragraph": {
                const spans = inlineToSpans(node);
                blocks.push({ type: "paragraph", attrs, spans });
                break;
            }
            case "heading": {
                const level = Number((n.attrs as Record<string, unknown>)?.level ?? 2);
                const spans = inlineToSpans(node);
                blocks.push({ type: "heading", level, attrs, spans });
                break;
            }
            case "blockquote": {
                // ProseMirror nests paragraphs inside blockquote; flatten to
                // our model by concatenating inline content from each child.
                const contentArr = (n.content as JSONContent[]) ?? [];
                const spans: RichSpan[] = [];
                for (const child of contentArr) {
                    spans.push(...inlineToSpans(child));
                    if (spans.length > 0) {
                        // Insert a break between paragraphs within the quote.
                        spans.push({ text: "\n" });
                    }
                }
                if (spans.length > 0 && spans[spans.length - 1].text === "\n") {
                    spans.pop();
                }
                blocks.push({ type: "block_quote", attrs, spans });
                break;
            }
            case "orderedList":
            case "bulletList": {
                const items: { spans: RichSpan[] }[] = [];
                const contentArr = (n.content as JSONContent[]) ?? [];
                for (const li of contentArr) {
                    const liObj = li as Record<string, unknown>;
                    if (liObj.type === "listItem") {
                        const liContent = (liObj.content as JSONContent[]) ?? [];
                        // Take inline content from the first paragraph inside.
                        const spans = liContent.length ? inlineToSpans(liContent[0]) : [];
                        items.push({ spans });
                    }
                }
                blocks.push({
                    type: n.type === "orderedList" ? "list_ordered" : "list_unordered",
                    items,
                });
                break;
            }
            case "codeBlock": {
                // ProseMirror code block content is a flat text node list.
                let text = "";
                const contentArr = (n.content as JSONContent[]) ?? [];
                for (const t of contentArr) {
                    const tObj = t as Record<string, unknown>;
                    if (tObj.type === "text") text += String(tObj.text ?? "");
                }
                blocks.push({ type: "code_block", text });
                break;
            }
            case "horizontalRule":
                blocks.push({ type: "divider" });
                break;
        }
    }

    if (blocks.length === 0) {
        blocks.push({ type: "paragraph", attrs: {}, spans: [{ text: "", marks: undefined }] });
    }
    return { blocks };
}
