/// "Format" tab of the preferences: writing format profiles.
///
/// - Top: the eight profiles, which one is active, a description and a live
///   preview, plus Apply (make the selected profile the active one) and
///   Restore (drop the user's changes to it).
/// - Editor: font, size, alignment, line spacing, indents and paragraph
///   spacing of the selected profile. These change how the editor shows text.
/// - Export (collapsed): page, margins, chapter starts, scene separator,
///   chapter title size, page numbers and header. These only reach the
///   compile step, through its "Writing Format" preset.
/// - Writing area: the text column width, which is not part of a profile.
///
/// Every change edits the preferences draft; the dialog's Save stores it.
/// Changes to a profile are kept apart from the built-in values, so editing
/// one profile never alters another.

import { useEffect, useState } from "react";
import type { BuiltinFormatProfile, FormatProfile, FormatSettings } from "../services/api";
import {
    EDITOR_FONTS,
    PROFILE_LIMITS,
    editorFormatVars,
    resolveProfile,
    resolvedFont,
    withCustomProfile,
} from "../services/formatProfiles";
import { t } from "../i18n";

interface Props {
    format: FormatSettings;
    builtins: BuiltinFormatProfile[];
    textWidth: number;
    onFormat: (format: FormatSettings) => void;
    onTextWidth: (px: number) => void;
}

