/// Wallpaper and the automatic theme.
///
/// The wallpaper is an image drawn behind the whole interface: the window
/// background becomes transparent, the image is covered by the theme's window
/// colour (less of it the more "visibility" is set) and the large panels
/// (binder, inspector, toolbars, editor) let it show through. Menus, dialogs
/// and inputs stay opaque so they remain readable.
///
/// The automatic theme ("auto") takes its colours from the wallpaper: the
/// image is reduced to a few colour clusters, its brightness decides between
/// a light and a dark interface, the dominant colour tints the surfaces and
/// the most vivid frequent colour becomes the accent.

import { api, type Preferences } from "./api";

export interface Palette {
    mode: "light" | "dark";
    /** Dominant colour, tints the surfaces. */
    base: string;
    /** Most vivid frequent colour, used for buttons and selections. */
    accent: string;
    /** Main colours of the image, most frequent first. */
    swatches: string[];
}

export interface WallpaperLook {
    /** Object URL of the image, for CSS. */
    url: string;
    palette: Palette;
}

/** Longest side of the stored image; larger images are scaled down. */
const MAX_SIDE = 2560;

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const cache = new Map<string, Promise<WallpaperLook>>();

/// The image stored as `file` (see `set_wallpaper`), with its palette.
export function loadWallpaper(file: string): Promise<WallpaperLook> {
    let look = cache.get(file);
    if (!look) {
        look = api.getWallpaper(file).then(lookFromDataUrl);
        look.catch(() => cache.delete(file));
        cache.set(file, look);
    }
    return look;
}

/// Store a picked image as the wallpaper: scaled down, sent to the backend
/// and cached. Resolves with the file name for `appearance.wallpaper.file`.
export async function storeWallpaper(file: Blob): Promise<string> {
    const dataUrl = await scaleDown(file);
    const name = await api.setWallpaper(dataUrl);
    cache.set(name, lookFromDataUrl(dataUrl));
    return name;
}

async function lookFromDataUrl(dataUrl: string): Promise<WallpaperLook> {
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    return { url, palette: extractPalette(img) };
}

function loadImage(src: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("The image could not be read."));
        img.src = src;
    });
}

/// Re-encode the image as JPEG, no larger than MAX_SIDE on its longest side.
async function scaleDown(file: Blob): Promise<string> {
    const src = URL.createObjectURL(file);
    try {
        const img = await loadImage(src);
        const w = img.naturalWidth;
        const h = img.naturalHeight;
        if (!w || !h) throw new Error("The image has no size.");
        const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("The image could not be read.");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL("image/jpeg", 0.9);
    } finally {
        URL.revokeObjectURL(src);
    }
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

type Rgb = [number, number, number];
type Hsl = [number, number, number];

function hex([r, g, b]: Rgb): string {
    return "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
}

function parseHex(color: string): Rgb | null {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
    if (!m) return null;
    const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as Rgb;
}

function rgbToHsl([r, g, b]: Rgb): Hsl {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    return [h, s, l];
}

function hslToRgb([h, s, l]: Hsl): Rgb {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const [r, g, b] =
        h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function hsl(h: number, s: number, l: number): string {
    return hex(hslToRgb([h, Math.max(0, Math.min(1, s)), Math.max(0, Math.min(1, l))]));
}

/** WCAG relative luminance. */
function luminance([r, g, b]: Rgb): number {
    const lin = (v: number) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function contrast(a: Rgb, b: Rgb): number {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
}

/// Reduce the image to its main colours.
export function extractPalette(img: HTMLImageElement): Palette {
    const size = 80;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return { mode: "light", base: "#ece9e2", accent: "#6b5b3e", swatches: [] };
    ctx.drawImage(img, 0, 0, size, size);
    const data = ctx.getImageData(0, 0, size, size).data;

    // Count pixels per 4-bit colour bucket.
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>();
    let total = 0;
    let lightness = 0;
    for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] < 128) continue;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
        const bucket = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
        bucket.n++;
        bucket.r += r;
        bucket.g += g;
        bucket.b += b;
        buckets.set(key, bucket);
        total++;
        lightness += rgbToHsl([r, g, b])[2];
    }
    if (!total) return { mode: "light", base: "#ece9e2", accent: "#6b5b3e", swatches: [] };

    // Merge neighbouring buckets into clusters, largest first.
    const clusters: { n: number; rgb: Rgb }[] = [];
    const sorted = [...buckets.values()].sort((a, b) => b.n - a.n);
    for (const bucket of sorted) {
        const rgb: Rgb = [bucket.r / bucket.n, bucket.g / bucket.n, bucket.b / bucket.n];
        const near = clusters.find((c) => Math.hypot(c.rgb[0] - rgb[0], c.rgb[1] - rgb[1], c.rgb[2] - rgb[2]) < 56);
        if (near) {
            const n = near.n + bucket.n;
            near.rgb = near.rgb.map((v, i) => (v * near.n + rgb[i] * bucket.n) / n) as Rgb;
            near.n = n;
        } else {
            clusters.push({ n: bucket.n, rgb });
        }
    }
    clusters.sort((a, b) => b.n - a.n);

    const base = clusters[0].rgb;
    // Accent: vivid, not too dark or light, and present enough to belong.
    // Vividness weighs most, so a small bright detail beats a dull backdrop.
    let accent = base;
    let best = -1;
    for (const c of clusters) {
        const share = c.n / total;
        if (share < 0.005) continue;
        const [, s, l] = rgbToHsl(c.rgb);
        const score = share ** 0.3 * s * s * (1 - Math.min(1, Math.abs(l - 0.5) * 1.6)) * (c === clusters[0] ? 0.6 : 1);
        if (score > best) {
            best = score;
            accent = c.rgb;
        }
    }

    return {
        mode: lightness / total >= 0.5 ? "light" : "dark",
        base: hex(base),
        accent: hex(accent),
        swatches: clusters.slice(0, 6).map((c) => hex(c.rgb)),
    };
}

