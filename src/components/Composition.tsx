/// Composition mode: full-screen, distraction-free writing.
///
/// Shows the selected document alone on a page over a plain backdrop, or
/// over the wallpaper (tinted with the backdrop colour, with a frosted
/// semi-transparent page); a folder (or a document with subdocuments) is
/// shown as Scrivenings without section titles. Background, wallpaper, page
/// and text colours, page width, text size and page opacity are adjustable
/// from a bar that appears when the pointer reaches the bottom of the
/// screen. Changes are kept as the new defaults.
///
/// The window goes full screen while composition mode is open; Escape (or
/// F11) leaves it. The workspace editors are unmounted meanwhile, so the
/// document is never open in two editors at once.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api, type DocumentDto, type DocumentMetaDto, type Preferences, type RichDoc } from "../services/api";
import { usePreferences } from "../services/preferences";
import { descendants, displayTitle, isFolderKind } from "./binderTree";
import { RichTextEditor, type EditorApi } from "./RichTextEditor";
import { Scrivenings } from "./Scrivenings";
import { IconClose, IconImage } from "./Icons";
import { loadWallpaper, type WallpaperLook } from "../services/wallpaper";
import { PomodoroPill, PomodoroToggle } from "./Pomodoro";
import "../styles/composition.css";
import { t, tn } from "../i18n";

type CompositionPrefs = Preferences["composition"];

const DEFAULTS: CompositionPrefs = {
    background: "#2b2620",
    page_color: "#f7f3ea",
    text_color: "#2b2620",
    page_width_px: 720,
    font_size: 18,
    page_opacity: 1,
    use_wallpaper: false,
};

/** Page opacity given when the wallpaper is turned on over a solid page. */
const WALLPAPER_PAGE_OPACITY = 0.82;

const BACKDROPS = ["#2b2620", "#1d2430", "#2f3a2f", "#3b2f3f", "#e8e3d8", "#000000"];

