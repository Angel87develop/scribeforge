/// Find and Replace across the project (or the current document), with
/// regular expressions and a preview of every change.
///
/// The search runs in the Rust core as you type. Each match is listed with
/// its context, the text it would become, and a tick box; only ticked
/// matches are replaced. In regular-expression mode the replacement can use
/// `$1`, `$2`… or `${name}` for captured groups. The Trash is never searched.
/// The core snapshots each document before changing its text.

import { useEffect, useMemo, useRef, useState } from "react";
import { api, type FindMatch, type FindOptions, type FindResult } from "../services/api";
import { IconReplace } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/writing.css";
import { getLanguage, t, tn } from "../i18n";

interface Props {
    /** The document open in the active pane, for "Current document". */
    currentDocumentId: string | null;
    currentDocumentTitle: string | null;
    /** Saves pending editor changes before searching or replacing. */
    flushEditors: () => Promise<void>;
    onOpenDocument: (id: string) => void;
    /** Called after a replacement, with the documents that changed. */
    onReplaced: (count: number, documents: string[]) => void;
    onClose: () => void;
    onError: (msg: string) => void;
}

const FIELD_LABELS: Record<FindMatch["field"], string> = {
    text: "Text",
    title: "Title",
    synopsis: "Synopsis",
    notes: "Notes",
};

