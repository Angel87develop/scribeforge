/// Margin comments: a column to the right of the text with one card per
/// comment, lined up with the passage it is anchored to.
///
/// The anchor is a `comment` mark (see `SfComment`) carrying the comment id;
/// the card text lives in the document's `comments` list. Cards are placed
/// imperatively after every editor transaction: each one at the height of
/// its anchor, pushed down when it would overlap the card above. Comments
/// whose text was deleted are listed at the bottom so they can be removed.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import type { CommentDto } from "../services/api";
import { IconClose } from "./Icons";
import { getLanguage, t } from "../i18n";

interface Props {
    editor: Editor;
    comments: CommentDto[];
    onChange: (comments: CommentDto[]) => void;
    activeId: string | null;
    onActivate: (id: string | null) => void;
    /** Element the card positions are measured against (scrolls with the text). */
    container: HTMLElement | null;
    readOnly: boolean;
}

interface Anchor {
    from: number;
    to: number;
}

/** First and last position of each comment's anchor. */
function findAnchors(editor: Editor): Map<string, Anchor> {
    const out = new Map<string, Anchor>();
    const type = editor.schema.marks.comment;
    if (!type) return out;
    editor.state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
            if (m.type !== type || !m.attrs.id) continue;
            const id = String(m.attrs.id);
            const end = pos + node.nodeSize;
            const a = out.get(id);
            if (a) {
                a.from = Math.min(a.from, pos);
                a.to = Math.max(a.to, end);
            } else {
                out.set(id, { from: pos, to: end });
            }
        }
    });
    return out;
}

