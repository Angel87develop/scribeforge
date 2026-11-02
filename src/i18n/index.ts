/// Interface translation.
///
/// English is the source language: every visible string is written in
/// English and wrapped in `t()`, and that English text is the key looked up
/// in the translation tables (`es.ts`). A missing translation falls back to
/// the English text, so nothing ever shows a raw key.
///
/// `{name}` placeholders are filled from the `vars` argument:
/// `t("Joined {n} lines", { n: 3 })`.
///
/// The language comes from `Preferences.general.language`. The preferences
/// provider calls `setLanguage` and publishes the language through
/// `LanguageContext`; the app root (and memoised components) read it with
/// `useLanguage()` so that the whole tree renders again in the new language
/// without losing any state.

import { createContext, useContext } from "react";
import { es } from "./es";

export type Language = "en" | "es";

/// Languages offered in the preferences, each named in its own language.
export const LANGUAGES: { id: Language; name: string }[] = [
    { id: "en", name: "English" },
    { id: "es", name: "Español" },
];

const TABLES: Record<Language, Record<string, string> | null> = {
    en: null,
    es,
};

let current: Language = "en";
const reported = new Set<string>();

export function isLanguage(v: unknown): v is Language {
    return v === "en" || v === "es";
}

export function setLanguage(lang: string) {
    current = isLanguage(lang) ? lang : "en";
    const root = document.documentElement;
    root.lang = current;
    // Text the stylesheets draw themselves (empty-editor placeholder).
    root.style.setProperty("--editor-placeholder", JSON.stringify(t("Start writing…")));
}

export function getLanguage(): Language {
    return current;
}

/// Translate an English interface string into the current language.
export function t(text: string, vars?: Record<string, string | number>): string {
    const table = TABLES[current];
    let out = text;
    if (table) {
        const found = table[text];
        if (found !== undefined) {
            out = found;
        } else if (import.meta.env.DEV && text && !reported.has(text)) {
            reported.add(text);
            console.warn(`[i18n] missing ${current} translation: ${JSON.stringify(text)}`);
        }
    }
    if (vars) {
        out = out.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
    }
    return out;
}

/// `one` when `n` is 1, `other` otherwise; both translated, `{n}` filled in.
export function tn(n: number, one: string, other: string, vars?: Record<string, string | number>): string {
    return t(n === 1 ? one : other, { n: n.toLocaleString(current), ...vars });
}

export const LanguageContext = createContext<Language>("en");

/// Subscribe a component to language changes (it renders again on change).
export function useLanguage(): Language {
    return useContext(LanguageContext);
}