/// Lightness of the accent moved until text on it reaches 4.5:1.
function readableAccent(h: number, s: number, l: number, text: Rgb, darker: boolean): string {
    for (let i = 0; i < 40; i++) {
        if (contrast(hslToRgb([h, s, l]), text) >= 4.5) break;
        l = Math.max(0, Math.min(1, l + (darker ? -0.02 : 0.02)));
    }
    return hsl(h, s, l);
}

/// The interface colours (CSS variables of `global.css`) for a palette.
export function autoThemeVars(p: Palette): Record<string, string> {
    const [bh, bs] = rgbToHsl(parseHex(p.base) ?? [236, 233, 226]);
    const [ah, as0] = rgbToHsl(parseHex(p.accent) ?? [107, 91, 62]);
    // Grey images get a gently tinted accent rather than a grey one.
    const accentHue = as0 < 0.12 ? bh : ah;
    const as = as0 < 0.12 ? 0.3 : Math.max(0.35, Math.min(0.7, as0));
    const ns = Math.max(0.04, Math.min(0.2, bs * 0.45));
    const n = (l: number, s = ns) => hsl(bh, s, l);
    const a = (l: number, s = as) => hsl(accentHue, s, l);

    if (p.mode === "light") {
        const onPrimary: Rgb = [250, 248, 244];
        const accent = readableAccent(accentHue, as, 0.42, onPrimary, true);
        const [, , al] = rgbToHsl(parseHex(accent)!);
        return {
            "--bg-window": n(0.9),
            "--bg-panel": n(0.955),
            "--bg-elevated": n(0.99),
            "--bg-sidebar": n(0.875),
            "--bg-sidebar-hover": n(0.83),
            "--bg-sidebar-active": a(0.78, as * 0.6),
            "--bg-row-hover": n(0.9),
            "--bg-row-selected": a(0.82, as * 0.6),
            "--bg-input": n(0.995),
            "--bg-button": n(0.885),
            "--bg-button-hover": n(0.845),
            "--bg-button-primary": accent,
            "--bg-button-primary-hover": a(al - 0.07),
            "--bg-toolbar": n(0.86),
            "--text-primary": n(0.14, ns * 0.8),
            "--text-secondary": n(0.36, ns * 0.8),
            "--text-muted": n(0.47, ns * 0.8),
            "--text-on-primary": hex(onPrimary),
            "--text-sidebar": n(0.2, ns * 0.8),
            "--border": n(0.76),
            "--border-light": n(0.84),
            "--border-strong": n(0.63),
            "--separator": n(0.81),
            "--accent": accent,
            "--accent-hover": a(al - 0.07),
            "--focus-ring": a(al + 0.1),
        };
    }
    const onPrimary: Rgb = [24, 22, 20];
    const accent = readableAccent(accentHue, as, 0.6, onPrimary, false);
    const [, , al] = rgbToHsl(parseHex(accent)!);
    return {
        "--bg-window": n(0.11),
        "--bg-panel": n(0.14),
        "--bg-elevated": n(0.17),
        "--bg-sidebar": n(0.095),
        "--bg-sidebar-hover": n(0.165),
        "--bg-sidebar-active": a(0.26, as * 0.5),
        "--bg-row-hover": n(0.17),
        "--bg-row-selected": a(0.3, as * 0.5),
        "--bg-input": n(0.17),
        "--bg-button": n(0.2),
        "--bg-button-hover": n(0.24),
        "--bg-button-primary": accent,
        "--bg-button-primary-hover": a(al + 0.07),
        "--bg-toolbar": n(0.125),
        "--text-primary": n(0.88, ns * 0.6),
        "--text-secondary": n(0.68, ns * 0.6),
        "--text-muted": n(0.55, ns * 0.6),
        "--text-on-primary": hex(onPrimary),
        "--text-sidebar": n(0.8, ns * 0.6),
        "--border": n(0.25),
        "--border-light": n(0.19),
        "--border-strong": n(0.33),
        "--separator": n(0.19),
        "--accent": accent,
        "--accent-hover": a(al + 0.07),
        "--focus-ring": a(al - 0.08),
    };
}

