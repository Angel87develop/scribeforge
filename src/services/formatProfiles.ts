/// Writing format profiles on the frontend: resolving the active profile,
/// turning its editor half into CSS variables, and handling fonts that are
/// not installed.
///
/// The eight built-in profiles are defined in Rust (`format_profiles.rs`) and
/// fetched once; the user's changes travel inside `Preferences.format`.
/// Profiles never touch document content: the editor stylesheet reads the
/// variables below as defaults, and paragraphs with their own formatting
/// (from the paragraph dialog or the format bar) keep it.

import type { BuiltinFormatProfile, FormatProfile, FormatSettings } from "./api";

/// Fonts suggested for profiles. Any other installed font can be typed.
export const EDITOR_FONTS = [
    "Georgia",
    "Times New Roman",
    "Palatino Linotype",
    "Book Antiqua",
    "Cambria",
    "Garamond",
    "Courier New",
    "Consolas",
    "Segoe UI",
    "Calibri",
    "Arial",
    "Verdana",
];

/// Limits for user input. They mirror `FormatProfile::sanitize` in Rust,
/// which has the last word.
export const PROFILE_LIMITS = {
    font_size_pt: { min: 6, max: 48, step: 0.5 },
    line_height: { min: 0.8, max: 3, step: 0.05 },
    first_line_indent_cm: { min: 0, max: 5, step: 0.05 },
    space_pt: { min: 0, max: 72, step: 1 },
    margin_cm: { min: 0.7, max: 7.5, step: 0.05 },
    chapter_title_size_pt: { min: 0, max: 72, step: 1 },
} as const;

/// Word-processor line spacing is a multiple of the font's natural line
/// height (about 1.15 em), while CSS `line-height` multiplies the font size.
/// The editor uses the same factor as the compile writers so the text looks
/// alike in both.
const SINGLE_LINE_EM = 1.15;

/// Similar fonts tried, in order, when a profile's font is missing.
const FALLBACKS: Record<string, string[]> = {
    "palatino linotype": ["Book Antiqua", "Palatino", "URW Palladio L", "P052"],
    "book antiqua": ["Palatino Linotype", "Palatino", "URW Palladio L"],
    garamond: ["EB Garamond", "Adobe Garamond Pro", "Garamond Premier Pro", "Cormorant Garamond", "Times New Roman"],
    georgia: ["Gelasio", "Times New Roman"],
    "times new roman": ["Times", "Liberation Serif", "Tinos"],
    cambria: ["Caladea", "Georgia"],
};

function generic(family: string): "serif" | "sans-serif" | "monospace" {
    const f = family.toLowerCase();
    if (/courier|consolas|mono/.test(f)) return "monospace";
    if (/arial|helvetica|verdana|segoe|calibri|sans/.test(f)) return "sans-serif";
    return "serif";
}

function cleanFamily(family: string): string {
    return family.replace(/["'`;{}<>\\]/g, "").trim();
}

/// CSS `font-family` value: the font, its look-alikes, then a generic family.
export function fontStack(family: string): string {
    const f = cleanFamily(family);
    const names = f ? [f, ...(FALLBACKS[f.toLowerCase()] ?? [])] : [];
    return [...names.map((n) => `"${n}"`), generic(f)].join(", ");
}

const availability = new Map<string, boolean>();

/// Whether a font is installed, measured by comparing text widths against
/// the generic families (the Font Loading API cannot tell for local fonts).
export function isFontAvailable(family: string): boolean {
    const f = cleanFamily(family);
    if (!f) return false;
    const cached = availability.get(f);
    if (cached !== undefined) return cached;
    const ctx = typeof document !== "undefined" ? document.createElement("canvas").getContext("2d") : null;
    if (!ctx) return true;
    const sample = "mmmmmmmmmmlli1WWQ@#ñ";
    const found = (["monospace", "serif", "sans-serif"] as const).some((base) => {
        ctx.font = `72px ${base}`;
        const plain = ctx.measureText(sample).width;
        ctx.font = `72px "${f}", ${base}`;
        return ctx.measureText(sample).width !== plain;
    });
    availability.set(f, found);
    return found;
}

/// The font the editor will actually show for `family`: the font itself,
/// the first installed look-alike, or null for the generic family.
export function resolvedFont(family: string): string | null {
    const f = cleanFamily(family);
    if (isFontAvailable(f)) return f;
    return (FALLBACKS[f.toLowerCase()] ?? []).find(isFontAvailable) ?? null;
}

/// The profile with the user's changes, or the built-in values.
export function resolveProfile(
    format: FormatSettings,
    builtins: BuiltinFormatProfile[],
    id: string = format.active_profile,
): FormatProfile | null {
    return format.custom[id] ?? builtins.find((b) => b.id === id)?.profile ?? builtins[0]?.profile ?? null;
}

function canonical(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(canonical);
    if (v && typeof v === "object") {
        return Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
                .sort()
                .map((k) => [k, canonical((v as Record<string, unknown>)[k])]),
        );
    }
    return typeof v === "number" ? Math.round(v * 1000) / 1000 : v;
}

export function sameProfile(a: FormatProfile, b: FormatProfile): boolean {
    return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/// Store `profile` as the user's version of `id`, or drop the entry when it
/// matches the built-in values. Other profiles are left untouched.
export function withCustomProfile(
    format: FormatSettings,
    builtins: BuiltinFormatProfile[],
    id: string,
    profile: FormatProfile | null,
): FormatSettings {
    const custom = { ...format.custom };
    const original = builtins.find((b) => b.id === id)?.profile;
    if (!profile || (original && sameProfile(profile, original))) delete custom[id];
    else custom[id] = profile;
    return { ...format, custom };
}

/// CSS variables for the editor half of a profile, read by
/// `editor-pane.css`. Used both on `<html>` and on the preview sample.
export function editorFormatVars(p: FormatProfile): Record<string, string> {
    const indent = `${p.first_line_indent_cm}cm`;
    return {
        "--editor-font": fontStack(p.font_family),
        "--editor-font-size": `${p.font_size_pt}pt`,
        "--editor-line-height": String(Math.round(p.line_height * SINGLE_LINE_EM * 1000) / 1000),
        "--editor-align": p.alignment,
        "--editor-indent": indent,
        "--editor-indent-after-heading": p.no_indent_after_heading ? "0" : indent,
        "--editor-para-before": `${p.space_before_pt}pt`,
        "--editor-para-after": `${p.space_after_pt}pt`,
    };
}
