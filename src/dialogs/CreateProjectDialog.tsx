/// "Create New Project" dialog.
///
/// Shown after the user selects a template and clicks Open. Collects the
/// project name, target directory, optional author, then calls the backend
/// `create_project` command which materialises the `.scri` file.

import { useEffect, useState } from "react";
import { api, type CreateProjectArgs, type TemplatePreview } from "../services/api";
import { IconFolderOpen, IconPlus } from "../components/Icons";
import "../styles/templates.css";

interface Props {
    template: TemplatePreview;
    defaultDir: string;
    onCreated: () => void;
    onCancel: () => void;
}

const ILLEGAL = /[\\/:*?"<>|]/;

export function CreateProjectDialog({ template, defaultDir, onCreated, onCancel }: Props) {
    const [name, setName] = useState("Untitled Project");
    const [directory, setDirectory] = useState(defaultDir);
    const [author, setAuthor] = useState("");
    const [includeAuthor, setIncludeAuthor] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);
    const [targetExists, setTargetExists] = useState(false);

    // Check for an existing file at the target path whenever name/dir changes.
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
        if (trimmed.length === 0) return "Name cannot be empty.";
        if (trimmed.length > 120) return "Name is too long (max 120 characters).";
        if (ILLEGAL.test(trimmed)) return "Name contains illegal characters (\\ / : * ? \" < > |).";
        return null;
    })();

    const dirError = directory.trim().length === 0 ? "Please choose a directory." : null;

    const canSubmit = !nameError && !dirError && !busy && !targetExists;

    const pickDir = async () => {
        const selected = await api.pickDirectory("Choose Project Location");
        if (typeof selected === "string") {
            setDirectory(selected);
        }
    };

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        const args: CreateProjectArgs = {
            name: name.trim(),
            template_id: template.id,
            directory: directory.trim(),
            author: includeAuthor && author.trim() ? author.trim() : null,
        };
        try {
            await api.createProject(args);
            onCreated();
        } catch (e) {
            setError(String(e));
            setBusy(false);
        }
    };

    return (
        <div className="overlay-root" onClick={onCancel}>
            <div className="dialog" style={{ minWidth: 480 }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconPlus size={18} />
                    <span className="dialog-title">Create New Project</span>
                </div>
                <div className="dialog-body">
                    <div className="form-field">
                        <label>Template</label>
                        <div style={{ fontSize: "var(--font-size-base)", color: "var(--text-primary)" }}>
                            {template.name}
                        </div>
                        <span className="hint">{template.description}</span>
                    </div>

                    <div className="form-field">
                        <label htmlFor="proj-name">Project Name</label>
                        <input
                            id="proj-name"
                            type="text"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            autoFocus
                            placeholder="My Novel"
                        />
                        {nameError && <span className="error">{nameError}</span>}
                    </div>

                    <div className="form-field">
                        <label htmlFor="proj-dir">Location</label>
                        <div className="dir-picker">
                            <input
                                id="proj-dir"
                                type="text"
                                value={directory}
                                onChange={(e) => setDirectory(e.target.value)}
                                placeholder="C:\Users\you\Documents\ScribeForge"
                            />
                            <button onClick={pickDir} type="button">
                                <IconFolderOpen size={15} /> Browse
                            </button>
                        </div>
                        {dirError && <span className="error">{dirError}</span>}
                        <span className="hint">
                            The project will be saved as “{name.trim() || "Untitled Project"}.scri” in this folder.
                        </span>
                        {targetExists && (
                            <span className="error">
                                A project file with this name already exists in the chosen folder. Choose a different name or location.
                            </span>
                        )}
                    </div>

                    <div className="form-field">
                        <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            <input
                                type="checkbox"
                                checked={includeAuthor}
                                onChange={(e) => setIncludeAuthor(e.target.checked)}
                            />
                            Author
                        </label>
                        {includeAuthor && (
                            <input
                                type="text"
                                value={author}
                                onChange={(e) => setAuthor(e.target.value)}
                                placeholder="Your name (optional)"
                            />
                        )}
                    </div>

                    {error && (
                        <div className="form-field">
                            <span className="error">{error}</span>
                        </div>
                    )}
                </div>
                <div className="dialog-footer">
                    {busy && <div className="spinner" />}
                    <button onClick={onCancel} disabled={busy}>Cancel</button>
                    <button className="primary" onClick={submit} disabled={!canSubmit}>
                        Create Project
                    </button>
                </div>
            </div>
        </div>
    );
}
