/// Paragraph Formatting dialog (spec §3): alignment, line height, spacing
/// before/after, and indents for the paragraph(s) at the cursor.
///
/// Values are validated (non-negative numbers, sensible ranges) before being
/// applied to the active editor via `updateParagraphAttrs`, and persisted in
/// the `.scri` file through the normal debounced autosave.

import { useEffect, useState } from "react";
import type { EditorApi, FormatState } from "./RichTextEditor";
import "../styles/paragraph-dialog.css";

interface Props {
    editorApi: EditorApi | null;
    format: FormatState | null;
    onClose: () => void;
    onError: (msg: string) => void;
}

const LINE_HEIGHTS = [
    { label: "Single (1.0)", value: 1.0 },
    { label: "1.15", value: 1.15 },
    { label: "1.5", value: 1.5 },
    { label: "Double (2.0)", value: 2.0 },
];

function num(v: string): number | null {
    const n = parseFloat(v);
    if (!Number.isFinite(n) || n < 0) return null;
    return n;
}

export function ParagraphFormatDialog({ editorApi, format, onClose, onError }: Props) {
    const [align, setAlign] = useState<string>(format?.align ?? "left");
    const [lineHeight, setLineHeight] = useState<string>(
        format?.paragraphAttrs.line_height != null ? String(format.paragraphAttrs.line_height) : "",
    );
    const [spaceBefore, setSpaceBefore] = useState<string>(
        format?.paragraphAttrs.space_before != null ? String(format.paragraphAttrs.space_before) : "",
    );
    const [spaceAfter, setSpaceAfter] = useState<string>(
        format?.paragraphAttrs.space_after != null ? String(format.paragraphAttrs.space_after) : "",
    );
    const [indentLeft, setIndentLeft] = useState<string>(
        format?.paragraphAttrs.indent_left != null ? String(format.paragraphAttrs.indent_left) : "",
    );
    const [indentRight, setIndentRight] = useState<string>(
        format?.paragraphAttrs.indent_right != null ? String(format.paragraphAttrs.indent_right) : "",
    );
    const [indentFirst, setIndentFirst] = useState<string>(
        format?.paragraphAttrs.indent_first != null ? String(format.paragraphAttrs.indent_first) : "",
    );

    // Close on Escape.
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    function apply(reset: boolean) {
        if (!editorApi) return;
        if (reset) {
            editorApi.resetParagraphAttrs();
            editorApi.setAlign("left");
            onClose();
            return;
        }
        // Validate: each field is either empty (leave unchanged) or a
        // non-negative number.
        const fields: [string, string][] = [
            ["Line height", lineHeight],
            ["Space before", spaceBefore],
            ["Space after", spaceAfter],
            ["Indent left", indentLeft],
            ["Indent right", indentRight],
            ["First-line indent", indentFirst],
        ];
        for (const [label, raw] of fields) {
            if (raw.trim() === "") continue;
            const v = parseFloat(raw);
            if (!Number.isFinite(v) || v < 0) {
                onError(`"${label}" must be a non-negative number.`);
                return;
            }
        }
        const patch: Parameters<EditorApi["applyParagraphAttrs"]>[0] = {};
        const lh = lineHeight.trim() === "" ? null : num(lineHeight);
        if (lh === null && lineHeight.trim() !== "") {
            onError("Line height must be a number.");
            return;
        }
        if (lh !== null && (lh < 0.5 || lh > 5)) {
            onError("Line height must be between 0.5 and 5.");
            return;
        }
        if (lh !== null) patch.line_height = lh;
        const sb = spaceBefore.trim() === "" ? null : num(spaceBefore);
        if (sb === null && spaceBefore.trim() !== "") {
            onError("Space before must be a non-negative number.");
            return;
        }
        if (sb !== null) patch.space_before = sb;
        const sa = spaceAfter.trim() === "" ? null : num(spaceAfter);
        if (sa === null && spaceAfter.trim() !== "") {
            onError("Space after must be a non-negative number.");
            return;
        }
        if (sa !== null) patch.space_after = sa;
        const il = indentLeft.trim() === "" ? null : num(indentLeft);
        if (il === null && indentLeft.trim() !== "") {
            onError("Indent left must be a non-negative number.");
            return;
        }
        if (il !== null) patch.indent_left = il;
        const ir = indentRight.trim() === "" ? null : num(indentRight);
        if (ir === null && indentRight.trim() !== "") {
            onError("Indent right must be a non-negative number.");
            return;
        }
        if (ir !== null) patch.indent_right = ir;
        const fi = indentFirst.trim() === "" ? null : num(indentFirst);
        if (fi === null && indentFirst.trim() !== "") {
            onError("First-line indent must be a non-negative number.");
            return;
        }
        if (fi !== null) patch.indent_first = fi;
        patch.align = align as "left" | "center" | "right" | "justify";

        editorApi.applyParagraphAttrs(patch);
        onClose();
    }

    return (
        <div className="overlay-root" onClick={onClose}>
            <div className="dialog" style={{ minWidth: 380 }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <span className="dialog-title">Paragraph Formatting</span>
                </div>
                <div className="dialog-body">
                    <div className="pf-field">
                        <label>Alignment</label>
                        <div className="pf-align-row">
                            {(["left", "center", "right", "justify"] as const).map((a) => (
                                <button
                                    key={a}
                                    type="button"
                                    className={`pf-align-btn${align === a ? " active" : ""}`}
                                    onClick={() => setAlign(a)}
                                >
                                    {a}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="pf-field">
                        <label htmlFor="pf-lh">Line height</label>
                        <div className="pf-row">
                            <select
                                id="pf-lh"
                                value={LINE_HEIGHTS.some((l) => String(l.value) === lineHeight) ? lineHeight : ""}
                                onChange={(e) => setLineHeight(e.target.value)}
                            >
                                <option value="">—</option>
                                {LINE_HEIGHTS.map((l) => (
                                    <option key={l.value} value={String(l.value)}>
                                        {l.label}
                                    </option>
                                ))}
                            </select>
                            <input
                                type="number"
                                min={0.5}
                                max={5}
                                step={0.05}
                                placeholder="custom"
                                value={LINE_HEIGHTS.some((l) => String(l.value) === lineHeight) ? "" : lineHeight}
                                onChange={(e) => setLineHeight(e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="pf-grid">
                        <div className="pf-field">
                            <label htmlFor="pf-sb">Space before (pt)</label>
                            <input
                                id="pf-sb"
                                type="number"
                                min={0}
                                step={1}
                                placeholder="—"
                                value={spaceBefore}
                                onChange={(e) => setSpaceBefore(e.target.value)}
                            />
                        </div>
                        <div className="pf-field">
                            <label htmlFor="pf-sa">Space after (pt)</label>
                            <input
                                id="pf-sa"
                                type="number"
                                min={0}
                                step={1}
                                placeholder="—"
                                value={spaceAfter}
                                onChange={(e) => setSpaceAfter(e.target.value)}
                            />
                        </div>
                        <div className="pf-field">
                            <label htmlFor="pf-il">Indent left (pt)</label>
                            <input
                                id="pf-il"
                                type="number"
                                min={0}
                                step={1}
                                placeholder="—"
                                value={indentLeft}
                                onChange={(e) => setIndentLeft(e.target.value)}
                            />
                        </div>
                        <div className="pf-field">
                            <label htmlFor="pf-ir">Indent right (pt)</label>
                            <input
                                id="pf-ir"
                                type="number"
                                min={0}
                                step={1}
                                placeholder="—"
                                value={indentRight}
                                onChange={(e) => setIndentRight(e.target.value)}
                            />
                        </div>
                        <div className="pf-field">
                            <label htmlFor="pf-fi">First-line indent (pt)</label>
                            <input
                                id="pf-fi"
                                type="number"
                                min={0}
                                step={1}
                                placeholder="—"
                                value={indentFirst}
                                onChange={(e) => setIndentFirst(e.target.value)}
                            />
                        </div>
                    </div>

                    <p className="pf-note">
                        Applies to the paragraph at the cursor (or every paragraph in the
                        selection). New paragraphs inherit the formatting of the previous
                        paragraph. Values persist in the project file.
                    </p>
                </div>
                <div className="dialog-footer">
                    <button type="button" onClick={() => apply(true)} title="Clear all paragraph formatting">
                        Reset
                    </button>
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button type="button" className="primary" onClick={() => apply(false)}>
                        Apply
                    </button>
                </div>
            </div>
        </div>
    );
}