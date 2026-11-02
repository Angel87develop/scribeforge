/// Spelling: the project's checking languages and its personal dictionary.
///
/// Both are stored in the `.scri` file, so they travel with the project.
/// Words are added to the dictionary from the editor's right-click menu on
/// an underlined word, or typed here.

import { useEffect, useState } from "react";
import { api, type SpellingDto } from "../services/api";
import { IconCheck } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/writing.css";
import { getLanguage, t } from "../i18n";

interface Props {
    onClose: () => void;
    onError: (msg: string) => void;
    /** Called whenever the language or the dictionary changed. */
    onChanged: (spelling: SpellingDto) => void;
}

export const SPELL_LANGUAGES: { id: string; label: string }[] = [
    { id: "es", label: "Español" },
    { id: "en", label: "English" },
    { id: "es,en", label: "Español + English" },
    { id: "off", label: "Off (no spell checking)" },
];

export function SpellingDialog({ onClose, onError, onChanged }: Props) {
    const [spelling, setSpelling] = useState<SpellingDto | null>(null);
    const [word, setWord] = useState("");
    const [filter, setFilter] = useState("");

    useEffect(() => {
        api.getSpelling()
            .then(setSpelling)
            .catch((e) => onError(String(e)));
    }, [onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    async function apply(p: Promise<SpellingDto>) {
        try {
            const s = await p;
            setSpelling(s);
            onChanged(s);
        } catch (e) {
            onError(String(e));
        }
    }

    const words = (spelling?.dictionary ?? []).filter((w) => w.toLowerCase().includes(filter.toLowerCase()));

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog spelling-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconCheck size={18} />
                    <span className="dialog-title">{t("Spelling")}</span>
                </div>
                <div className="dialog-body">
                    {!spelling ? (
                        t("Loading…")
                    ) : (
                        <>
                            <label className="form-field">
                                <span className="form-field-label">{t("Check spelling in")}</span>
                                <select
                                    value={spelling.language}
                                    onChange={(e) => apply(api.setSpellLanguage(e.target.value))}
                                >
                                    {SPELL_LANGUAGES.map((l) => (
                                        <option key={l.id} value={l.id}>
                                            {t(l.label)}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <p className="prefs-note">
                                {t("With both languages, a word counts as correct when either dictionary knows it. Right-click an underlined word for suggestions.")}
                            </p>

                            <div className="form-field">
                                <span className="form-field-label">
                                    {t("Personal dictionary ({n})", { n: spelling.dictionary.length.toLocaleString(getLanguage()) })}
                                </span>
                                <form
                                    className="dict-add"
                                    onSubmit={(e) => {
                                        e.preventDefault();
                                        if (!word.trim()) return;
                                        apply(api.addToDictionary(word.trim()));
                                        setWord("");
                                    }}
                                >
                                    <input
                                        type="text"
                                        autoFocus
                                        value={word}
                                        spellCheck={false}
                                        placeholder={t("Add a word (names, places, invented terms…)")}
                                        onChange={(e) => setWord(e.target.value)}
                                    />
                                    <button type="submit" disabled={!word.trim()}>
                                        {t("Add")}
                                    </button>
                                </form>
                                {spelling.dictionary.length > 8 && (
                                    <input
                                        type="search"
                                        value={filter}
                                        placeholder={t("Filter…")}
                                        onChange={(e) => setFilter(e.target.value)}
                                    />
                                )}
                                <ul className="dict-list">
                                    {words.length === 0 && (
                                        <li className="dict-empty">
                                            {spelling.dictionary.length === 0 ? t("No words yet.") : t("No words match.")}
                                        </li>
                                    )}
                                    {words.map((w) => (
                                        <li key={w}>
                                            <span>{w}</span>
                                            <button
                                                type="button"
                                                className="link-btn"
                                                onClick={() => apply(api.removeFromDictionary(w))}
                                            >
                                                {t("Remove")}
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </>
                    )}
                </div>
                <div className="dialog-footer">
                    <button type="button" className="primary" onClick={onClose}>
                        {t("Done")}
                    </button>
                </div>
            </div>
        </div>
    );
}