/** Remove every anchor of a comment from the text. */
export function removeCommentMarks(editor: Editor, id: string) {
    const type = editor.schema.marks.comment;
    if (!type) return;
    const { state } = editor;
    const tr = state.tr;
    state.doc.descendants((node, pos) => {
        if (!node.isText) return;
        for (const m of node.marks) {
            if (m.type === type && m.attrs.id === id) tr.removeMark(pos, pos + node.nodeSize, m);
        }
    });
    if (tr.docChanged) editor.view.dispatch(tr);
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(getLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

export function CommentMargin({ editor, comments, onChange, activeId, onActivate, container, readOnly }: Props) {
    const [anchors, setAnchors] = useState<Map<string, Anchor>>(() => findAnchors(editor));
    const cardRefs = useRef(new Map<string, HTMLDivElement>());
    const orphanRef = useRef<HTMLDivElement>(null);
    const [layoutTick, setLayoutTick] = useState(0);

    // Re-read anchors after every change to the text; re-place cards after
    // any transaction (positions move when text above them changes).
    useEffect(() => {
        let frame = 0;
        const onTr = () => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => {
                setAnchors(findAnchors(editor));
                setLayoutTick((t) => t + 1);
            });
        };
        editor.on("transaction", onTr);
        window.addEventListener("resize", onTr);
        return () => {
            cancelAnimationFrame(frame);
            editor.off("transaction", onTr);
            window.removeEventListener("resize", onTr);
        };
    }, [editor]);

    const anchored = comments
        .filter((c) => anchors.has(c.id))
        .sort((a, b) => anchors.get(a.id)!.from - anchors.get(b.id)!.from);
    const orphans = comments.filter((c) => !anchors.has(c.id));

    useLayoutEffect(() => {
        if (!container) return;
        const base = container.getBoundingClientRect().top;
        let next = 8;
        for (const c of anchored) {
            const el = cardRefs.current.get(c.id);
            const a = anchors.get(c.id);
            if (!el || !a) continue;
            let top = next;
            try {
                top = Math.max(next, editor.view.coordsAtPos(a.from).top - base - 4);
            } catch {
                // Position not rendered (yet); stack under the previous card.
            }
            el.style.top = `${top}px`;
            next = top + el.offsetHeight + 8;
        }
        if (orphanRef.current) orphanRef.current.style.top = `${next + 8}px`;
    });

    const patch = useCallback(
        (id: string, values: Partial<CommentDto>) => {
            const now = new Date().toISOString();
            onChange(comments.map((c) => (c.id === id ? { ...c, ...values, modified_at: now } : c)));
        },
        [comments, onChange],
    );

    const remove = useCallback(
        (id: string) => {
            removeCommentMarks(editor, id);
            onChange(comments.filter((c) => c.id !== id));
            if (activeId === id) onActivate(null);
        },
        [editor, comments, onChange, activeId, onActivate],
    );

    const reveal = (id: string) => {
        const a = anchors.get(id);
        onActivate(id);
        if (!a) return;
        editor.chain().focus().setTextSelection({ from: a.from, to: a.to }).scrollIntoView().run();
    };

    // Resolved comments keep their anchor but stop highlighting the text.
    const resolvedCss = comments
        .filter((c) => c.resolved)
        .map((c) => `.rt-editor-content .sf-comment[data-comment-id="${CSS.escape(c.id)}"]`)
        .join(",");
    const activeCss = activeId
        ? `.rt-editor-content .sf-comment[data-comment-id="${CSS.escape(activeId)}"]`
        : "";

    return (
        <div className="comment-margin" data-layout={layoutTick}>
            <style>
                {resolvedCss && `${resolvedCss}{background:transparent;border-bottom-color:transparent;}`}
                {activeCss && `${activeCss}{background:var(--comment-active-bg);border-bottom-color:var(--comment-border);}`}
            </style>
            {anchored.map((c) => (
                <div
                    key={c.id}
                    ref={(el) => {
                        if (el) cardRefs.current.set(c.id, el);
                        else cardRefs.current.delete(c.id);
                    }}
                    className={`comment-card${activeId === c.id ? " active" : ""}${c.resolved ? " resolved" : ""}`}
                    onMouseDown={(e) => {
                        if ((e.target as HTMLElement).closest("textarea, button")) return;
                        e.preventDefault();
                        reveal(c.id);
                    }}
                >
                    <div className="comment-card-head">
                        <span className="comment-card-date">{formatDate(c.created_at)}</span>
                        {!readOnly && (
                            <>
                                <button
                                    type="button"
                                    className="comment-card-btn"
                                    title={c.resolved ? t("Reopen this comment") : t("Mark as resolved")}
                                    onClick={() => patch(c.id, { resolved: !c.resolved })}
                                >
                                    {c.resolved ? t("Reopen") : t("Resolve")}
                                </button>
                                <button
                                    type="button"
                                    className="comment-card-btn icon"
                                    title={t("Delete comment")}
                                    aria-label={t("Delete comment")}
                                    onClick={() => remove(c.id)}
                                >
                                    <IconClose size={12} />
                                </button>
                            </>
                        )}
                    </div>
                    {c.resolved && activeId !== c.id ? (
                        <div className="comment-card-text collapsed">{c.text || t("(empty comment)")}</div>
                    ) : (
                        <textarea
                            className="comment-card-text"
                            value={c.text}
                            readOnly={readOnly}
                            placeholder={t("Write a comment…")}
                            autoFocus={activeId === c.id && c.text === ""}
                            rows={Math.min(8, Math.max(2, c.text.split("\n").length))}
                            onFocus={() => onActivate(c.id)}
                            onChange={(e) => patch(c.id, { text: e.target.value })}
                            onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                    e.preventDefault();
                                    editor.commands.focus();
                                }
                            }}
                        />
                    )}
                </div>
            ))}
            {orphans.length > 0 && (
                <div ref={orphanRef} className="comment-orphans">
                    <div className="comment-orphans-title">{t("Comments whose text was deleted")}</div>
                    {orphans.map((c) => (
                        <div key={c.id} className="comment-card orphan">
                            <div className="comment-card-head">
                                <span className="comment-card-date">{formatDate(c.created_at)}</span>
                                {!readOnly && (
                                    <button
                                        type="button"
                                        className="comment-card-btn icon"
                                        title={t("Delete comment")}
                                        aria-label={t("Delete comment")}
                                        onClick={() => remove(c.id)}
                                    >
                                        <IconClose size={12} />
                                    </button>
                                )}
                            </div>
                            <div className="comment-card-text collapsed">{c.text || t("(empty comment)")}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
