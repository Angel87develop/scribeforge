/// Global preferences, loaded once from the Rust settings file and shared
/// through React context.
///
/// Applying preferences means: the interface language is set (see
/// `i18n`), the theme goes on `<html data-theme>` (with
/// "system" following the OS setting), the active writing format profile
/// becomes CSS variables (`--editor-font`, `--editor-font-size`,
/// `--editor-line-height`, `--editor-align`, `--editor-indent`, ...; see
/// `formatProfiles.ts`) and the text width becomes `--editor-text-width`,
/// all read by the editor stylesheet. The smart typography options go to
/// the editor extension that applies them.

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { api, type BuiltinFormatProfile, type Preferences } from "./api";
import { editorFormatVars, resolveProfile } from "./formatProfiles";
import { setTypographyOptions } from "../components/SfExtensions";
import { LanguageContext, getLanguage, setLanguage, type Language } from "../i18n";

interface PreferencesContextValue {
    /** Null until loaded (or when running outside the desktop app). */
    prefs: Preferences | null;
    /** The built-in writing format profiles, with their original values. */
    formatProfiles: BuiltinFormatProfile[];
    /** Store new preferences; resolves with what the backend kept. */
    save: (prefs: Preferences) => Promise<Preferences>;
}

const PreferencesContext = createContext<PreferencesContextValue>({
    prefs: null,
    formatProfiles: [],
    save: async (p) => p,
});

function resolvedTheme(theme: Preferences["general"]["theme"]): "light" | "dark" {
    if (theme === "system") {
        return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return theme;
}

/// Put the active profile's editor format and the text width on `<html>`.
/// Also used by the preferences dialog to preview unsaved changes live.
export function applyEditorFormat(p: Preferences, builtins: BuiltinFormatProfile[]) {
    const root = document.documentElement;
    const profile = resolveProfile(p.format, builtins);
    if (profile) {
        for (const [name, value] of Object.entries(editorFormatVars(profile))) {
            root.style.setProperty(name, value);
        }
    }
    root.style.setProperty("--editor-text-width", `${p.editor.text_width_px}px`);
}

export function applyPreferences(p: Preferences, builtins: BuiltinFormatProfile[]) {
    setLanguage(p.general.language);
    document.documentElement.dataset.theme = resolvedTheme(p.general.theme);
    applyEditorFormat(p, builtins);
    setTypographyOptions({
        quotes: p.editor.smart_quotes ?? "angular",
        ellipsis: p.editor.smart_ellipsis ?? true,
        dialogueDash: p.editor.dialogue_dash ?? true,
    });
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
    const [prefs, setPrefs] = useState<Preferences | null>(null);
    const [formatProfiles, setFormatProfiles] = useState<BuiltinFormatProfile[]>([]);
    // Kept apart from `prefs` so that a change always reaches the context.
    const [language, setLanguageState] = useState<Language>(getLanguage());
    // Nothing renders until the preferences are known, so the first screen
    // already appears in the chosen language.
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        Promise.all([api.getPreferences(), api.listFormatProfiles()])
            .then(([p, builtins]) => {
                applyPreferences(p, builtins);
                setPrefs(p);
                setFormatProfiles(builtins);
                setLanguageState(getLanguage());
            })
            .catch(() => setPrefs(null))
            .finally(() => setLoaded(true));
    }, []);

    // "System" theme follows the OS while the app runs.
    useEffect(() => {
        if (prefs?.general.theme !== "system" || !window.matchMedia) return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = () => applyPreferences(prefs, formatProfiles);
        mq.addEventListener("change", onChange);
        return () => mq.removeEventListener("change", onChange);
    }, [prefs, formatProfiles]);

    const save = useCallback(
        async (next: Preferences) => {
            const stored = await api.updatePreferences(next);
            applyPreferences(stored, formatProfiles);
            setPrefs(stored);
            setLanguageState(getLanguage());
            return stored;
        },
        [formatProfiles],
    );

    return (
        <PreferencesContext.Provider value={{ prefs, formatProfiles, save }}>
            <LanguageContext.Provider value={language}>{loaded ? children : null}</LanguageContext.Provider>
        </PreferencesContext.Provider>
    );
}

export function usePreferences(): PreferencesContextValue {
    return useContext(PreferencesContext);
}
