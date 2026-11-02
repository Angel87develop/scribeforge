/// Labels and Status: edit the project's lists of labels and statuses —
/// names, colours and order. Renaming an entry also renames it on every
/// document that uses it; deleting one leaves those documents' values as
/// they are (they simply show without a colour).

import { useEffect, useState } from "react";
import type { ColorDef, DefinitionRename } from "../services/api";
import { useOrganization } from "../services/organization";
import { IconClose, IconPlus } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/organization.css";
import { t } from "../i18n";

interface Props {
    onClose: () => void;
}

/** A row being edited, remembering the name it had when the dialog opened. */
interface Row extends ColorDef {
    original: string | null;
}

const PALETTE = ["#c2475a", "#c7773b", "#d0a62a", "#3f8f6b", "#3c7cc0", "#8e6fbf", "#9a948a", "#4a8a4a"];

function DefinitionList({
    title,
    rows,
    onChange,
}: {
    title: string;
    rows: Row[];
    onChange: (rows: Row[]) => void;
}) {
    const set = (i: number, patch: Partial<Row>) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    const move = (i: number, d: -1 | 1) => {
        const j = i + d;
        if (j < 0 || j >= rows.length) return;
        const next = [...rows];
        [next[i], next[j]] = [next[j], next[i]];
        onChange(next);
    };
    return (
        <section className="defs-section">
            <h3>{title}</h3>
            <ul className="defs-list">
                {rows.map((r, i) => (
                    <li key={i}>
                        <input
                            type="color"
                            value={r.color}
                            aria-label={t("Colour of {name}", { name: r.name || t("new entry") })}
                            onChange={(e) => set(i, { color: e.target.value })}
                        />
                        <input
                            type="text"
                            value={r.name}
                            placeholder={t("Name")}
                            onChange={(e) => set(i, { name: e.target.value })}
                        />
                        <button type="button" className="defs-btn" title={t("Move up")} disabled={i === 0} onClick={() => move(i, -1)}>
                            ↑
                        </button>
                        <button
                            type="button"
                            className="defs-btn"
                            title={t("Move down")}
                            disabled={i === rows.length - 1}
                            onClick={() => move(i, 1)}
                        >
                            ↓
                        </button>
                        <button
                            type="button"
                            className="defs-btn"
                            title={t("Remove")}
                            aria-label={t("Remove {name}", { name: r.name })}
                            onClick={() => onChange(rows.filter((_, j) => j !== i))}
                        >
                            <IconClose size={12} />
                        </button>
                    </li>
                ))}
            </ul>
            <button
                type="button"
                className="defs-add"
                onClick={() =>
                    onChange([...rows, { name: "", color: PALETTE[rows.length % PALETTE.length], original: null }])
                }
            >
                <IconPlus size={12} /> {t("Add")}
            </button>
        </section>
    );
}

export function LabelsDialog({ onClose }: Props) {
    const { labels, statuses, save } = useOrganization();
    const [labelRows, setLabelRows] = useState<Row[]>(() => labels.map((l) => ({ ...l, original: l.name })));
    const [statusRows, setStatusRows] = useState<Row[]>(() => statuses.map((s) => ({ ...s, original: s.name })));
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    async function submit() {
        setSaving(true);
        const renames: DefinitionRename[] = [];
        for (const r of labelRows) {
            if (r.original && r.name.trim() && r.original !== r.name.trim()) {
                renames.push({ kind: "label", from: r.original, to: r.name.trim() });
            }
        }
        for (const r of statusRows) {
            if (r.original && r.name.trim() && r.original !== r.name.trim()) {
                renames.push({ kind: "status", from: r.original, to: r.name.trim() });
            }
        }
        const strip = (rows: Row[]) => rows.map(({ name, color }) => ({ name, color }));
        await save(strip(labelRows), strip(statusRows), renames);
        onClose();
    }

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog labels-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <span className="label-dot" style={{ background: "#c7773b", width: 12, height: 12 }} />
                    <span className="dialog-title">{t("Labels and Status")}</span>
                </div>
                <div className="dialog-body labels-body">
                    <DefinitionList title={t("Labels")} rows={labelRows} onChange={setLabelRows} />
                    <DefinitionList title={t("Status (in workflow order)")} rows={statusRows} onChange={setStatusRows} />
                </div>
                <div className="dialog-footer">
                    <span className="find-footnote">{t("Renaming an entry renames it on every document that uses it.")}</span>
                    <button type="button" onClick={onClose}>
                        {t("Cancel")}
                    </button>
                    <button type="button" className="primary" disabled={saving} onClick={submit}>
                        {t("Save")}
                    </button>
                </div>
            </div>
        </div>
    );
}
