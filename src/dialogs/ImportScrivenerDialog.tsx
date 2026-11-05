/// "Import from Scrivener" dialog.
///
/// Step 1: choose the Scrivener project (the `.scriv` folder), the name and
/// the folder of the new ScribeForge project. Step 2, after the import: what
/// was brought over, and a button to start writing (the new project is
/// already open). The Scrivener project itself is only read.

import { useEffect, useState } from "react";
import { api, type ImportSummary, type ScrivenerSource } from "../services/api";
import { IconCheck, IconFolderOpen, IconOpen } from "../components/Icons";
import "../styles/templates.css";
import { t, tn } from "../i18n";

interface Props {
    defaultDir: string;
    /** The imported project is open; leave for the workspace. */
    onDone: () => void;
    onCancel: () => void;
}

const ILLEGAL = /[\\/:*?"<>|]/;

export function ImportScrivenerDialog({ defaultDir, onDone, onCancel }: Props) {
    const [source, setSource] = useState<ScrivenerSource | null>(null);
    const [name, setName] = useState("");
    const [directory, setDirectory] = useState(defaultDir);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [targetExists, setTargetExists] = useState(false);
    const [summary, setSummary] = useState<ImportSummary | null>(null);

    useEffect(() => {
        if (!directory && defaultDir) setDirectory(defaultDir);
    }, [defaultDir, directory]);

    useEffect(() => {
        const trimmed = name.trim();
        if (!trimmed || !directory.trim()) {
            setTargetExists(false);
            return;
        }
        let cancelled = false;
        api.projectPathExists(directory.trim(), trimmed)
            .then((exists) => !cancelled && setTargetExists(exists))
            .catch(() => !cancelled && setTargetExists(false));
        return () => {
            cancelled = true;
        };
    }, [name, directory]);

    const nameError = (() => {
        const trimmed = name.trim();
        if (!source) return null;
        if (trimmed.length === 0) return t("Name cannot be empty.");
        if (trimmed.length > 120) return t("Name is too long (max 120 characters).");
        if (ILLEGAL.test(trimmed)) return t("Name contains illegal characters (\\ / : * ? \" < > |).");
        return null;
    })();
    const canImport = !!source && !nameError && !!directory.trim() && !targetExists && !busy;

    const pickSource = async () => {
        setError(null);
        try {
            const picked = await api.pickScrivenerProject();
            if (picked) {
                setSource(picked);
                setName(picked.name);
            }
        } catch (e) {
            setError(String(e));
        }
    };

    const pickDir = async () => {
        const selected = await api.pickDirectory(t("Choose Project Location"));
        if (selected) setDirectory(selected);
    };

    const submit = async () => {
        if (!canImport || !source) return;
        setBusy(true);
        setError(null);
        try {
            const result = await api.importScrivener({
                source: source.path,
                name: name.trim(),
                directory: directory.trim(),
            });
            setSummary(result.summary);
        } catch (e) {
            setError(String(e));
        } finally {
            setBusy(false);
        }
    };

    if (summary) {
        return (
            <div className="overlay-root">
                <div className="dialog" style={{ width: 500, maxWidth: "92vw" }}>
                    <div className="dialog-header">
                        <IconCheck size={18} />
                        <span className="dialog-title">{t("Project imported")}</span>
                    </div>
                    <div className="dialog-body">
                        <p className="import-result">
                            {tn(summary.documents, "{n} document imported", "{n} documents imported")}
                            {summary.images > 0 && <> · {tn(summary.images, "{n} image", "{n} images")}</>}
                        </p>
                        <p className="hint">
                            {t("Texts, synopses, notes, labels, statuses, targets and dates came over. Fonts and indents now follow your writing format profile.")}
                        </p>
                        {summary.not_copied.length > 0 && (
                            <div className="form-field">
                                <label>{t("Not copied (PDFs and other files)")}</label>
                                <span className="hint">
                                    {t("Each one has a note saying where the original file is in the Scrivener project.")}
                                </span>
                                <ul className="import-skipped">
                                    {summary.not_copied.map((title, i) => (
                                        <li key={i}>{title}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                        <p className="hint">
                            {t("Not imported: snapshots, comments, keywords and compile settings. Your Scrivener project was not changed.")}
                        </p>
                    </div>
                    <div className="dialog-footer">
                        <button className="primary" onClick={onDone} autoFocus>
                            {t("Start writing")}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="overlay-root" onClick={busy ? undefined : onCancel}>
            <div className="dialog" style={{ width: 520, maxWidth: "92vw" }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconOpen size={18} />
                    <span className="dialog-title">{t("Import from Scrivener")}</span>
                </div>
                <div className="dialog-body">
                    <div className="form-field">
                        <label>{t("Scrivener project")}</label>
                        <div className="dir-picker">
                            <input
                                type="text"
                                readOnly
                                value={source?.path ?? ""}
                                placeholder={t("Choose the .scriv folder")}
                                onClick={pickSource}
                            />
                            <button type="button" onClick={pickSource} disabled={busy} autoFocus={!source}>
                                <IconFolderOpen size={15} /> {t("Choose…")}
                            </button>
                        </div>
                        <span className="hint">
                            {t("Scrivener 3, Scrivener 2 and Scrivener 1 for Windows. Your Scrivener project is only read, never changed.")}
                        </span>
                    </div>

                    {source && (
                        <>
                            <div className="form-field">
                                <label htmlFor="import-name">{t("Project Name")}</label>
                                <input
                                    id="import-name"
                                    type="text"
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    disabled={busy}
                                />
                                {nameError && <span className="error">{nameError}</span>}
                            </div>
                            <div className="form-field">
                                <label htmlFor="import-dir">{t("Location")}</label>
                                <div className="dir-picker">
                                    <input
                                        id="import-dir"
                                        type="text"
                                        value={directory}
                                        onChange={(e) => setDirectory(e.target.value)}
                                        disabled={busy}
                                    />
                                    <button type="button" onClick={pickDir} disabled={busy}>
                                        <IconFolderOpen size={15} /> {t("Browse")}
                                    </button>
                                </div>
                                <span className="hint">
                                    {t("The project will be saved as “{file}” in this folder.", {
                                        file: `${name.trim() || t("Untitled Project")}.scri`,
                                    })}
                                </span>
                                {targetExists && (
                                    <span className="error">
                                        {t("A project file with this name already exists in the chosen folder. Choose a different name or location.")}
                                    </span>
                                )}
                            </div>
                        </>
                    )}

                    {error && (
                        <div className="form-field">
                            <span className="error">{error}</span>
                        </div>
                    )}
                </div>
                <div className="dialog-footer">
                    {busy && (
                        <>
                            <div className="spinner" />
                            <span className="hint">{t("Importing…")}</span>
                        </>
                    )}
                    <button onClick={onCancel} disabled={busy}>
                        {t("Cancel")}
                    </button>
                    <button className="primary" onClick={submit} disabled={!canImport}>
                        {t("Import")}
                    </button>
                </div>
            </div>
        </div>
    );
}
