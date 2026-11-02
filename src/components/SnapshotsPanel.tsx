/// Snapshots tab of the Inspector: take a snapshot of the document's text,
/// rename or delete snapshots, compare one with the current text (or two
/// with each other) and restore one.
///
/// Restoring keeps the replaced text as a new snapshot, so it can be undone.
/// Pending editor changes are saved first, so a snapshot (or a comparison)
/// always includes the latest typing.

import { useCallback, useEffect, useState } from "react";
import { api, type SnapshotMeta } from "../services/api";
import { SnapshotCompareDialog } from "../dialogs/SnapshotCompareDialog";
import { IconCamera } from "./Icons";
import { getLanguage, t, tn } from "../i18n";

interface Props {
    documentId: string;
    documentTitle: string;
    /** Changes when a snapshot was taken elsewhere (Ctrl+5, find and replace). */
    reloadToken: number;
    flushEditors: () => Promise<void>;
    /** The document text was replaced by a snapshot. */
    onRestored: () => void;
    onError: (msg: string) => void;
}

function when(iso: string): string {
    return new Date(iso).toLocaleString(getLanguage(), { dateStyle: "medium", timeStyle: "short" });
}

export function SnapshotsPanel({ documentId, documentTitle, reloadToken, flushEditors, onRestored, onError }: Props) {
    const [list, setList] = useState<SnapshotMeta[]>([]);
    const [name, setName] = useState("");
    const [selected, setSelected] = useState<string | null>(null);
    const [editing, setEditing] = useState<string | null>(null);
    const [editName, setEditName] = useState("");
    const [compare, setCompare] = useState<{ snapshot: SnapshotMeta; other: SnapshotMeta | null } | null>(null);

    const load = useCallback(() => {
        api.listSnapshots(documentId)
            .then(setList)
            .catch((e) => onError(String(e)));
    }, [documentId, onError]);

    useEffect(load, [load, reloadToken]);

    async function take() {
        try {
            await flushEditors();
            const meta = await api.createSnapshot(documentId, name);
            setName("");
            setSelected(meta.id);
            load();
        } catch (e) {
            onError(String(e));
        }
    }

    async function restore(s: SnapshotMeta) {
        const label = s.name || when(s.created_at);
        if (
            !confirm(
                t("Replace the text of “{title}” with the snapshot “{snapshot}”?\n\nThe current text is kept as a new snapshot.", {
                    title: documentTitle,
                    snapshot: label,
                }),
            )
        )
            return;
        try {
            await flushEditors();
            await api.restoreSnapshot(documentId, s.id);
            setCompare(null);
            load();
            onRestored();
        } catch (e) {
            onError(String(e));
        }
    }

    async function remove(s: SnapshotMeta) {
        if (!confirm(t("Delete the snapshot “{name}”? This cannot be undone.", { name: s.name || when(s.created_at) }))) return;
        try {
            await api.deleteSnapshot(documentId, s.id);
            if (selected === s.id) setSelected(null);
            load();
        } catch (e) {
            onError(String(e));
        }
    }

    async function commitRename(s: SnapshotMeta) {
        setEditing(null);
        if (editName.trim() === s.name) return;
        try {
            await api.renameSnapshot(documentId, s.id, editName);
            load();
        } catch (e) {
            onError(String(e));
        }
    }

    const sel = list.find((s) => s.id === selected) ?? null;

    return (
        <div className="snapshots">
            <form
                className="snapshots-take"
                onSubmit={(e) => {
                    e.preventDefault();
                    take();
                }}
            >
                <input
                    type="text"
                    value={name}
                    placeholder={t("Snapshot name (optional)")}
                    onChange={(e) => setName(e.target.value)}
                />
                <button type="submit" title={t("Take a snapshot of the current text (Ctrl+5)")}>
                    <IconCamera size={14} /> {t("Take")}
                </button>
            </form>

            {list.length === 0 ? (
                <div className="inspector-note">
                    {t("No snapshots yet. A snapshot keeps a copy of this document's text that you can compare with later versions and restore.")}
                </div>
            ) : (
                <ul className="snapshots-list" role="listbox" aria-label={t("Snapshots")}>
                    {list.map((s) => (
                        <li
                            key={s.id}
                            role="option"
                            aria-selected={selected === s.id}
                            className={selected === s.id ? "selected" : ""}
                            onClick={() => setSelected(s.id)}
                            onDoubleClick={() => setCompare({ snapshot: s, other: null })}
                        >
                            {editing === s.id ? (
                                <input
                                    autoFocus
                                    value={editName}
                                    onChange={(e) => setEditName(e.target.value)}
                                    onBlur={() => commitRename(s)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") commitRename(s);
                                        if (e.key === "Escape") setEditing(null);
                                    }}
                                />
                            ) : (
                                <span className="snapshots-name" title={t("Double-click to compare with the current text")}>
                                    {s.name || <em>{t("Untitled snapshot")}</em>}
                                </span>
                            )}
                            <span className="snapshots-meta">
                                {when(s.created_at)} · {tn(s.word_count, "{n} word", "{n} words")}
                            </span>
                        </li>
                    ))}
                </ul>
            )}

            {sel && (
                <div className="snapshots-actions">
                    <button type="button" onClick={() => flushEditors().then(() => setCompare({ snapshot: sel, other: null }))}>
                        {t("Compare with current")}
                    </button>
                    {list.length > 1 && (
                        <select
                            value=""
                            onChange={(e) => {
                                const other = list.find((s) => s.id === e.target.value) ?? null;
                                if (other) setCompare({ snapshot: sel, other });
                            }}
                        >
                            <option value="">{t("Compare with snapshot…")}</option>
                            {list
                                .filter((s) => s.id !== sel.id)
                                .map((s) => (
                                    <option key={s.id} value={s.id}>
                                        {(s.name || t("Untitled")) + " — " + when(s.created_at)}
                                    </option>
                                ))}
                        </select>
                    )}
                    <button type="button" onClick={() => restore(sel)}>
                        {t("Restore")}
                    </button>
                    <button
                        type="button"
                        onClick={() => {
                            setEditing(sel.id);
                            setEditName(sel.name);
                        }}
                    >
                        {t("Rename")}
                    </button>
                    <button type="button" className="danger-text" onClick={() => remove(sel)}>
                        {t("Delete")}
                    </button>
                </div>
            )}

            {compare && (
                <SnapshotCompareDialog
                    documentId={documentId}
                    documentTitle={documentTitle}
                    snapshot={compare.snapshot}
                    other={compare.other}
                    onRestore={() => restore(compare.snapshot)}
                    onClose={() => setCompare(null)}
                    onError={onError}
                />
            )}
        </div>
    );
}
