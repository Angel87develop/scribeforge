/// Inspector: metadata panel for the selected document.
///
/// Tabs: Synopsis / Notes / Metadata (label, status, keywords, dates, ids).
/// All fields are editable and persisted via `update_document`.

import { useEffect, useState } from "react";
import { api, type DocumentDto, type DocumentMetaDto } from "../services/api";
import { ImageAttachments } from "./ImageAttachments";
import "../styles/inspector.css";

interface Props {
    documentId: string | null;
    meta: DocumentMetaDto | null;
    onError: (msg: string) => void;
    onMetaChanged: () => void;
}

type Tab = "synopsis" | "notes" | "metadata";

const STATUS_OPTIONS = [
    "To Do",
    "First Draft",
    "Revised",
    "Final Draft",
    "Done",
];

export function Inspector({ documentId, meta, onError, onMetaChanged }: Props) {
    const [tab, setTab] = useState<Tab>("synopsis");
    const [doc, setDoc] = useState<DocumentDto | null>(null);
    const [synopsis, setSynopsis] = useState("");
    const [notes, setNotes] = useState("");
    const [status, setStatus] = useState("First Draft");
    const [label, setLabel] = useState("");
    const [keywords, setKeywords] = useState("");
    const [saveTimer, setSaveTimer] = useState<number | null>(null);

    // Load the document when the selection changes.
    useEffect(() => {
        if (!documentId) {
            setDoc(null);
            return;
        }
        api.getDocument(documentId)
            .then((d) => {
                setDoc(d);
                setSynopsis(d.synopsis);
                setNotes(d.notes);
                setStatus(d.status);
                setLabel(d.labels[0] ?? "");
                setKeywords(d.labels.slice(1).join(", "));
            })
            .catch((e) => onError(String(e)));
    }, [documentId]);

    // Debounced persist for the active field set.
    function persist(patch: Partial<{ synopsis: string; notes: string; status: string; labels: string[] }>) {
        if (!doc) return;
        if (saveTimer !== null) window.clearTimeout(saveTimer);
        const t = window.setTimeout(() => {
            api.updateDocument({ id: doc.id, ...patch })
                .then(() => onMetaChanged())
                .catch((e) => onError(String(e)));
        }, 600);
        setSaveTimer(t);
    }

    if (!doc || !meta) {
        return (
            <div className="inspector-root">
                <div className="inspector-header">Inspector</div>
                <div className="inspector-empty">Select a document to inspect.</div>
            </div>
        );
    }

    const isFolder = ["folder", "draft_root", "research_root", "trash_root"].includes(doc.kind);

    return (
        <div className="inspector-root">
            <div className="inspector-header">
                <span className="inspector-title">Inspector</span>
                <span className="inspector-doc-name">{meta.title}</span>
            </div>
            <div className="inspector-tabs">
                <button
                    className={`inspector-tab${tab === "synopsis" ? " active" : ""}`}
                    onClick={() => setTab("synopsis")}
                >
                    Synopsis
                </button>
                <button
                    className={`inspector-tab${tab === "notes" ? " active" : ""}`}
                    onClick={() => setTab("notes")}
                >
                    Notes
                </button>
                <button
                    className={`inspector-tab${tab === "metadata" ? " active" : ""}`}
                    onClick={() => setTab("metadata")}
                >
                    Metadata
                </button>
            </div>

            <div className="inspector-body">
                {tab === "synopsis" && (
                    <textarea
                        className="inspector-textarea"
                        value={synopsis}
                        placeholder="A brief summary of this document…"
                        onChange={(e) => {
                            setSynopsis(e.target.value);
                            persist({ synopsis: e.target.value });
                        }}
                    />
                )}
                {tab === "notes" && (
                    <>
                        <textarea
                            className="inspector-textarea"
                            value={notes}
                            placeholder="Project notes, comments, annotations…"
                            onChange={(e) => {
                                setNotes(e.target.value);
                                persist({ notes: e.target.value });
                            }}
                        />
                        <ImageAttachments documentId={doc.id} onError={onError} />
                    </>
                )}
                {tab === "metadata" && (
                    <div className="inspector-meta">
                        <div className="inspector-field">
                            <label>Status</label>
                            <select
                                value={status}
                                onChange={(e) => {
                                    setStatus(e.target.value);
                                    persist({ status: e.target.value });
                                }}
                            >
                                {status && !STATUS_OPTIONS.includes(status) && (
                                    <option value={status}>{status}</option>
                                )}
                                {STATUS_OPTIONS.map((s) => (
                                    <option key={s} value={s}>{s}</option>
                                ))}
                            </select>
                        </div>
                        <div className="inspector-field">
                            <label>Label</label>
                            <input
                                type="text"
                                value={label}
                                placeholder="e.g. Concept, Draft, Final"
                                onChange={(e) => {
                                    setLabel(e.target.value);
                                    persist({ labels: buildLabels(e.target.value, keywords) });
                                }}
                            />
                        </div>
                        <div className="inspector-field">
                            <label>Keywords</label>
                            <input
                                type="text"
                                value={keywords}
                                placeholder="comma, separated, keywords"
                                onChange={(e) => {
                                    setKeywords(e.target.value);
                                    persist({ labels: buildLabels(label, e.target.value) });
                                }}
                            />
                        </div>
                        <div className="inspector-stats">
                            <div className="inspector-stat-row">
                                <span>Words</span>
                                <span>{meta.word_count.toLocaleString()}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>Characters</span>
                                <span>{(doc.content.blocks
                                    .map((b) => (b.spans ?? []).map((s) => s.text).join(""))
                                    .join("").length).toLocaleString()}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>Created</span>
                                <span>{new Date(meta.created_at).toLocaleString()}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>Modified</span>
                                <span>{new Date(meta.modified_at).toLocaleString()}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>ID</span>
                                <span className="inspector-id" title={doc.id}>{doc.id.slice(0, 13)}…</span>
                            </div>
                        </div>
                        {isFolder && (
                            <div className="inspector-note">
                                This is a folder. Status and label apply to the folder itself.
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function buildLabels(label: string, keywords: string): string[] {
    const out: string[] = [];
    const l = label.trim();
    if (l) out.push(l);
    for (const k of keywords.split(",")) {
        const t = k.trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out;
}
