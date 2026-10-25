/// Format toolbar shared by all editor panes (rendered once by `SplitEditor`).
///
/// State is driven by the active editor's `FormatState` (Tiptap selection
/// events). Every button uses `onMouseDown={e => e.preventDefault()}` so
/// the editor never loses its selection when the button is pressed — that is
/// the root-cause fix for the "double-click required" / flicker bugs.
///
/// Selects and inputs must NOT prevent mousedown (that stops the dropdown
/// from opening / the field from focusing). They take focus normally and the
/// editor commands call `focus()`, which restores the editor's selection.

import { useEffect, useRef, useState } from "react";
import { blockStyleValue, type EditorApi, type FormatState } from "./RichTextEditor";
import {
    IconAlignCenter,
    IconAlignJustify,
    IconAlignLeft,
    IconAlignRight,
    IconBold,
    IconItalic,
    IconStrike,
    IconUnderline,
} from "./Icons";
import "../styles/formatbar.css";

interface Props {
    editorApi: EditorApi | null;
    format: FormatState | null;
    /** Opens the Paragraph Formatting dialog. */
    onParagraphFormatting: () => void;
    /** Called with the hex color the user picks in the color popover. */
    onColorChanged?: (hex: string | null) => void;
}

const FONTS = [
    "Arial",
    "Calibri",
    "Cambria",
    "Comic Sans MS",
    "Consolas",
    "Courier New",
    "Georgia",
    "Helvetica",
    "Palatino Linotype",
    "Segoe UI",
    "Tahoma",
    "Times New Roman",
    "Trebuchet MS",
    "Verdana",
];

const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 24, 36, 48];

const TEXT_COLORS = [
    "#000000", "#262626", "#595959", "#8c8c8c", "#bfbfbf",
    "#1f4e79", "#c00000", "#9c5700", "#7030a0", "#2e7d32",
    "#e36c09", "#ffc000", "#ffffff", "#ffd6e0", "#c5e0b4",
];

function Btn({
    active,
    disabled,
    onClick,
    title,
    children,
}: {
    active?: boolean;
    disabled?: boolean;
    onClick: () => void;
    title: string;
    children: React.ReactNode;
}) {
    return (
        <button
            type="button"
            className={`fb-btn${active ? " active" : ""}`}
            title={title}
            aria-label={title}
            aria-pressed={active ? "true" : "false"}
            disabled={disabled}
            onMouseDown={(e) => {
                e.preventDefault();
                onClick();
            }}
        >
            {children}
        </button>
    );
}

