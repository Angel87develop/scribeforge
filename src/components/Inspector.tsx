/// Inspector: metadata panel for the selected document.
///
/// Tabs: Synopsis / Notes / Snapshots / Metadata (label, status, keywords,
/// word target, dates, ids). All fields are editable and persisted via
/// `update_document`.

import { useEffect, useState } from "react";
import { api, type DocumentDto, type DocumentMetaDto } from "../services/api";
import { IconChevronDown } from "./Icons";
import { ImageAttachments } from "./ImageAttachments";
import { LinksPanel } from "./LinksPanel";
import { LabelSelect, StatusSelect } from "./OrgBadges";
import { ProgressBar } from "./ProgressBar";
import { SnapshotsPanel } from "./SnapshotsPanel";
import "../styles/inspector.css";
import "../styles/writing.css";
import { displayTitle } from "./binderTree";
import { getLanguage, t } from "../i18n";

interface Props {
    documentId: string | null;
    meta: DocumentMetaDto | null;
    onError: (msg: string) => void;
    onMetaChanged: () => void;
    /** Changes when document text or snapshots changed elsewhere. */
    reloadToken?: number;
    /** Saves pending editor changes (before a snapshot is taken). */
    flushEditors: () => Promise<void>;
    /** A snapshot was restored into the document. */
    onDocumentRestored: () => void;
    /** Opens a document (from the Links tab). */
    onOpenDocument: (id: string) => void;
    /** Binder items, to tell whether link targets exist. */
    binder: DocumentMetaDto[];
}

type Tab = "synopsis" | "notes" | "snapshots" | "links" | "metadata";

/** Whether the notes text is folded away in the Notes tab (images get the room). */
const NOTES_COLLAPSED_KEY = "sf.inspector.notesCollapsed";