// ---------------------------------------------------------------------------
// Applying
// ---------------------------------------------------------------------------

/** Every variable this module may set on `<html>`. */
const THEME_VARS = Object.keys(autoThemeVars({ mode: "light", base: "#888888", accent: "#888888", swatches: [] }));
/** Large surfaces that let the wallpaper show through. */
const SEE_THROUGH = ["--bg-panel", "--bg-sidebar", "--bg-toolbar", "--bg-editor"];

function systemTheme(): "light" | "dark" {
    return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function withAlpha(color: string, alpha: number): string {
    const rgb = parseHex(color);
    if (!rgb) return color;
    return `rgba(${rgb.map(Math.round).join(", ")}, ${alpha})`;
}

/// Put the theme and the wallpaper on the page. `look` is the loaded
/// `appearance.wallpaper.file`, or null for none. The automatic theme falls
/// back to the system one while there is no wallpaper.
export function applyAppearance(p: Preferences, look: WallpaperLook | null) {
    const root = document.documentElement;
    for (const name of [...THEME_VARS, "--bg-editor", "--bg-window"]) root.style.removeProperty(name);

    const theme = p.general.theme;
    if (theme === "auto" && look) {
        root.dataset.theme = look.palette.mode;
        for (const [name, value] of Object.entries(autoThemeVars(look.palette))) root.style.setProperty(name, value);
    } else {
        root.dataset.theme = theme === "light" || theme === "dark" ? theme : systemTheme();
    }

    let layer = document.getElementById("sf-wallpaper");
    if (!look) {
        layer?.remove();
        delete root.dataset.wallpaper;
        return;
    }

    const styles = getComputedStyle(root);
    const value = (name: string) => styles.getPropertyValue(name).trim();
    const windowColor = value("--bg-window");
    const surfaces = Object.fromEntries(
        SEE_THROUGH.map((name) => [name, value(name === "--bg-editor" ? "--bg-elevated" : name)]),
    );
    const w = p.appearance.wallpaper;
    for (const [name, color] of Object.entries(surfaces)) {
        root.style.setProperty(name, withAlpha(color, w.panel_opacity));
    }
    root.style.setProperty("--bg-window", "transparent");
    root.dataset.wallpaper = "on";

    if (!layer) {
        layer = document.createElement("div");
        layer.id = "sf-wallpaper";
        layer.setAttribute("aria-hidden", "true");
        layer.innerHTML = '<div class="sf-wallpaper-image"></div><div class="sf-wallpaper-tint"></div>';
        document.body.prepend(layer);
    }
    const image = layer.firstElementChild as HTMLElement;
    const tint = layer.lastElementChild as HTMLElement;
    image.style.backgroundImage = `url("${look.url}")`;
    image.style.filter = w.blur_px ? `blur(${w.blur_px}px)` : "";
    image.style.inset = w.blur_px ? `${-2 * w.blur_px}px` : "0";
    tint.style.background = withAlpha(windowColor, 1 - w.visibility);
}

/// Load the wallpaper of `p` (if any) and apply the appearance. A wallpaper
/// that cannot be read is left out.
export async function applyAppearanceOf(p: Preferences): Promise<void> {
    const file = p.appearance.wallpaper.file;
    const look = file ? await loadWallpaper(file).catch(() => null) : null;
    applyAppearance(p, look);
}
