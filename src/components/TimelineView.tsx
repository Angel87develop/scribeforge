/// Story timeline: the events of the story in chronological order, one
/// column (lane) per track — a storyline or point of view — and one row per
/// story date. Dates are free text, so invented calendars work; the core
/// sorts them by the numbers they contain ("Day 2" before "Day 10").
///
/// Click an event to edit it in the side panel: title, date and time, track,
/// colour, description, the scene where it happens and the characters
/// involved. Filters show one track or the events of one character.

import { useEffect, useMemo, useState } from "react";
import { api, type DocumentMetaDto, type TimelineEvent } from "../services/api";
import { descendants, isFolderKind } from "./binderTree";
import { DocIcon } from "./DocIcons";
import { IconClose, IconOpen, IconPlus } from "./Icons";
import "../styles/organization.css";
import { t } from "../i18n";

interface Props {
    binder: DocumentMetaDto[];
    /** Pre-fills the scene of a new event. */
    currentDocumentId: string | null;
    onOpenDocument: (id: string) => void;
    onClose: () => void;
    onError: (msg: string) => void;
}

const MAIN_TRACK = "Main story";
const COLORS = ["#3c7cc0", "#c2475a", "#3f8f6b", "#c7773b", "#8e6fbf", "#d0a62a", "#6b7280"];

function newEvent(document: string | null): TimelineEvent {
    return {
        id: crypto.randomUUID(),
        title: "",
        date: "",
        time: "",
        description: "",
        track: "",
        color: "",
        document,
        characters: [],
    };
}