export function FormatBar({ editorApi, format, onParagraphFormatting, onColorChanged }: Props) {
    const f = format ?? null;
    const hasEditor = !!editorApi;
    const [colorOpen, setColorOpen] = useState(false);
    const [highlightOpen, setHighlightOpen] = useState(false);
    const colorSwatchRef = useRef<HTMLDivElement>(null);
    // Popovers are `position: fixed` at the button's position: the bar
    // scrolls horizontally (overflow hidden), which would clip them.
    const [popPos, setPopPos] = useState<{ left: number; top: number }>({ left: 0, top: 0 });
    const anchorPop = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        setPopPos({ left: Math.min(r.left, window.innerWidth - 200), top: r.bottom + 4 });
    };
    const styleSelectValue = blockStyleValue(f);

    // Close color popovers on outside clicks.
    useEffect(() => {
        if (!colorOpen && !highlightOpen) return;
        const close = (e: MouseEvent) => {
            if (colorSwatchRef.current?.contains(e.target as Node)) return;
            setColorOpen(false);
            setHighlightOpen(false);
        };
        document.addEventListener("mousedown", close);
        return () => document.removeEventListener("mousedown", close);
    }, [colorOpen, highlightOpen]);

    const alignActive = (a: string) => f?.align === a;

    return (
        <div className="formatbar" role="toolbar" aria-label="Format">
            {/* Paragraph style */}
            <select
                className="fb-select fb-style-select"
                disabled={!hasEditor}
                value={styleSelectValue}
                onChange={(e) => {
                    editorApi?.applyBlockStyle(e.target.value);
                }}
                title="Paragraph style"
            >
                <option value="">No Style</option>
                <option value="attribution">Attribution</option>
                <option value="block_quote">Block Quote</option>
                <option value="caption">Caption</option>
                <option value="centered">Centered Text</option>
                <option value="code_block">Code Block</option>
                <option value="heading_1">Heading 1</option>
                <option value="heading_2">Heading 2</option>
                <option value="heading_3">Heading 3</option>
                <option value="title">Title</option>
                <option value="subtitle">Subtitle</option>
                <option value="verse">Verse</option>
                <option value="paragraph">Normal Paragraph</option>
            </select>

            <div className="fb-sep" />

            {/* Character style (quick) */}
            <select
                className="fb-select fb-charstyle-select"
                disabled={!hasEditor}
                value=""
                onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    editorApi?.applyCharacterStyle(v);
                    // reset to empty so the same style can be re-applied
                    e.target.value = "";
                }}
                title="Character style"
            >
                <option value="">Character…</option>
                <option value="emphasis">Emphasis</option>
                <option value="strong">Strong Emphasis</option>
                <option value="code">Code Span</option>
                <option value="underline">Underline</option>
                <option value="strikethrough">Strikethrough</option>
                <option value="highlight">Highlight</option>
            </select>

            <div className="fb-sep" />

            {/* Font family */}
            <select
                className="fb-select fb-font-select"
                disabled={!hasEditor}
                value={f?.fontFamily ?? ""}
                onChange={(e) => {
                    if (e.target.value) editorApi?.setFontFamily(e.target.value);
                    else editorApi?.setFontFamily("");
                }}
                title="Font family"
            >
                <option value="">Default</option>
                {FONTS.map((font) => (
                    <option key={font} value={font} style={{ fontFamily: font }}>
                        {font}
                    </option>
                ))}
            </select>

            {/* Font size */}
            <input
                type="number"
                className="fb-input fb-size-input"
                min={1}
                max={400}
                disabled={!hasEditor}
                value={f?.fontSize ?? ""}
                onChange={(e) => {
                    const n = parseInt(e.target.value, 10);
                    if (Number.isFinite(n) && n > 0 && n <= 400) {
                        editorApi?.setFontSize(n);
                    }
                }}
                onKeyDown={(e) => {
                    if (e.key === "Enter") {
                        e.preventDefault();
                        editorApi?.focus();
                    }
                }}
                list="fb-sizes"
                title="Font size (pt)"
            />
            <datalist id="fb-sizes">
                {SIZES.map((s) => (
                    <option key={s} value={s} />
                ))}
            </datalist>

            <div className="fb-sep" />

            {/* Bold / Italic / Underline / Strike / Code */}
            <Btn title="Bold (Ctrl+B)" active={f?.bold} disabled={!hasEditor} onClick={() => editorApi?.setBold()}>
                <IconBold size={15} />
            </Btn>
            <Btn title="Italic (Ctrl+I)" active={f?.italic} disabled={!hasEditor} onClick={() => editorApi?.setItalic()}>
                <IconItalic size={15} />
            </Btn>
            <Btn title="Underline (Ctrl+U)" active={f?.underline} disabled={!hasEditor} onClick={() => editorApi?.setUnderline()}>
                <IconUnderline size={15} />
            </Btn>
            <Btn title="Strikethrough" active={f?.strike} disabled={!hasEditor} onClick={() => editorApi?.setStrike()}>
                <IconStrike size={15} />
            </Btn>

            <div className="fb-sep" />

            {/* Alignment */}
            <Btn title="Align Left (Ctrl+L)" active={alignActive("left")} disabled={!hasEditor} onClick={() => editorApi?.setAlign("left")}>
                <IconAlignLeft size={15} />
            </Btn>
            <Btn title="Align Center (Ctrl+E)" active={alignActive("center")} disabled={!hasEditor} onClick={() => editorApi?.setAlign("center")}>
                <IconAlignCenter size={15} />
            </Btn>
            <Btn title="Align Right (Ctrl+R)" active={alignActive("right")} disabled={!hasEditor} onClick={() => editorApi?.setAlign("right")}>
                <IconAlignRight size={15} />
            </Btn>
            <Btn title="Justify (Ctrl+J)" active={alignActive("justify")} disabled={!hasEditor} onClick={() => editorApi?.setAlign("justify")}>
                <IconAlignJustify size={15} />
            </Btn>

            <div className="fb-sep" />

            {/* Text color */}
            <div className="fb-color-wrap">
                <button
                    type="button"
                    className="fb-color-btn"
                    title="Text color"
                    disabled={!hasEditor}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        anchorPop(e.currentTarget);
                        setColorOpen((v) => !v);
                        setHighlightOpen(false);
                    }}
                >
                    <span className="fb-color-glyph">A</span>
                    <span
                        className="fb-color-strip"
                        style={{ background: f?.color ?? "#000000" }}
                        aria-hidden="true"
                    />
                </button>
                {colorOpen && (
                    <div
                        className="fb-color-pop"
                        style={popPos}
                        ref={colorSwatchRef}
                        onMouseDown={(e) => {
                            // Let the native color input open its picker.
                            if (!(e.target instanceof HTMLInputElement)) e.preventDefault();
                        }}
                    >
                        <div className="fb-color-grid">
                            {TEXT_COLORS.map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    className={`fb-color-cell${f?.color === c ? " active" : ""}`}
                                    style={{ background: c }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        editorApi?.setColor(c);
                                        onColorChanged?.(c);
                                        setColorOpen(false);
                                    }}
                                    title={c}
                                />
                            ))}
                        </div>
                        <div className="fb-color-custom">
                            <input
                                type="color"
                                value={f?.color ?? "#000000"}
                                onChange={(e) => {
                                    editorApi?.setColor(e.target.value);
                                    onColorChanged?.(e.target.value);
                                }}
                            />
                            <button
                                type="button"
                                className="fb-color-clear"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    editorApi?.unsetColor();
                                    onColorChanged?.(null);
                                    setColorOpen(false);
                                }}
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Highlight */}
            <div className="fb-color-wrap">
                <button
                    type="button"
                    className="fb-color-btn"
                    title="Highlight color"
                    disabled={!hasEditor}
                    onMouseDown={(e) => {
                        e.preventDefault();
                        anchorPop(e.currentTarget);
                        setHighlightOpen((v) => !v);
                        setColorOpen(false);
                    }}
                >
                    <span className="fb-color-glyph">
                        <span style={{ background: f?.highlight ?? "#ffff00" }} className="fb-highlight-glyph" />
                    </span>
                </button>
                {highlightOpen && (
                    <div className="fb-color-pop" style={popPos} ref={colorSwatchRef} onMouseDown={(e) => e.preventDefault()}>
                        <div className="fb-color-grid">
                            {["#ffff00", "#ffeb6b", "#9b59b6", "#3498db", "#e74c3c", "#2ecc71", "#ff99cc", "#c5e0b4", "#ffffff"].map((c) => (
                                <button
                                    key={c}
                                    type="button"
                                    className={`fb-color-cell${f?.highlight === c ? " active" : ""}`}
                                    style={{ background: c }}
                                    onMouseDown={(e) => {
                                        e.preventDefault();
                                        editorApi?.setHighlight(c);
                                        setHighlightOpen(false);
                                    }}
                                    title={c}
                                />
                            ))}
                        </div>
                        <div className="fb-color-custom">
                            <button
                                type="button"
                                className="fb-color-clear"
                                onMouseDown={(e) => {
                                    e.preventDefault();
                                    editorApi?.unsetHighlight();
                                    setHighlightOpen(false);
                                }}
                            >
                                Reset
                            </button>
                        </div>
                    </div>
                )}
            </div>

            <div className="fb-sep" />

            {/* Outbound: paragraph formatting dialog */}
            <button
                type="button"
                className="fb-btn"
                title="Paragraph formatting…"
                disabled={!hasEditor}
                onMouseDown={(e) => {
                    e.preventDefault();
                    onParagraphFormatting();
                }}
            >
                ¶
            </button>
        </div>
    );
}