export function FormatPreferences({ format, builtins, textWidth, onFormat, onTextWidth }: Props) {
    const [selected, setSelected] = useState(format.active_profile);
    const builtin = builtins.find((b) => b.id === selected) ?? builtins[0];
    const profile = resolveProfile(format, builtins, builtin?.id);

    if (!builtin || !profile) {
        return <p className="prefs-note">{t("The format profiles could not be loaded.")}</p>;
    }

    const active = builtins.find((b) => b.id === format.active_profile) ?? builtins[0];
    const isActive = builtin.id === active.id;
    const customized = (id: string) => id in format.custom;

    function edit(changes: Partial<FormatProfile>) {
        onFormat(withCustomProfile(format, builtins, builtin.id, { ...profile!, ...changes }));
    }
    function editExport(changes: Partial<FormatProfile["export"]>) {
        edit({ export: { ...profile!.export, ...changes } });
    }

    const shownFont = resolvedFont(profile.font_family);
    const e = profile.export;

    return (
        <>
            <div className="fmt-active">
                {t("Active format:")} <strong>{t(active.name)}</strong>
                {customized(active.id) && <span className="fmt-badge">{t("customized")}</span>}
            </div>

            <div className="fmt-select-row">
                <label className="form-field">
                    <span className="form-field-label">{t("Format profile")}</span>
                    <select value={builtin.id} onChange={(ev) => setSelected(ev.target.value)}>
                        {builtins.map((b) => (
                            <option key={b.id} value={b.id}>
                                {t(b.name)}
                                {customized(b.id) ? ` (${t("customized")})` : ""}
                                {b.id === active.id ? ` — ${t("active")}` : ""}
                            </option>
                        ))}
                    </select>
                </label>
                <button
                    type="button"
                    className="primary"
                    disabled={isActive}
                    onClick={() => onFormat({ ...format, active_profile: builtin.id })}
                >
                    {isActive ? t("Applied") : t("Apply Format")}
                </button>
            </div>
            <p className="prefs-note fmt-desc">{t(builtin.description)}</p>

            <div className="prefs-sample fmt-preview rt-editor-content" style={editorFormatVars(profile)}>
                <h3>{t("Chapter One")}</h3>
                <p>
                    {t(
                        "The rain had washed away the valley roads by the time Elena reached the inn. Nobody was expecting her, but the innkeeper had left the door ajar.",
                    )}
                </p>
                <p>{t("“Come far?” he asked, without looking up from the fire.")}</p>
                <hr />
                <p>{t("By dawn the whole village knew that a stranger was sleeping upstairs.")}</p>
            </div>

            <h4 className="prefs-subhead">{t("Editor")}</h4>
            <div className="fmt-grid">
                <label className="form-field fmt-span2">
                    <span className="form-field-label">{t("Font")}</span>
                    <input
                        type="text"
                        list="sf-format-fonts"
                        value={profile.font_family}
                        onChange={(ev) => edit({ font_family: ev.target.value })}
                        onBlur={(ev) => {
                            if (!ev.target.value.trim()) edit({ font_family: builtin.profile.font_family });
                        }}
                    />
                    <datalist id="sf-format-fonts">
                        {EDITOR_FONTS.map((f) => (
                            <option key={f} value={f} />
                        ))}
                    </datalist>
                    {profile.font_family.trim() && shownFont !== profile.font_family.trim() && (
                        <span className="hint fmt-warn">
                            {shownFont
                                ? t("“{font}” is not installed on this computer; the editor uses “{fallback}”.", {
                                      font: profile.font_family,
                                      fallback: shownFont,
                                  })
                                : t("“{font}” is not installed on this computer; the editor uses a similar generic font.", {
                                      font: profile.font_family,
                                  })}
                        </span>
                    )}
                </label>
                <NumField
                    label={t("Size (pt)")}
                    value={profile.font_size_pt}
                    limits={PROFILE_LIMITS.font_size_pt}
                    onChange={(v) => edit({ font_size_pt: v })}
                />
                <label className="form-field">
                    <span className="form-field-label">{t("Alignment")}</span>
                    <select
                        value={profile.alignment}
                        onChange={(ev) => edit({ alignment: ev.target.value as FormatProfile["alignment"] })}
                    >
                        <option value="justify">{t("Justified")}</option>
                        <option value="left">{t("Left")}</option>
                    </select>
                </label>
                <NumField
                    label={t("Line spacing")}
                    value={profile.line_height}
                    limits={PROFILE_LIMITS.line_height}
                    onChange={(v) => edit({ line_height: v })}
                />
                <NumField
                    label={t("First-line indent (cm)")}
                    value={profile.first_line_indent_cm}
                    limits={PROFILE_LIMITS.first_line_indent_cm}
                    onChange={(v) => edit({ first_line_indent_cm: v })}
                />
                <NumField
                    label={t("Space before (pt)")}
                    value={profile.space_before_pt}
                    limits={PROFILE_LIMITS.space_pt}
                    onChange={(v) => edit({ space_before_pt: v })}
                />
                <NumField
                    label={t("Space after (pt)")}
                    value={profile.space_after_pt}
                    limits={PROFILE_LIMITS.space_pt}
                    onChange={(v) => edit({ space_after_pt: v })}
                />
            </div>
            <label className="prefs-check">
                <input
                    type="checkbox"
                    checked={profile.no_indent_after_heading}
                    onChange={(ev) => edit({ no_indent_after_heading: ev.target.checked })}
                />
                {t("No indent on the first paragraph after a heading or a separator")}
            </label>

            <details className="fmt-export">
                <summary>{t("Export options")}</summary>
                <p className="prefs-note">
                    {t(
                        "These do not change the editor. They apply when compiling with the “Writing Format” preset. Page, margins, page numbers and header only affect PDF and DOCX, not HTML or EPUB.",
                    )}
                </p>
                <div className="fmt-grid">
                    <label className="form-field">
                        <span className="form-field-label">{t("Page size")}</span>
                        <select
                            value={e.page_size}
                            onChange={(ev) => editExport({ page_size: ev.target.value as typeof e.page_size })}
                        >
                            <option value="a4">{t("A4 (21 × 29.7 cm)")}</option>
                            <option value="a5">{t("A5 (14.8 × 21 cm)")}</option>
                            <option value="letter">{t("US Letter (21.6 × 27.9 cm)")}</option>
                        </select>
                    </label>
                    <label className="form-field">
                        <span className="form-field-label">{t("Chapter start")}</span>
                        <select
                            value={e.chapter_start}
                            onChange={(ev) => editExport({ chapter_start: ev.target.value as typeof e.chapter_start })}
                        >
                            <option value="new_page">{t("New page")}</option>
                            <option value="continuous">{t("Title followed by the text")}</option>
                        </select>
                    </label>
                    <NumField
                        label={t("Margins (cm)")}
                        hint={t("Top, outer and bottom.")}
                        value={e.margin_cm}
                        limits={PROFILE_LIMITS.margin_cm}
                        onChange={(v) => editExport({ margin_cm: v })}
                    />
                    <NumField
                        label={t("Inner margin (cm)")}
                        hint={t("The binding side.")}
                        value={e.inner_margin_cm}
                        limits={PROFILE_LIMITS.margin_cm}
                        onChange={(v) => editExport({ inner_margin_cm: v })}
                    />
                    <label className="form-field">
                        <span className="form-field-label">{t("Scene separator")}</span>
                        <input
                            type="text"
                            value={e.scene_separator}
                            placeholder={t("Blank line")}
                            maxLength={40}
                            onChange={(ev) => editExport({ scene_separator: ev.target.value })}
                        />
                    </label>
                    <NumField
                        label={t("Chapter titles (pt)")}
                        hint={t("0 = automatic.")}
                        value={e.chapter_title_size_pt}
                        limits={PROFILE_LIMITS.chapter_title_size_pt}
                        onChange={(v) => editExport({ chapter_title_size_pt: v })}
                    />
                    <label className="form-field fmt-span2">
                        <span className="form-field-label">{t("Header")}</span>
                        <input
                            type="text"
                            value={e.header_text}
                            placeholder={t("No header")}
                            maxLength={200}
                            onChange={(ev) => editExport({ header_text: ev.target.value })}
                        />
                    </label>
                </div>
                <label className="prefs-check">
                    <input
                        type="checkbox"
                        checked={e.page_numbers}
                        onChange={(ev) => editExport({ page_numbers: ev.target.checked })}
                    />
                    {t("Number the pages")}
                </label>
            </details>

            <div className="fmt-actions">
                <button
                    type="button"
                    disabled={!customized(builtin.id)}
                    onClick={() => onFormat(withCustomProfile(format, builtins, builtin.id, null))}
                >
                    {t("Restore Original Values")}
                </button>
                <span className="hint">
                    {customized(builtin.id)
                        ? t("This profile has changes; they are stored when you press Save.")
                        : t("The profile's original values.")}
                </span>
            </div>

            <h4 className="prefs-subhead">{t("Writing area")}</h4>
            <label className="form-field">
                <span className="form-field-label">{t("Text column width: {px}px", { px: textWidth })}</span>
                <input
                    type="range"
                    min={400}
                    max={1400}
                    step={20}
                    value={textWidth}
                    onChange={(ev) => onTextWidth(Number(ev.target.value) || 720)}
                />
                <span className="hint">{t("Shared by all profiles.")}</span>
            </label>
        </>
    );
}