function hexToRgba(hex: string, alpha: number): string {
    let h = hex.replace("#", "");
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    const n = parseInt(h, 16);
    if (h.length !== 6 || Number.isNaN(n)) return hex;
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

async function setFullscreen(on: boolean) {
    try {
        await getCurrentWindow().setFullscreen(on);
    } catch {
        // Outside the desktop app (or without the permission): use the
        // browser's own full-screen mode instead.
        try {
            if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
            if (!on && document.fullscreenElement) await document.exitFullscreen();
        } catch {
            // Full screen is a nicety; composition mode works without it.
        }
    }
}

interface Props {
    target: DocumentMetaDto;
    binder: DocumentMetaDto[];
    onContentChanged: (id: string, doc: RichDoc, wordCount: number) => void;
    registerEditorApi: (key: string, api: EditorApi | null) => void;
    onExit: () => void;
    onError: (msg: string) => void;
}

export function Composition({ target, binder, onContentChanged, registerEditorApi, onExit, onError }: Props) {
    const { prefs, save } = usePreferences();
    const [look, setLook] = useState<CompositionPrefs>({ ...DEFAULTS, ...prefs?.composition });
    const [doc, setDoc] = useState<DocumentDto | null>(null);
    const wallpaper = prefs?.appearance.wallpaper;
    const [image, setImage] = useState<WallpaperLook | null>(null);
    const showWallpaper = look.use_wallpaper && !!wallpaper?.file;

    useEffect(() => {
        if (!showWallpaper || !wallpaper?.file) {
            setImage(null);
            return;
        }
        let current = true;
        loadWallpaper(wallpaper.file)
            .then((l) => current && setImage(l))
            .catch((e) => current && onError(String(e)));
        return () => {
            current = false;
        };
    }, [showWallpaper, wallpaper?.file, onError]);

    const grouped = isFolderKind(target.kind) || binder.some((d) => d.parent === target.id);

    useEffect(() => {
        setFullscreen(true);
        return () => {
            setFullscreen(false);
        };
    }, []);

    useEffect(() => {
        if (grouped) return;
        api.getDocument(target.id)
            .then(setDoc)
            .catch((e) => onError(String(e)));
    }, [grouped, target.id, onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape" || e.key === "F11") {
                e.preventDefault();
                e.stopPropagation();
                onExit();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onExit]);

    // Keep adjustments as the new defaults (debounced).
    const prefsRef = useRef(prefs);
    prefsRef.current = prefs;
    const adjusted = useRef(false);
    const adjust = useCallback((patch: Partial<CompositionPrefs>) => {
        adjusted.current = true;
        setLook((l) => ({ ...l, ...patch }));
    }, []);
    useEffect(() => {
        if (!adjusted.current) return;
        const t = window.setTimeout(() => {
            const p = prefsRef.current;
            if (p) save({ ...p, composition: look }).catch((e) => onError(String(e)));
        }, 600);
        return () => window.clearTimeout(t);
    }, [look, save, onError]);

    const register = useCallback((a: EditorApi | null) => registerEditorApi("composition", a), [registerEditorApi]);
    useEffect(() => () => register(null), [register]);

    const words = useMemo(() => {
        if (!grouped) return binder.find((d) => d.id === target.id)?.word_count ?? 0;
        const own = isFolderKind(target.kind) ? 0 : target.word_count;
        return own + descendants(binder, target.id).reduce((n, r) => n + r.meta.word_count, 0);
    }, [binder, grouped, target]);

    const style = {
        background: look.background,
        "--editor-text-width": `${look.page_width_px}px`,
        "--editor-font-size": `${look.font_size}px`,
        "--comp-page": hexToRgba(look.page_color, look.page_opacity),
        "--comp-text": look.text_color,
    } as React.CSSProperties;

    const toggleWallpaper = () => {
        const on = !look.use_wallpaper;
        adjust({
            use_wallpaper: on,
            // A solid page would hide the wallpaper completely.
            page_opacity: on && look.page_opacity >= 1 ? WALLPAPER_PAGE_OPACITY : look.page_opacity,
        });
    };

    return (
        <div className={`comp-root${image ? " with-wallpaper" : ""}`} style={style}>
            {image && wallpaper && (
                <div className="comp-wallpaper" aria-hidden="true">
                    <div
                        className="comp-wallpaper-image"
                        style={{
                            backgroundImage: `url("${image.url}")`,
                            filter: wallpaper.blur_px ? `blur(${wallpaper.blur_px}px)` : undefined,
                            inset: wallpaper.blur_px ? -2 * wallpaper.blur_px : 0,
                        }}
                    />
                    <div className="comp-wallpaper-tint" style={{ background: hexToRgba(look.background, 1 - wallpaper.visibility) }} />
                </div>
            )}
            <div className="comp-scroll">
                <div className="comp-page">
                    {grouped ? (
                        <Scrivenings
                            rootId={target.id}
                            binder={binder}
                            paneKey="composition"
                            includeRoot={!isFolderKind(target.kind)}
                            plain
                            onContentChanged={onContentChanged}
                            registerEditorApi={(_k, a) => register(a)}
                            onError={onError}
                        />
                    ) : doc ? (
                        <RichTextEditor
                            key={doc.id}
                            initialContent={doc.content}
                            paneId="composition"
                            onContentChanged={(rich, n) => onContentChanged(doc.id, rich, n)}
                            registerApi={register}
                        />
                    ) : (
                        <div className="comp-loading">{t("Loading…")}</div>
                    )}
                </div>
            </div>

            <PomodoroPill />
            <div className="comp-bar-zone">
                <div className="comp-bar">
                    <span className="comp-title">{displayTitle(target)}</span>
                    <span className="comp-words">{tn(words, "{n} word", "{n} words")}</span>
                    <span className="comp-sep" />
                    <span className="comp-label">{t("Background")}</span>
                    {BACKDROPS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            className={`comp-swatch${look.background === c ? " active" : ""}`}
                            style={{ background: c }}
                            title={c}
                            onClick={() => adjust({ background: c })}
                        />
                    ))}
                    <input type="color" title={t("Custom background")} value={look.background} onChange={(e) => adjust({ background: e.target.value })} />
                    <button
                        type="button"
                        className={`comp-toggle${look.use_wallpaper ? " active" : ""}`}
                        aria-pressed={look.use_wallpaper}
                        disabled={!wallpaper?.file}
                        title={
                            wallpaper?.file
                                ? t("Show the wallpaper behind the page, tinted with the background colour")
                                : t("Choose a wallpaper in Preferences → Personalization first")
                        }
                        onClick={toggleWallpaper}
                    >
                        <IconImage size={14} /> {t("Wallpaper")}
                    </button>
                    <span className="comp-label">{t("Page")}</span>
                    <input type="color" title={t("Page colour")} value={look.page_color} onChange={(e) => adjust({ page_color: e.target.value })} />
                    <span className="comp-label">{t("Text")}</span>
                    <input type="color" title={t("Text colour")} value={look.text_color} onChange={(e) => adjust({ text_color: e.target.value })} />
                    <span className="comp-sep" />
                    <label className="comp-range">
                        {t("Width")}
                        <input
                            type="range"
                            min={400}
                            max={1400}
                            step={20}
                            value={look.page_width_px}
                            onChange={(e) => adjust({ page_width_px: Number(e.target.value) })}
                        />
                    </label>
                    <label className="comp-range">
                        {t("Size")}
                        <input
                            type="range"
                            min={12}
                            max={32}
                            value={look.font_size}
                            onChange={(e) => adjust({ font_size: Number(e.target.value) })}
                        />
                    </label>
                    <label className="comp-range">
                        {t("Opacity")}
                        <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={look.page_opacity}
                            onChange={(e) => adjust({ page_opacity: Number(e.target.value) })}
                        />
                    </label>
                    <span className="spacer" />
                    <PomodoroToggle />
                    <button type="button" className="comp-exit" onClick={onExit} title={t("Leave composition mode (Esc)")}>
                        <IconClose size={14} /> {t("Exit")}
                    </button>
                </div>
            </div>
        </div>
    );
}
