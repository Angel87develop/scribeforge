/// Scrivenings: every document under a folder (or a document and its
/// subdocuments) edited one after another in a single scrolling view.
///
/// Each document keeps its own Tiptap editor and saves on its own, exactly as
/// in the single-document view; the sections are only stacked visually, with
/// a separator carrying the document title. Folder rows become section
/// headings.
///
/// The shared format bar follows the section that has focus: whichever
/// editor was focused last is registered as the pane's editor API. Its
/// `flush` flushes every section, so Save never loses pending edits.
///
/// Documents listed in `lockedIds` (open for editing in the other split pane)
/// are shown read-only to avoid two editors overwriting each other.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type DocumentDto, type DocumentMetaDto, type RichDoc } from "../services/api";
import { descendants, displayTitle, isFolderKind } from "./binderTree";
import { RichTextEditor, type EditorApi, type FormatState } from "./RichTextEditor";
import { IconFolder, IconOpen } from "./Icons";
import "../styles/outliner.css";
import { t } from "../i18n";

interface Props {
    rootId: string;
    binder: DocumentMetaDto[];
    paneKey: string;
    /** Also show the root itself first (a document with subdocuments). */
    includeRoot?: boolean;
    /** Documents that must be read-only here. */
    lockedIds?: ReadonlySet<string>;
    /** Hide the per-section titles (composition mode). */
    plain?: boolean;
    onContentChanged: (id: string, doc: RichDoc, wordCount: number) => void;
    onOpenDocument?: (id: string, kind: string) => void;
    registerEditorApi?: (paneKey: string, api: EditorApi | null) => void;
    onFormatChange?: (paneKey: string, format: FormatState | null) => void;
    onPaneFocused?: (paneKey: string) => void;
    /** Reports the ids of the documents shown here. */
    onDisplayedIds?: (ids: string[]) => void;
    onError: (msg: string) => void;
}

interface Section {
    meta: DocumentMetaDto;
    depth: number;
    folder: boolean;
}

export function Scrivenings({
    rootId,
    binder,
    paneKey,
    includeRoot = false,
    lockedIds,
    plain = false,
    onContentChanged,
    onOpenDocument,
    registerEditorApi,
    onFormatChange,
    onPaneFocused,
    onDisplayedIds,
    onError,
}: Props) {
    const sections = useMemo<Section[]>(() => {
        const out: Section[] = [];
        const root = binder.find((d) => d.id === rootId);
        if (includeRoot && root && !isFolderKind(root.kind)) {
            out.push({ meta: root, depth: 0, folder: false });
        }
        for (const row of descendants(binder, rootId)) {
            out.push({ meta: row.meta, depth: row.depth + (includeRoot ? 1 : 0), folder: isFolderKind(row.meta.kind) });
        }
        return out;
    }, [binder, rootId, includeRoot]);

    const docIds = useMemo(() => sections.filter((s) => !s.folder).map((s) => s.meta.id), [sections]);
    const idsKey = docIds.join(",");

    useEffect(() => {
        onDisplayedIds?.(docIds);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);
    useEffect(() => () => onDisplayedIds?.([]), [onDisplayedIds]);

    // Load each document's content once; sections that are already loaded
    // keep their editor (and its undo history) when the list changes.
    const [docs, setDocs] = useState<Record<string, DocumentDto>>({});
    const docsRef = useRef(docs);
    docsRef.current = docs;
    useEffect(() => {
        const missing = docIds.filter((id) => !docsRef.current[id]);
        if (missing.length === 0) return;
        let cancelled = false;
        Promise.all(missing.map((id) => api.getDocument(id)))
            .then((loaded) => {
                if (cancelled) return;
                setDocs((prev) => {
                    const next = { ...prev };
                    for (const d of loaded) next[d.id] = d;
                    return next;
                });
            })
            .catch((e) => onError(String(e)));
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    // Editor APIs per section; the focused one drives the format bar.
    const apisRef = useRef<Map<string, EditorApi>>(new Map());
    const activeRef = useRef<string | null>(null);

    const publishActive = useCallback(() => {
        const id = activeRef.current;
        const active = id ? apisRef.current.get(id) : undefined;
        if (!active) return;
        registerEditorApi?.(paneKey, {
            ...active,
            flush: () => apisRef.current.forEach((a) => a.flush()),
        });
    }, [paneKey, registerEditorApi]);

    useEffect(() => {
        return () => {
            registerEditorApi?.(paneKey, null);
            onFormatChange?.(paneKey, null);
        };
    }, [paneKey, registerEditorApi, onFormatChange]);

    const editors = sections.map((s) => {
        if (s.folder) {
            if (plain) return null;
            return (
                <div key={s.meta.id} className="scriv-folder" style={{ paddingLeft: 32 + s.depth * 12 }}>
                    <IconFolder size={14} />
                    <span>{displayTitle(s.meta)}</span>
                </div>
            );
        }
        const doc = docs[s.meta.id];
        const locked = lockedIds?.has(s.meta.id) ?? false;
        return (
            <div key={s.meta.id} className={`scriv-section${locked ? " locked" : ""}`}>
                {!plain && (
                    <div className="scriv-separator">
                        <span className="scriv-separator-line" />
                        <button
                            type="button"
                            className="scriv-separator-title"
                            title={t("Open this document on its own")}
                            onClick={() => onOpenDocument?.(s.meta.id, s.meta.kind)}
                        >
                            {displayTitle(s.meta)}
                            <IconOpen size={12} />
                        </button>
                        {locked && <span className="scriv-locked">{t("read-only, open in the other pane")}</span>}
                        <span className="scriv-separator-line" />
                    </div>
                )}
                {doc ? (
                    <RichTextEditor
                        initialContent={doc.content}
                        editable={!locked}
                        paneId={paneKey}
                        onContentChanged={(rich, words) => onContentChanged(s.meta.id, rich, words)}
                        registerApi={(a) => {
                            apisRef.current.set(s.meta.id, a);
                            if (activeRef.current === null) {
                                activeRef.current = s.meta.id;
                                publishActive();
                            }
                        }}
                        registerFormatState={(f) => {
                            if (activeRef.current === s.meta.id) onFormatChange?.(paneKey, f);
                        }}
                        onFocused={() => {
                            activeRef.current = s.meta.id;
                            publishActive();
                            onPaneFocused?.(paneKey);
                        }}
                    />
                ) : (
                    <div className="scriv-loading">{t("Loading…")}</div>
                )}
            </div>
        );
    });

    // Forget editors of sections that disappeared.
    useEffect(() => {
        const keep = new Set(docIds);
        for (const id of [...apisRef.current.keys()]) {
            if (!keep.has(id)) apisRef.current.delete(id);
        }
        if (activeRef.current && !keep.has(activeRef.current)) {
            activeRef.current = docIds.find((id) => apisRef.current.has(id)) ?? null;
            publishActive();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [idsKey]);

    if (docIds.length === 0) {
        return (
            <div className="editor-pane-empty">
                {t("There are no documents here yet. Add some in the binder or on the corkboard.")}
            </div>
        );
    }

    return <div className={`scriv-root${plain ? " plain" : ""}`}>{editors}</div>;
}