export function Inspector({
    documentId,
    meta,
    onError,
    onMetaChanged,
    reloadToken = 0,
    flushEditors,
    onDocumentRestored,
    onOpenDocument,
    binder,
}: Props) {
    const [tab, setTab] = useState<Tab>("synopsis");
    const [doc, setDoc] = useState<DocumentDto | null>(null);
    const [synopsis, setSynopsis] = useState("");
    const [notes, setNotes] = useState("");
    const [status, setStatus] = useState("First Draft");
    const [label, setLabel] = useState("");
    const [keywords, setKeywords] = useState("");
    const [goal, setGoal] = useState("");
    const [saveTimer, setSaveTimer] = useState<number | null>(null);
    const [notesCollapsed, setNotesCollapsed] = useState(() => localStorage.getItem(NOTES_COLLAPSED_KEY) === "1");

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
                setGoal(d.word_goal ? String(d.word_goal) : "");
            })
            .catch((e) => onError(String(e)));
    }, [documentId, reloadToken]);

    // Debounced persist for the active field set.
    function persist(
        patch: Partial<{ synopsis: string; notes: string; status: string; labels: string[]; word_goal: number }>,
    ) {
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
                <div className="inspector-header">{t("Inspector")}</div>
                <div className="inspector-empty">{t("Select a document to inspect.")}</div>
            </div>
        );
    }

    const isFolder = ["folder", "draft_root", "research_root", "trash_root"].includes(doc.kind);

    return (
        <div className="inspector-root">
            <div className="inspector-header">
                <span className="inspector-title">{t("Inspector")}</span>
                <span className="inspector-doc-name">{displayTitle(meta)}</span>
            </div>
            <div className="inspector-tabs">
                <button
                    className={`inspector-tab${tab === "synopsis" ? " active" : ""}`}
                    onClick={() => setTab("synopsis")}
                >
                    {t("Synopsis")}
                </button>
                <button
                    className={`inspector-tab${tab === "notes" ? " active" : ""}`}
                    onClick={() => setTab("notes")}
                >
                    {t("Notes")}
                </button>
                {!isFolder && (
                    <button
                        className={`inspector-tab${tab === "snapshots" ? " active" : ""}`}
                        onClick={() => setTab("snapshots")}
                    >
                        {t("Snapshots")}
                    </button>
                )}
                {!isFolder && (
                    <button
                        className={`inspector-tab${tab === "links" ? " active" : ""}`}
                        onClick={() => setTab("links")}
                    >
                        {t("Links")}
                    </button>
                )}
                <button
                    className={`inspector-tab${tab === "metadata" ? " active" : ""}`}
                    onClick={() => setTab("metadata")}
                >
                    {t("Metadata")}
                </button>
            </div>

            <div className="inspector-body">
                {tab === "synopsis" && (
                    <textarea
                        className="inspector-textarea"
                        value={synopsis}
                        placeholder={t("A brief summary of this document…")}
                        onChange={(e) => {
                            setSynopsis(e.target.value);
                            persist({ synopsis: e.target.value });
                        }}
                    />
                )}
                {tab === "notes" && (
                    <>
                        <button
                            type="button"
                            className="inspector-section-toggle"
                            aria-expanded={!notesCollapsed}
                            title={notesCollapsed ? t("Show notes") : t("Hide notes to give the images more room")}
                            onClick={() => {
                                const next = !notesCollapsed;
                                setNotesCollapsed(next);
                                localStorage.setItem(NOTES_COLLAPSED_KEY, next ? "1" : "0");
                            }}
                        >
                            <span className="inspector-section-label">{t("Notes")}</span>
                            {notesCollapsed && notes.trim() && (
                                <span className="inspector-section-preview">{notes.trim().split("\n")[0]}</span>
                            )}
                            <IconChevronDown
                                size={14}
                                className="inspector-section-chevron"
                                style={notesCollapsed ? undefined : { transform: "rotate(180deg)" }}
                            />
                        </button>
                        {!notesCollapsed && (
                            <textarea
                                className="inspector-textarea"
                                value={notes}
                                placeholder={t("Project notes, comments, annotations…")}
                                onChange={(e) => {
                                    setNotes(e.target.value);
                                    persist({ notes: e.target.value });
                                }}
                            />
                        )}
                        <ImageAttachments documentId={doc.id} onError={onError} expanded={notesCollapsed} />
                    </>
                )}
                {tab === "links" && !isFolder && (
                    <LinksPanel
                        documentId={doc.id}
                        title={meta.title}
                        binder={binder}
                        reloadToken={reloadToken}
                        flushEditors={flushEditors}
                        onOpenDocument={onOpenDocument}
                        onError={onError}
                    />
                )}
                {tab === "snapshots" && !isFolder && (
                    <SnapshotsPanel
                        documentId={doc.id}
                        documentTitle={meta.title}
                        reloadToken={reloadToken}
                        flushEditors={flushEditors}
                        onRestored={onDocumentRestored}
                        onError={onError}
                    />
                )}
                {tab === "metadata" && (
                    <div className="inspector-meta">
                        <div className="inspector-field">
                            <label>{t("Status")}</label>
                            <StatusSelect
                                value={status}
                                onChange={(v) => {
                                    setStatus(v);
                                    persist({ status: v });
                                }}
                            />
                        </div>
                        <div className="inspector-field">
                            <label>{t("Label")}</label>
                            <LabelSelect
                                value={label}
                                onChange={(v) => {
                                    setLabel(v);
                                    persist({ labels: buildLabels(v, keywords) });
                                }}
                            />
                        </div>
                        <div className="inspector-field">
                            <label>{t("Keywords")}</label>
                            <input
                                type="text"
                                value={keywords}
                                placeholder={t("comma, separated, keywords")}
                                onChange={(e) => {
                                    setKeywords(e.target.value);
                                    persist({ labels: buildLabels(label, e.target.value) });
                                }}
                            />
                        </div>
                        {!isFolder && (
                            <div className="inspector-field">
                                <label>{t("Word target")}</label>
                                <input
                                    type="number"
                                    min={0}
                                    step={100}
                                    value={goal}
                                    placeholder={t("No target")}
                                    onChange={(e) => {
                                        setGoal(e.target.value);
                                        const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                                        persist({ word_goal: n });
                                    }}
                                />
                                {Number(goal) > 0 && (
                                    <div className="inspector-goal">
                                        <ProgressBar value={meta.word_count} goal={Number(goal)} />
                                        <span>
                                            {t("{n} of {goal} ({pct}%)", {
                                                n: meta.word_count.toLocaleString(getLanguage()),
                                                goal: Number(goal).toLocaleString(getLanguage()),
                                                pct: Math.min(100, Math.round((meta.word_count / Number(goal)) * 100)),
                                            })}
                                        </span>
                                    </div>
                                )}
                            </div>
                        )}
                        <div className="inspector-stats">
                            <div className="inspector-stat-row">
                                <span>{t("Words")}</span>
                                <span>{meta.word_count.toLocaleString(getLanguage())}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>{t("Characters")}</span>
                                <span>{(doc.content.blocks
                                    .map((b) => (b.spans ?? []).map((s) => s.text).join(""))
                                    .join("").length).toLocaleString(getLanguage())}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>{t("Created")}</span>
                                <span>{new Date(meta.created_at).toLocaleString(getLanguage())}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>{t("Modified")}</span>
                                <span>{new Date(meta.modified_at).toLocaleString(getLanguage())}</span>
                            </div>
                            <div className="inspector-stat-row">
                                <span>{t("ID")}</span>
                                <span className="inspector-id" title={doc.id}>{doc.id.slice(0, 13)}…</span>
                            </div>
                        </div>
                        {isFolder && (
                            <div className="inspector-note">
                                {t("This is a folder. Status and label apply to the folder itself.")}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

function buildLabels(label: string, keywords: string): string[] {
    // labels[0] is the label (possibly empty), the rest are keywords.
    const out: string[] = [label.trim()];
    for (const k of keywords.split(",")) {
        const t = k.trim();
        if (t && !out.includes(t)) out.push(t);
    }
    return out.length === 1 && !out[0] ? [] : out;
}
