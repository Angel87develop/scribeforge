/// "Open Recent" overlay dialog.

import { useEffect, useState } from "react";
import { api, type RecentProjectDto } from "../services/api";
import { IconClock, IconClose, IconOpen } from "../components/Icons";
import "../styles/templates.css";

interface Props {
    onOpen: (path: string) => void;
    onClose: () => void;
}

function formatDate(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "—";
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    const day = 86400000;
    if (diff < day) {
        return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
    }
    if (diff < 7 * day) {
        return d.toLocaleDateString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function RecentProjectsDialog({ onOpen, onClose }: Props) {
    const [recents, setRecents] = useState<RecentProjectDto[] | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [selected, setSelected] = useState<string | null>(null);

    useEffect(() => {
        api.listRecentProjects()
            .then(setRecents)
            .catch((e) => setError(String(e)));
    }, []);

    const refresh = () => {
        setError(null);
        api.listRecentProjects()
            .then(setRecents)
            .catch((e) => setError(String(e)));
    };

    const remove = (path: string, e: React.MouseEvent) => {
        e.stopPropagation();
        api.removeRecentProject(path)
            .then(refresh)
            .catch((err) => setError(String(err)));
    };

    const openSelected = () => {
        if (selected) onOpen(selected);
    };

    return (
        <div className="overlay-root" onClick={onClose}>
            <div className="dialog" style={{ minWidth: 540 }} onClick={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconClock size={18} />
                    <span className="dialog-title">Open Recent</span>
                </div>
                <div className="dialog-body">
                    {error && <div className="recent-empty" style={{ color: "var(--danger)" }}>{error}</div>}
                    {!error && !recents && (
                        <div className="recent-empty">Loading recent projects…</div>
                    )}
                    {!error && recents && recents.length === 0 && (
                        <div className="recent-empty">No recent projects yet.</div>
                    )}
                    {!error && recents && recents.length > 0 && (
                        <div className="recent-list">
                            {recents.map((r) => (
                                <div
                                    key={r.path}
                                    className={`recent-item${!r.available ? " unavailable" : ""}${selected === r.path ? " selected" : ""}`}
                                    onClick={() => r.available && setSelected(r.path)}
                                    onDoubleClick={() => r.available && onOpen(r.path)}
                                >
                                    <IconOpen size={18} className="recent-item-icon" />
                                    <div className="recent-item-info">
                                        <div className="recent-item-name">{r.name}</div>
                                        <div className="recent-item-path">{r.path}</div>
                                    </div>
                                    <span className="recent-item-date">{formatDate(r.last_opened)}</span>
                                    <span className={`recent-item-status ${r.available ? "ok" : "missing"}`}>
                                        {r.available ? "Available" : "Missing"}
                                    </span>
                                    <button
                                        className="subtle recent-item-remove"
                                        title="Remove from list"
                                        onClick={(e) => remove(r.path, e)}
                                        style={{ padding: "2px 6px", minHeight: 24 }}
                                    >
                                        <IconClose size={14} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                <div className="dialog-footer">
                    <button onClick={onClose}>Close</button>
                    <button
                        className="primary"
                        disabled={!selected}
                        onClick={openSelected}
                    >
                        Open
                    </button>
                </div>
            </div>
        </div>
    );
}
