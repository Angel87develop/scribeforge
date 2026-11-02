/// The structured part of a character or place sheet, shown above the
/// document's free text: one row per field (label and value, both
/// editable), plus relationships to other documents ("sister of" → Ana).
/// Changes are handed to the parent, which saves them.

import { useMemo, useState } from "react";
import type { DocumentMetaDto, Sheet } from "../services/api";
import { isRootKind } from "./binderTree";
import { DocIcon } from "./DocIcons";
import { IconChevronDown, IconChevronRight, IconClose, IconOpen, IconPlus } from "./Icons";
import "../styles/organization.css";
import { t } from "../i18n";

interface Props {
    sheet: Sheet;
    documentId: string;
    binder: DocumentMetaDto[];
    editable: boolean;
    onChange: (sheet: Sheet) => void;
    onRemove: () => void;
    onOpenDocument: (id: string) => void;
}

const OPEN_KEY = "sf.sheet.open";

export function SheetPanel({ sheet, documentId, binder, editable, onChange, onRemove, onOpenDocument }: Props) {
    const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) !== "0");
    const toggle = () => {
        localStorage.setItem(OPEN_KEY, open ? "0" : "1");
        setOpen(!open);
    };

    // Relationship targets: sheets first, then every other document.
    const targets = useMemo(() => {
        const docs = binder.filter((d) => !d.in_trash && !isRootKind(d.kind) && d.id !== documentId);
        return [...docs.filter((d) => d.sheet_kind), ...docs.filter((d) => !d.sheet_kind)];
    }, [binder, documentId]);

    const kindLabel = sheet.kind === "character" ? "Character sheet" : sheet.kind === "place" ? "Place sheet" : "Sheet";
    const setField = (i: number, patch: Partial<Sheet["fields"][number]>) =>
        onChange({ ...sheet, fields: sheet.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) });
    const setRelation = (i: number, patch: Partial<Sheet["relations"][number]>) =>
        onChange({ ...sheet, relations: sheet.relations.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

    return (
        <section className={`sheet-panel${open ? "" : " collapsed"}`} aria-label={kindLabel}>
            <header className="sheet-head">
                <button type="button" className="sheet-toggle" onClick={toggle} aria-expanded={open}>
                    {open ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                    <DocIcon id={sheet.kind === "place" ? "location:sheet" : "character:sheet"} size={14} />
                    {kindLabel}
                </button>
                {open && editable && (
                    <button
                        type="button"
                        className="link-btn sheet-remove"
                        onClick={() => {
                            if (confirm(t("Remove the sheet fields from this document? Its text is kept."))) onRemove();
                        }}
                    >
                        {t("Remove sheet")}
                    </button>
                )}
            </header>
            {open && (
                <div className="sheet-body">
                    <div className="sheet-fields">
                        {sheet.fields.map((f, i) => (
                            <div key={i} className="sheet-field">
                                <input
                                    className="sheet-label"
                                    value={f.label}
                                    readOnly={!editable}
                                    placeholder={t("Field")}
                                    aria-label={t("Field name")}
                                    onChange={(e) => setField(i, { label: e.target.value })}
                                />
                                <textarea
                                    className="sheet-value"
                                    value={f.value}
                                    readOnly={!editable}
                                    rows={Math.min(6, Math.max(1, f.value.split("\n").length, Math.ceil(f.value.length / 60)))}
                                    aria-label={f.label || t("Value")}
                                    onChange={(e) => setField(i, { value: e.target.value })}
                                />
                                {editable && (
                                    <button
                                        type="button"
                                        className="defs-btn"
                                        title={t("Remove field")}
                                        aria-label={t("Remove {name}", { name: f.label })}
                                        onClick={() => onChange({ ...sheet, fields: sheet.fields.filter((_, j) => j !== i) })}
                                    >
                                        <IconClose size={11} />
                                    </button>
                                )}
                            </div>
                        ))}
                        {editable && (
                            <button
                                type="button"
                                className="defs-add"
                                onClick={() => onChange({ ...sheet, fields: [...sheet.fields, { label: "", value: "" }] })}
                            >
                                <IconPlus size={12} /> {t("Add field")}
                            </button>
                        )}
                    </div>

                    <div className="sheet-relations">
                        <h4>{t("Relationships")}</h4>
                        {sheet.relations.length === 0 && <div className="inspector-note">{t("None yet.")}</div>}
                        {sheet.relations.map((r, i) => {
                            const target = binder.find((d) => d.id === r.target);
                            return (
                                <div key={i} className="sheet-relation">
                                    <input
                                        value={r.label}
                                        readOnly={!editable}
                                        placeholder={t("e.g. sister of")}
                                        aria-label={t("Relationship")}
                                        onChange={(e) => setRelation(i, { label: e.target.value })}
                                    />
                                    <select
                                        value={r.target}
                                        disabled={!editable}
                                        onChange={(e) => setRelation(i, { target: e.target.value })}
                                    >
                                        {!target && <option value={r.target}>{t("(deleted document)")}</option>}
                                        {targets.map((d) => (
                                            <option key={d.id} value={d.id}>
                                                {d.title}
                                            </option>
                                        ))}
                                    </select>
                                    {target && (
                                        <button
                                            type="button"
                                            className="defs-btn"
                                            title={t("Open {title}", { title: target.title })}
                                            onClick={() => onOpenDocument(target.id)}
                                        >
                                            <IconOpen size={12} />
                                        </button>
                                    )}
                                    {editable && (
                                        <button
                                            type="button"
                                            className="defs-btn"
                                            title={t("Remove relationship")}
                                            onClick={() =>
                                                onChange({ ...sheet, relations: sheet.relations.filter((_, j) => j !== i) })
                                            }
                                        >
                                            <IconClose size={11} />
                                        </button>
                                    )}
                                </div>
                            );
                        })}
                        {editable && targets.length > 0 && (
                            <button
                                type="button"
                                className="defs-add"
                                onClick={() =>
                                    onChange({ ...sheet, relations: [...sheet.relations, { target: targets[0].id, label: "" }] })
                                }
                            >
                                <IconPlus size={12} /> {t("Add relationship")}
                            </button>
                        )}
                    </div>
                </div>
            )}
        </section>
    );
}
