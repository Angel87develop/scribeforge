/// Links tab of the Inspector: the `[[wiki links]]` written in the document,
/// and its backlinks — the documents that link here, or whose sheet names
/// this one in a relationship. A link to a title no document has yet can be
/// turned into a new document in Research with one click.

import { useCallback, useEffect, useState } from "react";
import { api, type DocumentMetaDto, type LinksDto } from "../services/api";
import { IconLink } from "./Icons";
import { t } from "../i18n";

interface Props {
    documentId: string;
    title: string;
    binder: DocumentMetaDto[];
    reloadToken: number;
    flushEditors: () => Promise<void>;
    onOpenDocument: (id: string) => void;
    onError: (msg: string) => void;
}

export function LinksPanel({ documentId, title, binder, reloadToken, flushEditors, onOpenDocument, onError }: Props) {
    const [links, setLinks] = useState<LinksDto | null>(null);

    const load = useCallback(async () => {
        try {
            await flushEditors();
            setLinks(await api.getLinks(documentId));
        } catch (e) {
            onError(String(e));
        }
    }, [documentId, flushEditors, onError]);

    // Reload when the document, its title or the binder changes.
    const binderKey = binder.map((d) => `${d.id}:${d.title}:${d.modified_at}`).join("|");
    useEffect(() => {
        void load();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [load, reloadToken, title, binderKey]);

    async function create(linkTitle: string) {
        const research = binder.find((d) => d.kind === "research_root");
        if (!research) return;
        try {
            const meta = await api.createDocument(research.id, "research", linkTitle);
            onOpenDocument(meta.id);
        } catch (e) {
            onError(String(e));
        }
    }

    if (!links) return <div className="inspector-note">{t("Loading links…")}</div>;

    return (
        <div className="links-panel">
            <section>
                <h4>{t("Links in this document")}</h4>
                {links.outgoing.length === 0 ? (
                    <div className="inspector-note">
                        {t("None. Type")} <code>[[</code> {t("in the text and pick a document to link to it.")}
                    </div>
                ) : (
                    <ul className="links-list">
                        {links.outgoing.map((l) => (
                            <li key={l.title}>
                                <IconLink size={12} />
                                {l.target ? (
                                    <button type="button" className="link-btn" onClick={() => onOpenDocument(l.target!)}>
                                        {l.title}
                                    </button>
                                ) : (
                                    <>
                                        <span className="links-missing" title={t("No document has this title")}>
                                            {l.title}
                                        </span>
                                        <button type="button" className="link-btn" onClick={() => create(l.title)}>
                                            {t("Create")}
                                        </button>
                                    </>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
            <section>
                <h4>{t("Backlinks")}</h4>
                {links.backlinks.length === 0 ? (
                    <div className="inspector-note">
                        {t("No document links here yet. Write")} <code>[[{title}]]</code> {t("in another document.")}
                    </div>
                ) : (
                    <ul className="links-list backlinks">
                        {links.backlinks.map((b, i) => (
                            <li key={`${b.id}:${i}`}>
                                <button type="button" className="link-btn" onClick={() => onOpenDocument(b.id)}>
                                    {b.title}
                                </button>
                                <span className="links-via">{b.via === "relation" ? "relationship" : "link"}</span>
                                {b.context && <div className="links-context">{b.context}</div>}
                            </li>
                        ))}
                    </ul>
                )}
            </section>
        </div>
    );
}