export function TimelineView({ binder, currentDocumentId, onOpenDocument, onClose, onError }: Props) {
    const [events, setEvents] = useState<TimelineEvent[] | null>(null);
    const [editing, setEditing] = useState<TimelineEvent | null>(null);
    const [trackFilter, setTrackFilter] = useState("");
    const [characterFilter, setCharacterFilter] = useState("");

    useEffect(() => {
        api.getTimeline()
            .then(setEvents)
            .catch((e) => onError(String(e)));
    }, [onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            if (editing) setEditing(null);
            else onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [editing, onClose]);

    const byId = useMemo(() => new Map(binder.map((d) => [d.id, d])), [binder]);
    const characters = useMemo(
        () => binder.filter((d) => d.sheet_kind === "character" && !d.in_trash),
        [binder],
    );
    const scenes = useMemo(() => {
        const draft = binder.find((d) => d.kind === "draft_root");
        return draft ? descendants(binder, draft.id).filter((r) => !isFolderKind(r.meta.kind)) : [];
    }, [binder]);

    const tracks = useMemo(() => {
        const out: string[] = [];
        for (const e of events ?? []) {
            const t = e.track || MAIN_TRACK;
            if (!out.includes(t)) out.push(t);
        }
        return out.length ? out : [MAIN_TRACK];
    }, [events]);

    const shown = (events ?? []).filter(
        (e) =>
            (!trackFilter || (e.track || MAIN_TRACK) === trackFilter) &&
            (!characterFilter || e.characters.includes(characterFilter)),
    );
    const lanes = trackFilter ? [trackFilter] : tracks;

    // Rows: consecutive events with the same date (events arrive sorted).
    const rows: { date: string; events: TimelineEvent[] }[] = [];
    for (const e of shown) {
        const last = rows[rows.length - 1];
        if (last && last.date.trim().toLowerCase() === e.date.trim().toLowerCase()) last.events.push(e);
        else rows.push({ date: e.date, events: [e] });
    }

    async function save(e: TimelineEvent) {
        try {
            setEvents(await api.saveTimelineEvent(e));
            setEditing(null);
        } catch (err) {
            onError(String(err));
        }
    }

    async function remove(e: TimelineEvent) {
        if (!confirm(t("Delete the event “{title}”?", { title: e.title || t("Untitled event") }))) return;
        try {
            setEvents(await api.deleteTimelineEvent(e.id));
            setEditing(null);
        } catch (err) {
            onError(String(err));
        }
    }

    return (
        <div className="overlay-root timeline-overlay" onMouseDown={onClose}>
            <div className="timeline" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label={t("Story timeline")}>
                <header className="timeline-bar">
                    <span className="dialog-title">{t("Timeline")}</span>
                    <button
                        type="button"
                        className="primary timeline-add"
                        onClick={() => setEditing(newEvent(currentDocumentId && byId.get(currentDocumentId)?.kind === "document" ? currentDocumentId : null))}
                    >
                        <IconPlus size={13} /> {t("New Event")}
                    </button>
                    <select value={trackFilter} onChange={(e) => setTrackFilter(e.target.value)} aria-label={t("Track")}>
                        <option value="">{t("All tracks")}</option>
                        {tracks.map((t) => (
                            <option key={t} value={t}>
                                {t}
                            </option>
                        ))}
                    </select>
                    <select
                        value={characterFilter}
                        onChange={(e) => setCharacterFilter(e.target.value)}
                        aria-label={t("Character")}
                    >
                        <option value="">{t("All characters")}</option>
                        {characters.map((c) => (
                            <option key={c.id} value={c.id}>
                                {c.title}
                            </option>
                        ))}
                    </select>
                    <span className="timeline-count">
                        {shown.length} {shown.length === 1 ? "event" : "events"}
                    </span>
                    <button type="button" className="timeline-close" title={t("Close (Esc)")} aria-label={t("Close")} onClick={onClose}>
                        <IconClose size={16} />
                    </button>
                </header>

                <div className="timeline-main">
                    <div className="timeline-scroll">
                        {events === null ? (
                            <div className="timeline-empty">{t("Loading…")}</div>
                        ) : events.length === 0 ? (
                            <div className="timeline-empty">
                                {t("No events yet. Add the things that happen in your story, give each a story date (“2026-05-14”, “Day 3”, “Year 2, spring”…) and a track for each storyline or point of view.")}
                            </div>
                        ) : (
                            <div
                                className="timeline-grid"
                                style={{ gridTemplateColumns: `130px repeat(${lanes.length}, minmax(210px, 1fr))` }}
                            >
                                <div className="timeline-head timeline-date-head">{t("Date")}</div>
                                {lanes.map((t) => (
                                    <div key={t} className="timeline-head">
                                        {t}
                                    </div>
                                ))}
                                {rows.map((r, i) => (
                                    <TimelineRow
                                        key={`${r.date}:${i}`}
                                        date={r.date}
                                        lanes={lanes}
                                        events={r.events}
                                        byId={byId}
                                        selectedId={editing?.id ?? null}
                                        onEdit={(e) => setEditing({ ...e })}
                                        onOpenDocument={onOpenDocument}
                                    />
                                ))}
                            </div>
                        )}
                    </div>

                    {editing && (
                        <EventEditor
                            key={editing.id}
                            event={editing}
                            isNew={!(events ?? []).some((e) => e.id === editing.id)}
                            tracks={tracks.filter((t) => t !== MAIN_TRACK)}
                            scenes={scenes.map((s) => s.meta)}
                            characters={characters}
                            onSave={save}
                            onDelete={remove}
                            onCancel={() => setEditing(null)}
                        />
                    )}
                </div>
            </div>
        </div>
    );
}

function TimelineRow({
    date,
    lanes,
    events,
    byId,
    selectedId,
    onEdit,
    onOpenDocument,
}: {
    date: string;
    lanes: string[];
    events: TimelineEvent[];
    byId: Map<string, DocumentMetaDto>;
    selectedId: string | null;
    onEdit: (e: TimelineEvent) => void;
    onOpenDocument: (id: string) => void;
}) {
    return (
        <>
            <div className="timeline-date">{date || <em>{t("No date")}</em>}</div>
            {lanes.map((lane) => (
                <div key={lane} className="timeline-cell">
                    {events
                        .filter((e) => (e.track || MAIN_TRACK) === lane)
                        .map((e) => {
                            const scene = e.document ? byId.get(e.document) : undefined;
                            return (
                                <article
                                    key={e.id}
                                    className={`timeline-event${selectedId === e.id ? " selected" : ""}`}
                                    style={{ borderLeftColor: e.color || "var(--accent)" }}
                                    tabIndex={0}
                                    onClick={() => onEdit(e)}
                                    onKeyDown={(k) => {
                                        if (k.key === "Enter") onEdit(e);
                                    }}
                                >
                                    <div className="timeline-event-title">
                                        {e.time && <span className="timeline-time">{e.time}</span>}
                                        {e.title}
                                    </div>
                                    {e.description && <div className="timeline-desc">{e.description}</div>}
                                    {(scene || e.characters.length > 0) && (
                                        <div className="timeline-meta">
                                            {scene && (
                                                <button
                                                    type="button"
                                                    className="timeline-scene"
                                                    title={t("Open “{title}”", { title: scene.title })}
                                                    onClick={(ev) => {
                                                        ev.stopPropagation();
                                                        onOpenDocument(scene.id);
                                                    }}
                                                >
                                                    <IconOpen size={11} /> {scene.title}
                                                </button>
                                            )}
                                            {e.characters.map((c) => {
                                                const ch = byId.get(c);
                                                return ch ? (
                                                    <span key={c} className="timeline-character">
                                                        <DocIcon id="character:sheet" size={11} />
                                                        {ch.title}
                                                    </span>
                                                ) : null;
                                            })}
                                        </div>
                                    )}
                                </article>
                            );
                        })}
                </div>
            ))}
        </>
    );
}

function EventEditor({
    event,
    isNew,
    tracks,
    scenes,
    characters,
    onSave,
    onDelete,
    onCancel,
}: {
    event: TimelineEvent;
    isNew: boolean;
    tracks: string[];
    scenes: DocumentMetaDto[];
    characters: DocumentMetaDto[];
    onSave: (e: TimelineEvent) => void;
    onDelete: (e: TimelineEvent) => void;
    onCancel: () => void;
}) {
    const [e, setE] = useState(event);
    const set = (patch: Partial<TimelineEvent>) => setE((prev) => ({ ...prev, ...patch }));

    return (
        <aside className="timeline-editor" aria-label={t("Event")}>
            <h3>{isNew ? t("New event") : t("Event")}</h3>
            <label className="form-field">
                <span className="form-field-label">{t("Title")}</span>
                <input type="text" autoFocus value={e.title} onChange={(x) => set({ title: x.target.value })} />
            </label>
            <div className="goals-row">
                <label className="form-field">
                    <span className="form-field-label">{t("Story date")}</span>
                    <input
                        type="text"
                        value={e.date}
                        placeholder={t("2026-05-14 or Day 3")}
                        onChange={(x) => set({ date: x.target.value })}
                    />
                </label>
                <label className="form-field">
                    <span className="form-field-label">{t("Time")}</span>
                    <input type="text" value={e.time} placeholder="21:30" onChange={(x) => set({ time: x.target.value })} />
                </label>
            </div>
            <label className="form-field">
                <span className="form-field-label">{t("Track")}</span>
                <input
                    type="text"
                    list="timeline-tracks"
                    value={e.track}
                    placeholder={MAIN_TRACK}
                    onChange={(x) => set({ track: x.target.value })}
                />
                <datalist id="timeline-tracks">
                    {tracks.map((t) => (
                        <option key={t} value={t} />
                    ))}
                </datalist>
            </label>
            <div className="form-field">
                <span className="form-field-label">{t("Colour")}</span>
                <div className="timeline-colors">
                    {COLORS.map((c) => (
                        <button
                            key={c}
                            type="button"
                            className={`timeline-swatch${e.color === c ? " active" : ""}`}
                            style={{ background: c }}
                            aria-label={t("Colour {color}", { color: c })}
                            onClick={() => set({ color: c })}
                        />
                    ))}
                    <button type="button" className="link-btn" onClick={() => set({ color: "" })}>
                        {t("Default")}
                    </button>
                </div>
            </div>
            <label className="form-field">
                <span className="form-field-label">{t("What happens")}</span>
                <textarea rows={4} value={e.description} onChange={(x) => set({ description: x.target.value })} />
            </label>
            <label className="form-field">
                <span className="form-field-label">{t("Scene")}</span>
                <select value={e.document ?? ""} onChange={(x) => set({ document: x.target.value || null })}>
                    <option value="">{t("(none)")}</option>
                    {scenes.map((s) => (
                        <option key={s.id} value={s.id}>
                            {s.title}
                        </option>
                    ))}
                </select>
            </label>
            <div className="form-field">
                <span className="form-field-label">{t("Characters")}</span>
                {characters.length === 0 ? (
                    <span className="inspector-note">{t("Create character sheets in the binder to pick them here.")}</span>
                ) : (
                    <div className="timeline-character-picks">
                        {characters.map((c) => (
                            <label key={c.id} className="prefs-check">
                                <input
                                    type="checkbox"
                                    checked={e.characters.includes(c.id)}
                                    onChange={(x) =>
                                        set({
                                            characters: x.target.checked
                                                ? [...e.characters, c.id]
                                                : e.characters.filter((id) => id !== c.id),
                                        })
                                    }
                                />
                                {c.title}
                            </label>
                        ))}
                    </div>
                )}
            </div>
            <div className="timeline-editor-actions">
                {!isNew && (
                    <button type="button" className="danger-text" onClick={() => onDelete(e)}>
                        {t("Delete")}
                    </button>
                )}
                <span className="spacer" />
                <button type="button" onClick={onCancel}>
                    {t("Cancel")}
                </button>
                <button type="button" className="primary" onClick={() => onSave(e)}>
                    {t("Save")}
                </button>
            </div>
        </aside>
    );
}
