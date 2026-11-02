/// Compile dialog: export the manuscript (or any selection of documents) to
/// TXT, Markdown, HTML, DOCX, PDF or EPUB.
///
/// - Left: the Manuscript and Research trees with checkboxes. Checking a
///   folder checks everything inside it. By default the whole Manuscript is
///   selected and Research is not.
/// - Right: output format, a preset (the active writing format profile,
///   standard manuscript, ebook, screenplay) and the settings it fills in,
///   which can all be adjusted.
/// - Text formats can be previewed before writing the file.
///
/// The last format, preset and settings are remembered on this computer,
/// except that the writing format preset always starts from the profile as
/// it is now in the preferences.

import { useEffect, useMemo, useState } from "react";
import {
    api,
    type CompileFormat,
    type CompilePreset,
    type CompileRequest,
    type CompileSettings,
    type DocumentMetaDto,
} from "../services/api";
import { descendants, displayTitle, isFolderKind } from "../components/binderTree";
import { usePreferences } from "../services/preferences";
import { IconExport, IconFolder, IconDocument } from "../components/Icons";
import "../styles/dialogs.css";
import { t, tn } from "../i18n";

const LAST_KEY = "sf.compile.last";
/** Mirrors `format_profiles::COMPILE_PRESET_ID` in Rust. */
const WRITING_FORMAT_PRESET = "writing_format";

const FORMATS: { id: CompileFormat; label: string; paged: boolean }[] = [
    { id: "pdf", label: "PDF", paged: true },
    { id: "docx", label: "Word (DOCX)", paged: true },
    { id: "epub", label: "EPUB", paged: false },
    { id: "html", label: "HTML", paged: false },
    { id: "markdown", label: "Markdown", paged: false },
    { id: "txt", label: "Plain text", paged: false },
];

const FONTS = ["Courier New", "Times New Roman", "Georgia", "Garamond", "Arial", "Helvetica"];

interface Saved {
    format: CompileFormat;
    settings: CompileSettings;
}

function loadSaved(): Saved | null {
    try {
        const raw = localStorage.getItem(LAST_KEY);
        return raw ? (JSON.parse(raw) as Saved) : null;
    } catch {
        return null;
    }
}

interface Props {
    binder: DocumentMetaDto[];
    projectName: string;
    author: string | null;
    onClose: () => void;
    onError: (msg: string) => void;
    onCompiled: (path: string) => void;
}

