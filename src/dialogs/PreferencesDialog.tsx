/// Preferences window: theme, writing options, writing format profiles
/// (font, spacing, indents, export page setup), autosave, backups, the
/// composition-mode defaults and the interface language.
///
/// Edits are kept in a draft until Save; Cancel (or Escape) discards them.
/// Format changes are previewed live in the editor behind the dialog and put
/// back on Cancel. The backend clamps every value to a safe range and the
/// dialog shows what was actually stored.

import { useCallback, useEffect, useState } from "react";
import type { Preferences } from "../services/api";
import { applyEditorFormat, usePreferences } from "../services/preferences";
import { IconSettings } from "../components/Icons";
import { FormatPreferences } from "./FormatPreferences";
import "../styles/dialogs.css";
import { LANGUAGES, t } from "../i18n";

type Tab = "general" | "editor" | "format" | "saving" | "composition" | "languages";

/** Labels are English; translated when drawn. */
const TABS: { id: Tab; label: string }[] = [
    { id: "general", label: "General" },
    { id: "editor", label: "Editor" },
    { id: "format", label: "Format" },
    { id: "saving", label: "Saving" },
    { id: "composition", label: "Composition" },
    { id: "languages", label: "Languages" },
];

interface Props {
    onClose: () => void;
    onError: (msg: string) => void;
    onSaved?: (prefs: Preferences) => void;
}

