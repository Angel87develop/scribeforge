/// Create or edit a collection. A *collection* holds documents you add to
/// it by hand; a *saved search* holds criteria and always shows whatever
/// matches them now (e.g. every chapter whose status is First Draft).

import { useEffect, useState } from "react";
import { api, type Collection, type CollectionQuery } from "../services/api";
import { useOrganization } from "../services/organization";
import { IconList } from "../components/Icons";
import "../styles/dialogs.css";
import "../styles/organization.css";
import { t, tn } from "../i18n";

interface Props {
    /** Null to create a new one of `kind`. */
    collection: Collection | null;
    kind: "manual" | "search";
    /** Documents to put in a new manual collection. */
    initialItems?: string[];
    onSaved: (collections: Collection[], id: string) => void;
    onClose: () => void;
    onError: (msg: string) => void;
}

const EMPTY_QUERY: CollectionQuery = {
    text: "",
    status: "",
    label: "",
    keyword: "",
    sheet: "",
    scope: "manuscript",
    documents_only: true,
};

export function CollectionDialog({ collection, kind, initialItems, onSaved, onClose, onError }: Props) {
    const { labels, statuses } = useOrganization();
    const [draft, setDraft] = useState<Collection>(
        () =>
            collection ?? {
                id: crypto.randomUUID(),
                name: "",
                color: "",
                kind,
                items: initialItems ?? [],
                query: { ...EMPTY_QUERY },
            },
    );

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    const q = draft.query;
    const setQ = (patch: Partial<CollectionQuery>) => setDraft((d) => ({ ...d, query: { ...d.query, ...patch } }));

    // Suggest a name from the criteria while the user has not typed one.
    const suggested =
        draft.kind === "search"
            ? [q.status, q.label, q.sheet === "character" ? "Characters" : q.sheet === "place" ? "Places" : "", q.keyword, q.text && `“${q.text}”`]
                  .filter(Boolean)
                  .join(" · ") || "Saved search"
            : "New collection";

    async function save() {
        try {
            const c = { ...draft, name: draft.name.trim() || suggested };
            const list = await api.saveCollection(c);
            onSaved(list, c.id);
            onClose();
        } catch (e) {
            onError(String(e));
        }
    }

    return (
        <div className="overlay-root" onMouseDown={onClose}>
            <div className="dialog collection-dialog" onMouseDown={(e) => e.stopPropagation()}>
                <div className="dialog-header">
                    <IconList size={18} />
                    <span className="dialog-title">
                        {draft.kind === "search"
                            ? collection
                                ? t("Edit Saved Search")
                                : t("New Saved Search")
                            : collection
                              ? t("Edit Collection")
                              : t("New Collection")}
                    </span>
                </div>
                <div className="dialog-body">
                    <div className="goals-row">
                        <label className="form-field">
                            <span className="form-field-label">{t("Name")}</span>
                            <input
                                type="text"
                                autoFocus
                                value={draft.name}
                                placeholder={suggested}
                                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                            />
                        </label>
                        <label className="form-field">
                            <span className="form-field-label">{t("Tab colour")}</span>
                            <span className="collection-color">
                                <input
                                    type="color"
                                    value={draft.color || "#9a948a"}
                                    onChange={(e) => setDraft({ ...draft, color: e.target.value })}
                                />
                                {draft.color && (
                                    <button type="button" className="link-btn" onClick={() => setDraft({ ...draft, color: "" })}>
                                        {t("None")}
                                    </button>
                                )}
                            </span>
                        </label>
                    </div>

                    {draft.kind === "manual" ? (
                        <p className="prefs-note">
                            {t("Add documents from the binder: right-click one and choose Add to Collection.")}
                            {draft.items.length > 0 &&
                                ` ${tn(draft.items.length, "It holds {n} document.", "It holds {n} documents.")}`}
                        </p>
                    ) : (
                        <>
                            <p className="prefs-note">
                                {t("Shows every document that matches all the filled-in criteria, always up to date.")}
                            </p>
                            <label className="form-field">
                                <span className="form-field-label">{t("Containing the words")}</span>
                                <input
                                    type="text"
                                    value={q.text}
                                    placeholder={t("In the title, synopsis, notes or text")}
                                    onChange={(e) => setQ({ text: e.target.value })}
                                />
                            </label>
                            <div className="goals-row">
                                <label className="form-field">
                                    <span className="form-field-label">{t("Status")}</span>
                                    <select value={q.status} onChange={(e) => setQ({ status: e.target.value })}>
                                        <option value="">{t("Any")}</option>
                                        {statuses.map((s) => (
                                            <option key={s.name} value={s.name} style={{ color: s.color }}>
                                                ● {s.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                                <label className="form-field">
                                    <span className="form-field-label">{t("Label")}</span>
                                    <select value={q.label} onChange={(e) => setQ({ label: e.target.value })}>
                                        <option value="">{t("Any")}</option>
                                        {labels.map((l) => (
                                            <option key={l.name} value={l.name} style={{ color: l.color }}>
                                                ● {l.name}
                                            </option>
                                        ))}
                                    </select>
                                </label>
                            </div>
                            <div className="goals-row">
                                <label className="form-field">
                                    <span className="form-field-label">{t("Keyword")}</span>
                                    <input type="text" value={q.keyword} onChange={(e) => setQ({ keyword: e.target.value })} />
                                </label>
                                <label className="form-field">
                                    <span className="form-field-label">{t("Sheets")}</span>
                                    <select value={q.sheet} onChange={(e) => setQ({ sheet: e.target.value })}>
                                        <option value="">{t("Any document")}</option>
                                        <option value="character">{t("Character sheets")}</option>
                                        <option value="place">{t("Place sheets")}</option>
                                        <option value="any">{t("Any sheet")}</option>
                                    </select>
                                </label>
                            </div>
                            <div className="goals-row">
                                <label className="form-field">
                                    <span className="form-field-label">{t("Look in")}</span>
                                    <select
                                        value={q.scope}
                                        onChange={(e) => setQ({ scope: e.target.value as CollectionQuery["scope"] })}
                                    >
                                        <option value="manuscript">{t("The manuscript")}</option>
                                        <option value="research">{t("Research")}</option>
                                        <option value="all">{t("The whole project")}</option>
                                    </select>
                                </label>
                                <label className="prefs-check collection-docs-only">
                                    <input
                                        type="checkbox"
                                        checked={q.documents_only}
                                        onChange={(e) => setQ({ documents_only: e.target.checked })}
                                    />
                                    {t("Documents only (leave folders out)")}
                                </label>
                            </div>
                        </>
                    )}
                </div>
                <div className="dialog-footer">
                    <button type="button" onClick={onClose}>
                        {t("Cancel")}
                    </button>
                    <button type="button" className="primary" onClick={save}>
                        {collection ? t("Save") : t("Create")}
                    </button>
                </div>
            </div>
        </div>
    );
}