export function CompileDialog({ binder, projectName, author, onClose, onError, onCompiled }: Props) {
    const { prefs, formatProfiles } = usePreferences();
    const saved = useMemo(loadSaved, []);
    const [presets, setPresets] = useState<CompilePreset[]>([]);
    const [format, setFormat] = useState<CompileFormat>(saved?.format ?? "pdf");
    const [settings, setSettings] = useState<CompileSettings | null>(saved?.settings ?? null);
    const [title, setTitle] = useState(projectName);
    const [authorName, setAuthorName] = useState(author ?? "");
    const [busy, setBusy] = useState(false);
    const [preview, setPreview] = useState<string | null>(null);

    const draft = binder.find((d) => d.kind === "draft_root");
    const research = binder.find((d) => d.kind === "research_root");
    const draftRows = useMemo(() => (draft ? descendants(binder, draft.id) : []), [binder, draft]);
    const researchRows = useMemo(() => (research ? descendants(binder, research.id) : []), [binder, research]);
    const [included, setIncluded] = useState<Set<string>>(() => new Set(draftRows.map((r) => r.meta.id)));

    useEffect(() => {
        api.listCompilePresets()
            .then((list) => {
                setPresets(list);
                // Remembered settings are laid over their preset, so fields
                // added in later versions get their defaults.
                setSettings((s) => {
                    const base = list.find((p) => p.id === s?.preset)?.settings ?? list[0]?.settings ?? null;
                    if (!base) return s;
                    return s && s.preset !== WRITING_FORMAT_PRESET ? { ...base, ...s } : { ...base };
                });
            })
            .catch((e) => onError(String(e)));
    }, [onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const paged = FORMATS.find((f) => f.id === format)?.paged ?? false;
    const canPreview = format === "txt" || format === "markdown" || format === "html";

    function set<K extends keyof CompileSettings>(key: K, value: CompileSettings[K]) {
        setSettings((s) => (s ? { ...s, [key]: value } : s));
        setPreview(null);
    }

    function applyPreset(id: string) {
        const p = presets.find((x) => x.id === id);
        if (p) {
            setSettings({ ...p.settings });
            setPreview(null);
        }
    }

    function toggle(row: DocumentMetaDto, on: boolean) {
        const ids = [row.id, ...descendants(binder, row.id).map((r) => r.meta.id)];
        setIncluded((prev) => {
            const next = new Set(prev);
            for (const id of ids) {
                if (on) next.add(id);
                else next.delete(id);
            }
            return next;
        });
        setPreview(null);
    }

    function selectRows(rows: { meta: DocumentMetaDto }[], on: boolean) {
        setIncluded((prev) => {
            const next = new Set(prev);
            for (const r of rows) {
                if (on) next.add(r.meta.id);
                else next.delete(r.meta.id);
            }
            return next;
        });
        setPreview(null);
    }

    /** Preset names come from Rust in English; the writing format preset is
     *  named after the active profile, so its label is rebuilt here. */
    function presetLabel(p: CompilePreset): string {
        if (p.id !== WRITING_FORMAT_PRESET) return t(p.label);
        const name = formatProfiles.find((b) => b.id === prefs?.format.active_profile)?.name;
        return name ? t("Writing Format: {name}", { name: t(name) }) : t(p.label);
    }

    function request(): CompileRequest | null {
        if (!settings) return null;
        return {
            format,
            settings,
            include: [...included],
            title: title.trim() || null,
            author: authorName.trim() || null,
        };
    }

    const selectedDocs = [...draftRows, ...researchRows].filter(
        (r) => included.has(r.meta.id) && !isFolderKind(r.meta.kind),
    );
    const selectedWords = selectedDocs.reduce((n, r) => n + r.meta.word_count, 0);

    async function runPreview() {
        const req = request();
        if (!req) return;
        try {
            setPreview(await api.compilePreview(req));
        } catch (e) {
            onError(String(e));
        }
    }

    async function compile() {
        const req = request();
        if (!req) return;
        setBusy(true);
        try {
            localStorage.setItem(LAST_KEY, JSON.stringify({ format, settings }));
            const path = await api.compileProject(req);
            setBusy(false);
            if (path) {
                onCompiled(path);
                onClose();
            }
        } catch (e) {
            setBusy(false);
            onError(String(e));
        }
    }

    function tree(rows: { meta: DocumentMetaDto; depth: number }[]) {
        return rows
            .filter((r) => !r.meta.in_trash)
            .map((r) => (
                <label key={r.meta.id} className="compile-row" style={{ paddingLeft: 6 + r.depth * 16 }}>
                    <input
                        type="checkbox"
                        checked={included.has(r.meta.id)}
                        onChange={(e) => toggle(r.meta, e.target.checked)}
                    />
                    {isFolderKind(r.meta.kind) ? <IconFolder size={13} /> : <IconDocument size={13} />}
                    <span className="compile-row-title">{r.meta.title}</span>
                    {r.meta.word_count > 0 && <span className="compile-row-words">{r.meta.word_count}</span>}
                </label>
            ));
    }

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog compile-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconExport size={18} />
                    <span className="dialog-title">{t("Compile")}</span>
                </div>
                <div className="compile-body">
                    <section className="compile-contents">
                        <div className="compile-section-head">
                            <span>{t("Contents")}</span>
                            <span className="spacer" />
                            <button type="button" className="split-tb-btn" onClick={() => selectRows(draftRows, true)}>
                                {t("All")}
                            </button>
                            <button
                                type="button"
                                className="split-tb-btn"
                                onClick={() => selectRows([...draftRows, ...researchRows], false)}
                            >
                                {t("None")}
                            </button>
                        </div>
                        <div className="compile-tree">
                            <div className="compile-root">{draft ? displayTitle(draft) : t("Manuscript")}</div>
                            {draftRows.length === 0 && <div className="compile-empty">{t("The manuscript is empty.")}</div>}
                            {tree(draftRows)}
                            {researchRows.length > 0 && (
                                <>
                                    <div className="compile-root">{research ? displayTitle(research) : t("Research")}</div>
                                    {tree(researchRows)}
                                </>
                            )}
                        </div>
                        <div className="compile-summary">
                            {tn(selectedDocs.length, "{n} document", "{n} documents")} ·{" "}
                            {tn(selectedWords, "{n} word", "{n} words")}
                        </div>
                    </section>

                    <section className="compile-options">
                        {!settings ? (
                            <div className="compile-empty">{t("Loading presets…")}</div>
                        ) : (
                            <>
                                <div className="compile-grid">
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Format")}</span>
                                        <select
                                            value={format}
                                            onChange={(e) => {
                                                setFormat(e.target.value as CompileFormat);
                                                setPreview(null);
                                            }}
                                        >
                                            {FORMATS.map((f) => (
                                                <option key={f.id} value={f.id}>
                                                    {t(f.label)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Preset")}</span>
                                        <select value={settings.preset} onChange={(e) => applyPreset(e.target.value)}>
                                            {presets.map((p) => (
                                                <option key={p.id} value={p.id}>
                                                    {presetLabel(p)}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                                <p className="compile-preset-desc">
                                    {t(presets.find((p) => p.id === settings.preset)?.description ?? "")}
                                </p>

                                <div className="compile-grid">
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Title")}</span>
                                        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
                                    </label>
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Author")}</span>
                                        <input
                                            type="text"
                                            value={authorName}
                                            placeholder={t("Optional")}
                                            onChange={(e) => setAuthorName(e.target.value)}
                                        />
                                    </label>
                                </div>

                                <fieldset className="compile-fieldset">
                                    <legend>{t("Text")}</legend>
                                    <div className="compile-grid three">
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Font")}</span>
                                            <select value={settings.font_family} onChange={(e) => set("font_family", e.target.value)}>
                                                {[...new Set([settings.font_family, ...FONTS])].map((f) => (
                                                    <option key={f} value={f}>
                                                        {f}
                                                    </option>
                                                ))}
                                            </select>
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Size (pt)")}</span>
                                            <input
                                                type="number"
                                                min={6}
                                                max={48}
                                                step={0.5}
                                                value={settings.font_size}
                                                onChange={(e) => set("font_size", Number(e.target.value) || 12)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Line spacing")}</span>
                                            <select
                                                value={String(settings.line_spacing)}
                                                onChange={(e) => set("line_spacing", Number(e.target.value))}
                                            >
                                                {[...new Set([settings.line_spacing, 1, 1.15, 1.3, 1.5, 2])]
                                                    .sort((a, b) => a - b)
                                                    .map((v) => (
                                                        <option key={v} value={String(v)}>
                                                            {v === 1 ? t("Single") : v === 2 ? t("Double") : v}
                                                        </option>
                                                    ))}
                                            </select>
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("First-line indent (in)")}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                max={3}
                                                step={0.1}
                                                value={settings.first_line_indent}
                                                onChange={(e) => set("first_line_indent", Number(e.target.value) || 0)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Alignment")}</span>
                                            <select
                                                value={settings.alignment}
                                                onChange={(e) => set("alignment", e.target.value as CompileSettings["alignment"])}
                                            >
                                                <option value="left">{t("Left")}</option>
                                                <option value="justify">{t("Justified")}</option>
                                            </select>
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Space before (pt)")}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                max={72}
                                                value={settings.paragraph_spacing_before}
                                                onChange={(e) => set("paragraph_spacing_before", Number(e.target.value) || 0)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Space after (pt)")}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                max={72}
                                                value={settings.paragraph_spacing}
                                                onChange={(e) => set("paragraph_spacing", Number(e.target.value) || 0)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Scene separator")}</span>
                                            <input
                                                type="text"
                                                value={settings.separator}
                                                placeholder={t("Blank line")}
                                                onChange={(e) => set("separator", e.target.value)}
                                            />
                                        </label>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Chapter title size (pt)")}</span>
                                            <input
                                                type="number"
                                                min={0}
                                                max={72}
                                                value={settings.chapter_title_size}
                                                placeholder={t("Automatic")}
                                                onChange={(e) => set("chapter_title_size", Number(e.target.value) || 0)}
                                            />
                                        </label>
                                    </div>
                                    <div className="compile-checks">
                                        <Check label={t("Folder titles as chapter headings")} value={settings.folder_titles} onChange={(v) => set("folder_titles", v)} />
                                        <Check label={t("Document titles as headings")} value={settings.document_titles} onChange={(v) => set("document_titles", v)} />
                                        <Check label={t("Titles in capitals")} value={settings.uppercase_titles} onChange={(v) => set("uppercase_titles", v)} />
                                        <Check label={t("Keep bold, italics and underline")} value={settings.keep_formatting} onChange={(v) => set("keep_formatting", v)} />
                                        <Check label={t("Title page")} value={settings.title_page} onChange={(v) => set("title_page", v)} />
                                    </div>
                                </fieldset>

                                {paged && (
                                    <fieldset className="compile-fieldset">
                                        <legend>{t("Page")}</legend>
                                        <div className="compile-grid three">
                                            <label className="form-field">
                                                <span className="form-field-label">{t("Paper")}</span>
                                                <select
                                                    value={settings.page_size}
                                                    onChange={(e) => set("page_size", e.target.value as CompileSettings["page_size"])}
                                                >
                                                    <option value="letter">{t("US Letter")}</option>
                                                    <option value="a4">{t("A4")}</option>
                                                    <option value="a5">{t("A5")}</option>
                                                </select>
                                            </label>
                                            <label className="form-field">
                                                <span className="form-field-label">{t("Margins (in)")}</span>
                                                <input
                                                    type="number"
                                                    min={0.25}
                                                    max={3}
                                                    step={0.05}
                                                    value={settings.margin}
                                                    onChange={(e) => set("margin", Number(e.target.value) || 1)}
                                                />
                                            </label>
                                            <label className="form-field">
                                                <span className="form-field-label">{t("Left margin (in)")}</span>
                                                <input
                                                    type="number"
                                                    min={0.25}
                                                    max={3}
                                                    step={0.05}
                                                    value={settings.margin_left}
                                                    onChange={(e) => set("margin_left", Number(e.target.value) || 1)}
                                                />
                                            </label>
                                        </div>
                                        <label className="form-field">
                                            <span className="form-field-label">{t("Header")}</span>
                                            <input
                                                type="text"
                                                value={settings.header_text}
                                                placeholder={t("None")}
                                                maxLength={200}
                                                onChange={(e) => set("header_text", e.target.value)}
                                            />
                                        </label>
                                        <div className="compile-checks">
                                            <Check label={t("Each chapter on a new page")} value={settings.page_break_before_chapters} onChange={(v) => set("page_break_before_chapters", v)} />
                                            <Check label={t("Page numbers")} value={settings.page_numbers} onChange={(v) => set("page_numbers", v)} />
                                        </div>
                                        {format === "pdf" && (
                                            <p className="compile-note">
                                                {t("PDF uses the built-in Courier, Times or Helvetica closest to the chosen font. Characters outside Western European languages appear as “?”.")}
                                            </p>
                                        )}
                                    </fieldset>
                                )}

                                {(format === "epub" || format === "html") && (
                                    <label className="form-field">
                                        <span className="form-field-label">{t("Language code")}</span>
                                        <input
                                            type="text"
                                            value={settings.language}
                                            onChange={(e) => set("language", e.target.value)}
                                            placeholder={t("en, es, fr…")}
                                        />
                                    </label>
                                )}

                                {preview !== null && <pre className="compile-preview">{preview}</pre>}
                            </>
                        )}
                    </section>
                </div>
                <div className="dialog-footer">
                    {canPreview && (
                        <button type="button" disabled={!settings || selectedDocs.length === 0} onClick={runPreview}>
                            {t("Preview")}
                        </button>
                    )}
                    <span className="spacer" />
                    <button type="button" onClick={onClose}>
                        {t("Cancel")}
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={!settings || busy || included.size === 0}
                        onClick={compile}
                    >
                        {busy ? t("Compiling…") : t("Compile…")}
                    </button>
                </div>
            </div>
        </div>
    );
}

function Check({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
    return (
        <label className="prefs-check">
            <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
            {label}
        </label>
    );
}