export function PreferencesDialog({ onClose, onError, onSaved }: Props) {
    const { prefs, formatProfiles, save } = usePreferences();
    const [draft, setDraft] = useState<Preferences | null>(prefs);
    const [tab, setTab] = useState<Tab>("general");
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (!draft && prefs) setDraft(prefs);
    }, [prefs, draft]);

    // Live preview of the format in the editor.
    useEffect(() => {
        if (draft) applyEditorFormat(draft, formatProfiles);
    }, [draft, formatProfiles]);

    const cancel = useCallback(() => {
        if (prefs) applyEditorFormat(prefs, formatProfiles);
        onClose();
    }, [prefs, formatProfiles, onClose]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") cancel();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [cancel]);

    function patch<K extends keyof Preferences>(section: K, values: Partial<Preferences[K]>) {
        setDraft((d) => (d ? { ...d, [section]: { ...d[section], ...values } } : d));
    }

    async function submit() {
        if (!draft) return;
        setSaving(true);
        try {
            const stored = await save(draft);
            onSaved?.(stored);
            onClose();
        } catch (e) {
            onError(String(e));
            setSaving(false);
        }
    }

    const num = (v: string, fallback: number) => {
        const n = Number(v);
        return Number.isFinite(n) ? n : fallback;
    };

    return (
        <div className="overlay-root" onMouseDown={cancel}>
            <div className="dialog prefs-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconSettings size={18} />
                    <span className="dialog-title">{t("Preferences")}</span>
                </div>
                {!draft ? (
                    <div className="dialog-body">{t("Loading preferences…")}</div>
                ) : (
                    <div className="prefs-body">
                        <nav className="prefs-tabs">
                            {TABS.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`prefs-tab${tab === item.id ? " active" : ""}`}
                                    onClick={() => setTab(item.id)}
                                >
                                    {t(item.label)}
                                </button>
                            ))}
                        </nav>
                        <div className="prefs-panel">
                            {tab === "general" && (
                                <>
                                    <Field label={t("Theme")}>
                                        <select
                                            value={draft.general.theme}
                                            onChange={(e) =>
                                                patch("general", { theme: e.target.value as Preferences["general"]["theme"] })
                                            }
                                        >
                                            <option value="light">{t("Light")}</option>
                                            <option value="dark">{t("Dark")}</option>
                                            <option value="system">{t("Same as Windows")}</option>
                                        </select>
                                    </Field>
                                    <Field label={t("Recent projects to remember")}>
                                        <input
                                            type="number"
                                            min={1}
                                            max={50}
                                            value={draft.general.recent_max}
                                            onChange={(e) =>
                                                patch("general", { recent_max: num(e.target.value, draft.general.recent_max) })
                                            }
                                        />
                                    </Field>
                                </>
                            )}

                            {tab === "editor" && (
                                <>
                                    <p className="prefs-note">
                                        {t("Font, size, spacing, indents and text width are set in the Format tab, as part of the writing format profile.")}
                                    </p>
                                    <h4 className="prefs-subhead">{t("Writing")}</h4>
                                    <label className="prefs-check">
                                        <input
                                            type="checkbox"
                                            checked={draft.editor.typewriter_mode}
                                            onChange={(e) => patch("editor", { typewriter_mode: e.target.checked })}
                                        />
                                        {t("Typewriter mode: keep the line I am writing in the middle of the screen")}
                                    </label>
                                    <Field label={t("Quotation marks")} hint={t("What a typed \" becomes. A typed ' becomes ‘ or ’.")}>
                                        <select
                                            value={draft.editor.smart_quotes}
                                            onChange={(e) =>
                                                patch("editor", {
                                                    smart_quotes: e.target.value as Preferences["editor"]["smart_quotes"],
                                                })
                                            }
                                        >
                                            <option value="angular">{t("Spanish « » (with “ ” inside)")}</option>
                                            <option value="curly">{t("Curly “ ”")}</option>
                                            <option value="off">{t("Straight \" (no change)")}</option>
                                        </select>
                                    </Field>
                                    <label className="prefs-check">
                                        <input
                                            type="checkbox"
                                            checked={draft.editor.smart_ellipsis}
                                            onChange={(e) => patch("editor", { smart_ellipsis: e.target.checked })}
                                        />
                                        {t("Turn three dots (...) into an ellipsis (…)")}
                                    </label>
                                    <label className="prefs-check">
                                        <input
                                            type="checkbox"
                                            checked={draft.editor.dialogue_dash}
                                            onChange={(e) => patch("editor", { dialogue_dash: e.target.checked })}
                                        />
                                        {t("Dialogue dash: a hyphen and a space at the start of a paragraph become —")}
                                    </label>
                                    <p className="prefs-note">{t("Two hyphens (--) always become an em dash (—). Nothing changes inside code.")}</p>
                                </>
                            )}

                            {tab === "format" && (
                                <FormatPreferences
                                    format={draft.format}
                                    builtins={formatProfiles}
                                    textWidth={draft.editor.text_width_px}
                                    onFormat={(format) => setDraft((d) => (d ? { ...d, format } : d))}
                                    onTextWidth={(px) => patch("editor", { text_width_px: px })}
                                />
                            )}

                            {tab === "saving" && (
                                <>
                                    <label className="prefs-check">
                                        <input
                                            type="checkbox"
                                            checked={draft.saving.autosave}
                                            onChange={(e) => patch("saving", { autosave: e.target.checked })}
                                        />
                                        {t("Autosave the project while I work")}
                                    </label>
                                    <Field label={t("Autosave every (seconds)")} hint={t("Between 5 and 3600.")}>
                                        <input
                                            type="number"
                                            min={5}
                                            max={3600}
                                            disabled={!draft.saving.autosave}
                                            value={draft.saving.autosave_interval_secs}
                                            onChange={(e) =>
                                                patch("saving", {
                                                    autosave_interval_secs: num(e.target.value, draft.saving.autosave_interval_secs),
                                                })
                                            }
                                        />
                                    </Field>
                                    <Field
                                        label={t("Backups to keep")}
                                        hint={t("Each save copies the project into <name>.backups next to it; older copies beyond this number are removed.")}
                                    >
                                        <input
                                            type="number"
                                            min={1}
                                            max={50}
                                            value={draft.saving.backup_count}
                                            onChange={(e) =>
                                                patch("saving", { backup_count: num(e.target.value, draft.saving.backup_count) })
                                            }
                                        />
                                    </Field>
                                </>
                            )}

                            {tab === "composition" && (
                                <>
                                    <p className="prefs-note">
                                        {t("Defaults for composition mode. You can also change them from its bottom bar while writing.")}
                                    </p>
                                    <div className="prefs-colors">
                                        <ColorField
                                            label={t("Background")}
                                            value={draft.composition.background}
                                            onChange={(v) => patch("composition", { background: v })}
                                        />
                                        <ColorField
                                            label={t("Page")}
                                            value={draft.composition.page_color}
                                            onChange={(v) => patch("composition", { page_color: v })}
                                        />
                                        <ColorField
                                            label={t("Text")}
                                            value={draft.composition.text_color}
                                            onChange={(v) => patch("composition", { text_color: v })}
                                        />
                                    </div>
                                    <Field label={t("Page width: {px}px", { px: draft.composition.page_width_px })}>
                                        <input
                                            type="range"
                                            min={400}
                                            max={1400}
                                            step={20}
                                            value={draft.composition.page_width_px}
                                            onChange={(e) => patch("composition", { page_width_px: num(e.target.value, 720) })}
                                        />
                                    </Field>
                                    <Field label={t("Text size: {px}px", { px: draft.composition.font_size })}>
                                        <input
                                            type="range"
                                            min={12}
                                            max={32}
                                            value={draft.composition.font_size}
                                            onChange={(e) => patch("composition", { font_size: num(e.target.value, 18) })}
                                        />
                                    </Field>
                                    <Field
                                        label={t("Page opacity: {pct}%", { pct: Math.round(draft.composition.page_opacity * 100) })}
                                    >
                                        <input
                                            type="range"
                                            min={0}
                                            max={1}
                                            step={0.05}
                                            value={draft.composition.page_opacity}
                                            onChange={(e) => patch("composition", { page_opacity: num(e.target.value, 1) })}
                                        />
                                    </Field>
                                </>
                            )}

                            {tab === "languages" && (
                                <>
                                    <Field
                                        label={t("Interface language")}
                                        hint={t("Menus, dialogs and messages. Your documents are never translated.")}
                                    >
                                        <select
                                            value={draft.general.language}
                                            onChange={(e) => patch("general", { language: e.target.value })}
                                        >
                                            {LANGUAGES.map((l) => (
                                                <option key={l.id} value={l.id}>
                                                    {l.name}
                                                </option>
                                            ))}
                                        </select>
                                    </Field>
                                    <p className="prefs-note">{t("The new language is used as soon as you press Save.")}</p>
                                </>
                            )}
                        </div>
                    </div>
                )}
                <div className="dialog-footer">
                    <button type="button" onClick={cancel}>
                        {t("Cancel")}
                    </button>
                    <button type="button" className="primary" disabled={!draft || saving} onClick={submit}>
                        {saving ? t("Saving…") : t("Save")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
    return (
        <label className="form-field">
            <span className="form-field-label">{label}</span>
            {children}
            {hint && <span className="hint">{hint}</span>}
        </label>
    );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
    return (
        <label className="prefs-color">
            <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
            <span>{label}</span>
        </label>
    );
}