/// Number input that only reports values inside its limits. While the text
/// is incomplete or out of range it is marked invalid; leaving the field
/// puts back the last valid value.
function NumField({
    label,
    hint,
    value,
    limits,
    onChange,
}: {
    label: string;
    hint?: string;
    value: number;
    limits: { min: number; max: number; step: number };
    onChange: (v: number) => void;
}) {
    const [text, setText] = useState(String(value));
    useEffect(() => {
        // Follow outside changes (another profile, restore) without
        // rewriting what is being typed.
        if (Number(text) !== value) setText(String(value));
    }, [value]);
    const n = Number(text);
    const valid = text.trim() !== "" && Number.isFinite(n) && n >= limits.min && n <= limits.max;
    return (
        <label className="form-field">
            <span className="form-field-label">{label}</span>
            <input
                type="number"
                min={limits.min}
                max={limits.max}
                step={limits.step}
                value={text}
                aria-invalid={!valid}
                className={valid ? undefined : "fmt-invalid"}
                onChange={(ev) => {
                    setText(ev.target.value);
                    const v = Number(ev.target.value);
                    if (ev.target.value.trim() !== "" && Number.isFinite(v) && v >= limits.min && v <= limits.max) {
                        onChange(v);
                    }
                }}
                onBlur={() => setText(String(value))}
            />
            {valid ? (
                hint && <span className="hint">{hint}</span>
            ) : (
                <span className="hint fmt-warn">{t("Between {min} and {max}.", { min: limits.min, max: limits.max })}</span>
            )}
        </label>
    );
}
