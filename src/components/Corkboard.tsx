/// Corkboard: Scrivener-style index cards for the children of a folder.
///
/// Each card shows the document title on top and its synopsis as the body.
/// The synopsis is a separate field from the document content, so editing a
/// card never touches the real text. While a document has no synopsis, the
/// card shows the beginning of its text (muted) as a starting point; the
/// first edit turns it into the card's own synopsis.
///
/// - The card title is independent from the document title: editing it never
///   renames the document. Until it is set, the card shows the document title.
/// - Double-click the card header (or press the open button) to open it.
/// - The last card ("+") adds a new document to the folder.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DocumentMetaDto, type RichDoc } from "../services/api";
import { DocIcon, isKnownIcon } from "./DocIcons";
import { IconDocument, IconFolder, IconOpen, IconPlus } from "./Icons";
import "../styles/corkboard.css";

const EXCERPT_CHARS = 400;
const SAVE_DELAY_MS = 600;

interface Props {
    folderId: string;
    binder: DocumentMetaDto[];
    /** Opens a card's document (or sub-folder) in this pane. */
    onOpenDocument: (id: string, kind: string) => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

function isFolderKind(kind: string): boolean {
    return kind === "folder" || kind.endsWith("_root");
}

/** Plain text of a RichDoc, for the card excerpt. */
function richDocToPlain(doc: RichDoc): string {
    return doc.blocks
        .map((b) => {
            if (b.type === "code_block") return b.text ?? "";
            const spans = b.spans ?? (b.items ?? []).flatMap((i) => i.spans ?? []);
            return spans.map((s) => s.text).join("");
        })
        .filter((t) => t.trim().length > 0)
        .join("\n");
}

export function Corkboard({
    folderId,
    binder,
    onOpenDocument,
    onRefresh,
    onError,
}: Props) {
    const children = useMemo(
        () =>
            binder
                .filter((d) => d.parent === folderId)
                .sort((a, b) => a.order - b.order),
        [binder, folderId],
    );
    const [selected, setSelected] = useState<string | null>(null);
    const [excerpts, setExcerpts] = useState<Record<string, string>>({});

    // Load text excerpts for documents that don't have a synopsis yet.
    const needExcerpt = children
        .filter((d) => !isFolderKind(d.kind) && !d.synopsis)
        .map((d) => d.id)
        .join(",");
    useEffect(() => {
        if (!needExcerpt) return;
        let cancelled = false;
        Promise.all(
            needExcerpt.split(",").map((id) =>
                api.getDocument(id)
                    .then((d) => [id, richDocToPlain(d.content).slice(0, EXCERPT_CHARS)] as const)
                    .catch(() => [id, ""] as const),
            ),
        ).then((pairs) => {
            if (cancelled) return;
            setExcerpts((prev) => {
                const next = { ...prev };
                for (const [id, text] of pairs) next[id] = text;
                return next;
            });
        });
        return () => {
            cancelled = true;
        };
    }, [needExcerpt]);

    async function addCard() {
        try {
            const meta = await api.createDocument(folderId, "document");
            setSelected(meta.id);
            onRefresh();
        } catch (e) {
            onError(String(e));
        }
    }

    return (
        <div className="corkboard" onMouseDown={(e) => {
            if (e.target === e.currentTarget) setSelected(null);
        }}>
            {children.map((d) => (
                <IndexCard
                    key={d.id}
                    meta={d}
                    excerpt={excerpts[d.id] ?? ""}
                    selected={selected === d.id}
                    onSelect={() => setSelected(d.id)}
                    onOpen={() => onOpenDocument(d.id, d.kind)}
                    onRefresh={onRefresh}
                    onError={onError}
                />
            ))}
            <button type="button" className="cork-card cork-card-add" onClick={addCard} title="New document in this folder">
                <IconPlus size={22} />
                <span>New card</span>
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Index card
// ---------------------------------------------------------------------------

interface CardProps {
    meta: DocumentMetaDto;
    excerpt: string;
    selected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onRefresh: () => void;
    onError: (msg: string) => void;
}

function IndexCard({
    meta,
    excerpt,
    selected,
    onSelect,
    onOpen,
    onRefresh,
    onError,
}: CardProps) {
    const folder = isFolderKind(meta.kind);
    const cardTitle = meta.card_title || meta.title;
    const [title, setTitle] = useState(cardTitle);
    const [body, setBody] = useState(meta.synopsis);
    const editingTitle = useRef(false);
    const editingBody = useRef(false);
    const saveTimer = useRef<number | null>(null);
    const pendingBody = useRef<string | null>(null);

    // Follow outside changes (binder rename, inspector synopsis) unless the
    // user is editing that field right now.
    useEffect(() => {
        if (!editingTitle.current) setTitle(cardTitle);
    }, [cardTitle]);
    useEffect(() => {
        if (!editingBody.current) setBody(meta.synopsis);
    }, [meta.synopsis]);

    const flushBody = useCallback(() => {
        if (saveTimer.current !== null) {
            window.clearTimeout(saveTimer.current);
            saveTimer.current = null;
        }
        const text = pendingBody.current;
        if (text === null) return Promise.resolve();
        pendingBody.current = null;
        return api.updateDocument({ id: meta.id, synopsis: text })
            .then(() => undefined)
            .catch((e) => onError(String(e)));
    }, [meta.id, onError]);

    // Save anything pending if the card goes away (folder switch, etc.).
    useEffect(() => () => {
        void flushBody();
    }, [flushBody]);

    // Saves the card's own title; the document title is never touched.
    // Clearing the field goes back to showing the document title.
    function commitTitle() {
        editingTitle.current = false;
        const t = title.trim();
        if (t === cardTitle) return;
        const stored = t === meta.title ? "" : t;
        if (!t) setTitle(meta.title);
        api.updateDocument({ id: meta.id, card_title: stored })
            .then(() => onRefresh())
            .catch((e) => onError(String(e)));
    }

    // No synopsis yet: the body shows the document's text as a starting point.
    const showingExcerpt = !body && !folder;
    const bodyValue = showingExcerpt ? excerpt : body;

    return (
        <div
            className={`cork-card${selected ? " selected" : ""}${folder ? " folder" : ""}`}
            onMouseDown={onSelect}
        >
            <div className="cork-card-head" onDoubleClick={onOpen} title="Double-click to open">
                <span className="cork-card-icon">
                    {isKnownIcon(meta.icon) ? (
                        <DocIcon id={meta.icon} size={15} />
                    ) : folder ? (
                        <IconFolder size={14} />
                    ) : (
                        <IconDocument size={14} />
                    )}
                </span>
                <input
                    className="cork-card-title"
                    value={title}
                    spellCheck={false}
                    onFocus={() => {
                        editingTitle.current = true;
                    }}
                    onChange={(e) => setTitle(e.target.value)}
                    onBlur={commitTitle}
                    onKeyDown={(e) => {
                        if (e.key === "Enter") {
                            e.preventDefault();
                            (e.target as HTMLInputElement).blur();
                        } else if (e.key === "Escape") {
                            e.preventDefault();
                            setTitle(cardTitle);
                            editingTitle.current = false;
                            (e.target as HTMLInputElement).blur();
                        }
                    }}
                    onDoubleClick={(e) => e.stopPropagation()}
                />
                <button
                    type="button"
                    className="cork-card-open"
                    title={folder ? "Open folder" : "Open document"}
                    onClick={onOpen}
                >
                    <IconOpen size={13} />
                </button>
            </div>
            <textarea
                className={`cork-card-body${showingExcerpt ? " excerpt" : ""}`}
                value={bodyValue}
                placeholder={folder ? "Folder synopsis…" : "Write a synopsis…"}
                onFocus={() => {
                    editingBody.current = true;
                }}
                onChange={(e) => {
                    const text = e.target.value;
                    setBody(text);
                    pendingBody.current = text;
                    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
                    saveTimer.current = window.setTimeout(() => void flushBody(), SAVE_DELAY_MS);
                }}
                onBlur={() => {
                    editingBody.current = false;
                    const hadPending = pendingBody.current !== null;
                    void flushBody().then(() => {
                        // Refresh the binder so the inspector & cards agree.
                        if (hadPending) onRefresh();
                    });
                }}
            />
            {!folder && meta.word_count > 0 && (
                <div className="cork-card-foot">{meta.word_count.toLocaleString()} words</div>
            )}
        </div>
    );
}
