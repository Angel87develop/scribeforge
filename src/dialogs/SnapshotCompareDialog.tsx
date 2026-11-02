/// Comparison of a snapshot with the current text (or with another
/// snapshot), word by word: removed text is struck through in red, added
/// text underlined in green. "Changes only" folds long unchanged passages.

import { useEffect, useState } from "react";
import { api, type DiffChunk, type DiffResult, type SnapshotMeta } from "../services/api";
import { IconCamera } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/writing.css";
import { getLanguage, t } from "../i18n";

interface Props {
    documentId: string;
    documentTitle: string;
    snapshot: SnapshotMeta;
    /** Compare with this snapshot instead of the current text. */
    other: SnapshotMeta | null;
    onRestore: () => void;
    onClose: () => void;
    onError: (msg: string) => void;
}

const CONTEXT = 160;

function label(s: SnapshotMeta): string {
    const date = new Date(s.created_at).toLocaleString(getLanguage(), { dateStyle: "medium", timeStyle: "short" });
    return s.name ? `${s.name} (${date})` : date;
}

/** Shorten equal chunks to their first and last few characters. */
function fold(chunks: DiffChunk[]): DiffChunk[] {
    return chunks.map((c, i) => {
        if (c.kind !== "equal" || c.text.length <= CONTEXT * 2 + 20) return c;
        const head = i === 0 ? "" : c.text.slice(0, CONTEXT);
        const tail = i === chunks.length - 1 ? "" : c.text.slice(-CONTEXT);
        return { kind: "equal", text: `${head}\n⋯\n${tail}` };
    });
}

export function SnapshotCompareDialog({ documentId, documentTitle, snapshot, other, onRestore, onClose, onError }: Props) {
    const [diff, setDiff] = useState<DiffResult | null>(null);
    const [changesOnly, setChangesOnly] = useState(true);

    useEffect(() => {
        api.diffSnapshot(documentId, snapshot.id, other?.id)
            .then(setDiff)
            .catch((e) => onError(String(e)));
    }, [documentId, snapshot.id, other?.id, onError]);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    // With two snapshots, the older one is the original.
    const [older, newer] =
        other && other.created_at < snapshot.created_at ? [other, snapshot] : [snapshot, other];
    const unchanged = diff !== null && diff.chunks.every((c) => c.kind === "equal");
    const chunks = diff ? (changesOnly ? fold(diff.chunks) : diff.chunks) : [];

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog compare-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconCamera size={18} />
                    <span className="dialog-title">{t("Compare — {title}", { title: documentTitle })}</span>
                </div>
                <div className="compare-legend">
                    <span>
                        <del>{label(older)}</del>
                    </span>
                    <span>→</span>
                    <span>
                        <ins>{newer ? label(newer) : t("Current text")}</ins>
                    </span>
                    {diff && (
                        <span className="compare-counts">
                            {t("+{added} / −{removed} words", {
                                added: diff.words_added.toLocaleString(getLanguage()),
                                removed: diff.words_removed.toLocaleString(getLanguage()),
                            })}
                        </span>
                    )}
                    <label className="prefs-check compare-toggle">
                        <input type="checkbox" checked={changesOnly} onChange={(e) => setChangesOnly(e.target.checked)} />
                        {t("Changes only")}
                    </label>
                </div>
                <div className="dialog-body compare-body">
                    {!diff ? (
                        t("Comparing…")
                    ) : unchanged ? (
                        <div className="inspector-note">{t("The texts are identical.")}</div>
                    ) : (
                        <div className="compare-text">
                            {chunks.map((c, i) =>
                                c.kind === "insert" ? (
                                    <ins key={i}>{c.text}</ins>
                                ) : c.kind === "delete" ? (
                                    <del key={i}>{c.text}</del>
                                ) : (
                                    <span key={i}>{c.text}</span>
                                ),
                            )}
                        </div>
                    )}
                </div>
                <div className="dialog-footer">
                    <button type="button" onClick={onClose}>
                        {t("Close")}
                    </button>
                    <button type="button" className="primary" onClick={onRestore}>
                        {t("Restore this snapshot")}
                    </button>
                </div>
            </div>
        </div>
    );
}
