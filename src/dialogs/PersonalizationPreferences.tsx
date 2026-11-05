/// "Personalization" tab of the preferences: everything about how the
/// interface looks.
///
/// - Theme: light, dark, same as Windows, or automatic (colours taken from
///   the wallpaper, with the extracted colours shown).
/// - Wallpaper: an image behind the interface, chosen with the button or
///   dropped on the preview, with how much of it shows, how opaque the
///   panels are over it and how blurred it is.
/// - Composition mode: the wallpaper behind the page, and the colours.
///
/// Every change edits the preferences draft; the dialog previews it live and
/// its Save stores it.

import { useState } from "react";
import type { Preferences } from "../services/api";
import { autoThemeVars, storeWallpaper, type WallpaperLook } from "../services/wallpaper";
import { IconImage, IconTrash } from "../components/Icons";
import { t } from "../i18n";

interface Props {
    draft: Preferences;
    /** The draft's wallpaper once loaded; null while loading or when none. */
    look: WallpaperLook | null;
    onChange: (next: Preferences) => void;
    onError: (msg: string) => void;
}

type Wallpaper = Preferences["appearance"]["wallpaper"];

export function PersonalizationPreferences({ draft, look, onChange, onError }: Props) {
    const [busy, setBusy] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const wallpaper = draft.appearance.wallpaper;
    const hasWallpaper = !!wallpaper.file;

    function setTheme(theme: Preferences["general"]["theme"]) {
        onChange({ ...draft, general: { ...draft.general, theme } });
    }

    function setWallpaper(values: Partial<Wallpaper>) {
        onChange({
            ...draft,
            appearance: { ...draft.appearance, wallpaper: { ...wallpaper, ...values } },
        });
    }

    function setComposition(values: Partial<Preferences["composition"]>) {
        onChange({ ...draft, composition: { ...draft.composition, ...values } });
    }

    async function takeImage(file: File | undefined) {
        if (!file) return;
        if (file.type && !file.type.startsWith("image/")) {
            onError(t("“{name}” is not an image (got {type}).", { name: file.name, type: file.type }));
            return;
        }
        setBusy(true);
        try {
            const name = await storeWallpaper(file);
            setWallpaper({ file: name });
        } catch (e) {
            onError(String(e));
        } finally {
            setBusy(false);
        }
    }

    function pick() {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "image/png,image/jpeg,image/webp,image/bmp,image/gif";
        input.onchange = () => takeImage(input.files?.[0]);
        input.click();
    }

    const pct = (v: number) => Math.round(v * 100);

    return (
        <>
            <h4 className="prefs-subhead">{t("Theme")}</h4>
            <div className="prefs-themes" role="radiogroup" aria-label={t("Theme")}>
                {(
                    [
                        ["light", t("Light")],
                        ["dark", t("Dark")],
                        ["system", t("Same as Windows")],
                        ["auto", t("Automatic")],
                    ] as const
                ).map(([id, label]) => (
                    <label key={id} className={`prefs-theme${draft.general.theme === id ? " active" : ""}`}>
                        <input
                            type="radio"
                            name="theme"
                            checked={draft.general.theme === id}
                            onChange={() => setTheme(id)}
                        />
                        <ThemeSample id={id} look={look} />
                        <span>{label}</span>
                    </label>
                ))}
            </div>
            {draft.general.theme === "auto" &&
                (hasWallpaper && look ? (
                    <div className="prefs-palette">
                        <span className="hint">
                            {look.palette.mode === "dark"
                                ? t("Colours taken from the wallpaper (dark image, dark theme):")
                                : t("Colours taken from the wallpaper (light image, light theme):")}
                        </span>
                        <span className="prefs-swatches">
                            {look.palette.swatches.map((c) => (
                                <span
                                    key={c}
                                    className={`prefs-swatch${c === look.palette.accent ? " accent" : ""}`}
                                    style={{ background: c }}
                                    title={c === look.palette.accent ? t("{color} (accent)", { color: c }) : c}
                                />
                            ))}
                        </span>
                    </div>
                ) : (
                    <p className="prefs-note">
                        {t("Choose a wallpaper below: the automatic theme takes its colours from it. Until then it follows Windows.")}
                    </p>
                ))}

            <h4 className="prefs-subhead">{t("Wallpaper")}</h4>
            <div className="prefs-wallpaper">
                <button
                    type="button"
                    className={`prefs-wallpaper-preview${dragOver ? " drag-over" : ""}`}
                    style={look ? { backgroundImage: `url("${look.url}")` } : undefined}
                    title={t("Choose an image or drop one here")}
                    disabled={busy}
                    onClick={pick}
                    onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "copy";
                        setDragOver(true);
                    }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={(e) => {
                        e.preventDefault();
                        setDragOver(false);
                        takeImage(e.dataTransfer.files[0]);
                    }}
                >
                    {busy ? (
                        <span>{t("Processing…")}</span>
                    ) : (
                        !hasWallpaper && (
                            <span>
                                <IconImage size={22} />
                                <br />
                                {t("Choose an image or drop one here")}
                            </span>
                        )
                    )}
                </button>
                <div className="prefs-wallpaper-actions">
                    <button type="button" onClick={pick} disabled={busy}>
                        <IconImage size={14} /> {hasWallpaper ? t("Change image…") : t("Choose image…")}
                    </button>
                    {hasWallpaper && (
                        <button type="button" onClick={() => setWallpaper({ file: "" })} disabled={busy}>
                            <IconTrash size={14} /> {t("Remove")}
                        </button>
                    )}
                </div>
            </div>
            {hasWallpaper && (
                <>
                    <Slider
                        label={t("Image visibility: {pct}%", { pct: pct(wallpaper.visibility) })}
                        hint={t("Lower it to soften the image with the theme colour.")}
                        min={0.1}
                        max={1}
                        step={0.05}
                        value={wallpaper.visibility}
                        onChange={(v) => setWallpaper({ visibility: v })}
                    />
                    <Slider
                        label={t("Panel opacity: {pct}%", { pct: pct(wallpaper.panel_opacity) })}
                        hint={t("How solid the binder, inspector, toolbars and editor are over the image.")}
                        min={0.3}
                        max={1}
                        step={0.02}
                        value={wallpaper.panel_opacity}
                        onChange={(v) => setWallpaper({ panel_opacity: v })}
                    />
                    <Slider
                        label={t("Blur: {px}px", { px: wallpaper.blur_px })}
                        min={0}
                        max={40}
                        step={1}
                        value={wallpaper.blur_px}
                        onChange={(v) => setWallpaper({ blur_px: v })}
                    />
                </>
            )}

            <h4 className="prefs-subhead">{t("Composition mode")}</h4>
            <label className="prefs-check">
                <input
                    type="checkbox"
                    checked={draft.composition.use_wallpaper}
                    disabled={!hasWallpaper}
                    onChange={(e) =>
                        setComposition({
                            use_wallpaper: e.target.checked,
                            // A solid page would hide the wallpaper completely.
                            page_opacity:
                                e.target.checked && draft.composition.page_opacity >= 1
                                    ? 0.82
                                    : draft.composition.page_opacity,
                        })
                    }
                />
                {hasWallpaper
                    ? t("Show the wallpaper behind the page, tinted with the background colour")
                    : t("Show the wallpaper behind the page (choose a wallpaper above first)")}
            </label>
            <div className="prefs-colors">
                <ColorField
                    label={t("Background")}
                    value={draft.composition.background}
                    onChange={(v) => setComposition({ background: v })}
                />
                <ColorField
                    label={t("Page")}
                    value={draft.composition.page_color}
                    onChange={(v) => setComposition({ page_color: v })}
                />
                <ColorField
                    label={t("Text")}
                    value={draft.composition.text_color}
                    onChange={(v) => setComposition({ text_color: v })}
                />
            </div>
            <Slider
                label={t("Page opacity: {pct}%", { pct: pct(draft.composition.page_opacity) })}
                min={0}
                max={1}
                step={0.05}
                value={draft.composition.page_opacity}
                onChange={(v) => setComposition({ page_opacity: v })}
            />
        </>
    );
}

/// Small window drawing of a theme.
function ThemeSample({ id, look }: { id: Preferences["general"]["theme"]; look: WallpaperLook | null }) {
    let style: React.CSSProperties | undefined;
    if (id === "auto" && look) {
        const vars = autoThemeVars(look.palette);
        style = {
            backgroundImage: `url("${look.url}")`,
            ["--s-bar" as string]: vars["--bg-toolbar"],
            ["--s-side" as string]: vars["--bg-sidebar"],
            ["--s-page" as string]: vars["--bg-elevated"],
            ["--s-accent" as string]: vars["--accent"],
        };
    }
    return (
        <span className={`prefs-theme-sample sample-${id}`} style={style} aria-hidden="true">
            <span className="bar" />
            <span className="side" />
            <span className="page" />
        </span>
    );
}

function Slider({
    label,
    hint,
    min,
    max,
    step,
    value,
    onChange,
}: {
    label: string;
    hint?: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
}) {
    return (
        <label className="form-field">
            <span className="form-field-label">{label}</span>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => {
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChange(n);
                }}
            />
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