export function FindReplaceDialog({
    currentDocumentId,
    currentDocumentTitle,
    flushEditors,
    onOpenDocument,
    onReplaced,
    onClose,
    onError,
}: Props) {
    const [query, setQuery] = useState("");
    const [replacement, setReplacement] = useState("");
    const [regex, setRegex] = useState(false);
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [inTitles, setInTitles] = useState(false);
    const [inSynopsis, setInSynopsis] = useState(false);
    const [inNotes, setInNotes] = useState(false);
    const [scope, setScope] = useState<"project" | "document">("project");
    const [result, setResult] = useState<FindResult | null>(null);
    const [searchError, setSearchError] = useState<string | null>(null);
    const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
    const [busy, setBusy] = useState(false);
    const flushed = useRef(false);

    const options: FindOptions = useMemo(
        () => ({
            query,
            regex,
            case_sensitive: caseSensitive,
            whole_word: wholeWord,
            in_text: true,
            in_titles: inTitles,
            in_synopsis: inSynopsis,
            in_notes: inNotes,
            documents: scope === "document" && currentDocumentId ? [currentDocumentId] : [],
        }),
        [query, regex, caseSensitive, wholeWord, inTitles, inSynopsis, inNotes, scope, currentDocumentId],
    );

    // Search (debounced) whenever the query, options or replacement change.
    useEffect(() => {
        if (!query) {
            setResult(null);
            setSearchError(null);
            return;
        }
        let cancelled = false;
        const t = window.setTimeout(async () => {
            try {
                if (!flushed.current) {
                    await flushEditors();
                    flushed.current = true;
                }
                const r = await api.findInProject(options, replacement);
                if (cancelled) return;
                setResult(r);
                setSearchError(null);
                setUnchecked(new Set());
            } catch (e) {
                if (!cancelled) {
                    setResult(null);
                    setSearchError(String(e));
                }
            }
        }, 250);
        return () => {
            cancelled = true;
            window.clearTimeout(t);
        };
    }, [options, replacement, query, flushEditors]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const groups = useMemo(() => {
        const out: { id: string; title: string; matches: FindMatch[] }[] = [];
        for (const m of result?.matches ?? []) {
            let g = out[out.length - 1];
            if (!g || g.id !== m.document_id) {
                g = { id: m.document_id, title: m.document_title, matches: [] };
                out.push(g);
            }
            g.matches.push(m);
        }
        return out;
    }, [result]);

    const total = result?.matches.length ?? 0;
    const selected = total - [...unchecked].filter((id) => result?.matches.some((m) => m.id === id)).length;

    function toggle(ids: string[], on: boolean) {
        setUnchecked((prev) => {
            const next = new Set(prev);
            for (const id of ids) {
                if (on) next.delete(id);
                else next.add(id);
            }
            return next;
        });
    }

    async function replaceSelected() {
        if (!result || selected === 0) return;
        const ids = result.matches.filter((m) => !unchecked.has(m.id)).map((m) => m.id);
        if (
            ids.length > 20 &&
            !confirm(
                t("Replace {n} matches in {docs} documents?", {
                    n: ids.length,
                    docs: new Set(ids.map((i) => i.split(":")[0])).size,
                }),
            )
        )
            return;
        setBusy(true);
        try {
            await flushEditors();
            const r = await api.replaceInProject(options, replacement, ids);
            onReplaced(r.replaced, r.documents);
            const again = await api.findInProject(options, replacement);
            setResult(again);
            setUnchecked(new Set());
        } catch (e) {
            onError(String(e));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog find-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconReplace size={18} />
                    <span className="dialog-title">{t("Find and Replace")}</span>
                </div>
                <div className="dialog-body find-body">
                    <div className="find-fields">
                        <label className="form-field">
                            <span className="form-field-label">{t("Find")}</span>
                            <input
                                type="text"
                                autoFocus
                                value={query}
                                spellCheck={false}
                                placeholder={regex ? t("Regular expression, e.g. \\bsir\\b") : t("Text to find")}
                                onChange={(e) => setQuery(e.target.value)}
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-field-label">{t("Replace with")}</span>
                            <input
                                type="text"
                                value={replacement}
                                spellCheck={false}
                                placeholder={regex ? t("Replacement; $1 inserts the first group") : t("Replacement (may be empty)")}
                                onChange={(e) => setReplacement(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") replaceSelected();
                                }}
                            />
                        </label>
                    </div>
                    <div className="find-options">
                        <label className="prefs-check">
                            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} />
                            {t("Match case")}
                        </label>
                        <label className="prefs-check">
                            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} />
                            {t("Whole words")}
                        </label>
                        <label className="prefs-check">
                            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} />
                            {t("Regular expression")}
                        </label>
                        <span className="find-sep" />
                        <span className="find-also">{t("Also in:")}</span>
                        <label className="prefs-check">
                            <input type="checkbox" checked={inTitles} onChange={(e) => setInTitles(e.target.checked)} />
                            {t("Titles")}
                        </label>
                        <label className="prefs-check">
                            <input type="checkbox" checked={inSynopsis} onChange={(e) => setInSynopsis(e.target.checked)} />
                            {t("Synopses")}
                        </label>
                        <label className="prefs-check">
                            <input type="checkbox" checked={inNotes} onChange={(e) => setInNotes(e.target.checked)} />
                            {t("Notes")}
                        </label>
                        <span className="find-sep" />
                        <select
                            className="find-scope"
                            value={scope}
                            onChange={(e) => setScope(e.target.value as "project" | "document")}
                        >
                            <option value="project">{t("Whole project")}</option>
                            <option value="document" disabled={!currentDocumentId}>
                                {currentDocumentTitle
                                    ? t("Only “{title}”", { title: currentDocumentTitle })
                                    : t("Current document")}
                            </option>
                        </select>
                    </div>

                    <div className="find-summary">
                        {searchError ? (
                            <span className="find-error">{searchError}</span>
                        ) : !query ? (
                            t("Type something to find. The Trash is not searched.")
                        ) : !result ? (
                            t("Searching…")
                        ) : total === 0 ? (
                            t("No matches.")
                        ) : (
                            <>
                                {tn(total, "{n} match", "{n} matches")}{" "}
                                {tn(result.documents, "in {n} document", "in {n} documents")}
                                {result.truncated && ` ${t("(only the first ones are shown)")}`} ·{" "}
                                {t("{n} selected", { n: selected.toLocaleString(getLanguage()) })}
                                <button type="button" className="link-btn" onClick={() => setUnchecked(new Set())}>
                                    {t("Select all")}
                                </button>
                                <button
                                    type="button"
                                    className="link-btn"
                                    onClick={() => setUnchecked(new Set(result.matches.map((m) => m.id)))}
                                >
                                    {t("Select none")}
                                </button>
                            </>
                        )}
                    </div>

                    <div className="find-results">
                        {groups.map((g) => {
                            const ids = g.matches.map((m) => m.id);
                            const allOn = ids.every((id) => !unchecked.has(id));
                            return (
                                <div key={g.id} className="find-group">
                                    <div className="find-group-head">
                                        <input
                                            type="checkbox"
                                            checked={allOn}
                                            onChange={(e) => toggle(ids, e.target.checked)}
                                            aria-label={t("Replace in {title}", { title: g.title })}
                                        />
                                        <button type="button" className="find-group-title" onClick={() => onOpenDocument(g.id)}>
                                            {g.title}
                                        </button>
                                        <span className="find-group-count">{g.matches.length}</span>
                                    </div>
                                    {g.matches.map((m) => (
                                        <label key={m.id} className={`find-match${unchecked.has(m.id) ? " off" : ""}`}>
                                            <input
                                                type="checkbox"
                                                checked={!unchecked.has(m.id)}
                                                onChange={(e) => toggle([m.id], e.target.checked)}
                                            />
                                            {m.field !== "text" && <span className="find-field">{t(FIELD_LABELS[m.field])}</span>}
                                            <span className="find-context">
                                                {m.before}
                                                <del>{m.matched}</del>
                                                {m.replacement !== null && <ins>{m.replacement}</ins>}
                                                {m.after}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            );
                        })}
                    </div>
                </div>
                <div className="dialog-footer">
                    <span className="find-footnote">{t("Each changed document gets a snapshot first, so you can undo from the Inspector.")}</span>
                    <button type="button" onClick={onClose}>
                        {t("Close")}
                    </button>
                    <button type="button" className="primary" disabled={busy || selected === 0} onClick={replaceSelected}>
                        {selected > 0 ? t("Replace {n}", { n: selected.toLocaleString(getLanguage()) }) : t("Replace")}
                    </button>
                </div>
            </div>
        </div>
    );
}
