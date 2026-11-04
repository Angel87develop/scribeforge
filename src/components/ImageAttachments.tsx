/// Image attachments shown in the Inspector's Notes tab.
///
/// Features:
/// - Click the image icon (top-right) to open a native file picker.
/// - Drag-and-drop image files directly onto the drop zone.
/// - Each attached image renders below the notes textarea. With "Fit" on
///   (the default) images fill the panel width, never taller than the visible
///   panel, and follow the panel as it is resized. With "Fit" off each image
///   keeps the size it was given, shrunk only when the panel is narrower.
/// - With "Fit" off, drag the bottom-right handle to resize (aspect ratio
///   preserved).
/// - Right-click any image for a context menu: Delete, Fit to panel width,
///   Full view, Download, Copy.
/// - All attachments persist inside the `.scri` project file.

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type ImageAttachmentDto } from "../services/api";
import {
    IconChevronDown,
    IconClose,
    IconDownload,
    IconExpand,
    IconImage,
    IconTrash,
} from "./Icons";
import "../styles/image-attachments.css";
import { t } from "../i18n";

interface Props {
    documentId: string;
    onError: (msg: string) => void;
    /** The images have the Notes tab to themselves (notes text folded away). */
    expanded?: boolean;
}

/** Whether images are fitted to the panel ("1", the default) or keep their own size. */
const FIT_KEY = "sf.images.fit";
/** Fitted images are never enlarged beyond this multiple of their real size. */
const MAX_UPSCALE = 2;
/** Room kept under a fitted image for its name and size lines. */
const ITEM_CHROME = 64;

type Size = { w: number; h: number };

export function ImageAttachments({ documentId, onError, expanded = false }: Props) {
    const [attachments, setAttachments] = useState<ImageAttachmentDto[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [fullView, setFullView] = useState<ImageAttachmentDto | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; att: ImageAttachmentDto } | null>(null);
    const [busy, setBusy] = useState(false);
    const [fit, setFit] = useState(() => localStorage.getItem(FIT_KEY) !== "0");
    const [naturals, setNaturals] = useState<Record<string, Size>>({});
    // Room available to one image: the list width and the visible panel height.
    const [room, setRoom] = useState<Size>({ w: 0, h: 0 });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    // Follow the panel size, so images adjust while the Inspector is resized
    // or the notes are folded.
    useEffect(() => {
        const list = listRef.current;
        if (!list) return;
        const scroller = list.closest<HTMLElement>(".inspector-body");
        const measure = () => {
            let h = Infinity;
            if (scroller) {
                const cs = getComputedStyle(scroller);
                h = scroller.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - ITEM_CHROME;
            }
            setRoom({ w: list.clientWidth, h: Math.max(80, h) });
        };
        measure();
        const ro = new ResizeObserver(measure);
        ro.observe(list);
        if (scroller) ro.observe(scroller);
        return () => ro.disconnect();
    }, []);

    // Load attachments when the document changes.
    const refresh = useCallback(() => {
        if (!documentId) {
            setAttachments([]);
            return;
        }
        api.listImageAttachments(documentId)
            .then(setAttachments)
            .catch((e) => onError(String(e)));
    }, [documentId, onError]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    // Prevent the browser's default behaviour of navigating to a dropped file
    // anywhere in the window while this component is mounted.
    useEffect(() => {
        const stop = (e: DragEvent) => {
            e.preventDefault();
        };
        window.addEventListener("dragover", stop);
        window.addEventListener("drop", stop);
        return () => {
            window.removeEventListener("dragover", stop);
            window.removeEventListener("drop", stop);
        };
    }, []);

    // Close context menu on any click.
    useEffect(() => {
        if (!menu) return;
        const close = () => setMenu(null);
        window.addEventListener("click", close);
        return () => window.removeEventListener("click", close);
    }, [menu]);

    // ---- Adding images ----

    function readFileAsDataUrl(file: Blob): Promise<string> {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    async function handleFiles(files: FileList | null) {
        if (!files || files.length === 0) return;
        setBusy(true);
        for (const file of Array.from(files)) {
            const type = imageType(file);
            if (!type) {
                onError(t("“{name}” is not an image (got {type}).", { name: file.name, type: file.type || t("unknown type") }));
                continue;
            }
            try {
                // Files dropped from the system sometimes arrive without a type.
                const blob = file.type === type ? file : new Blob([file], { type });
                const dataUrl = await readFileAsDataUrl(blob);
                const dto = await api.addImageAttachment(documentId, dataUrl, file.name);
                setAttachments((prev) => [...prev, dto]);
            } catch (e) {
                onError(String(e));
            }
        }
        setBusy(false);
    }

    function onPickFile() {
        fileInputRef.current?.click();
    }

    function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
        handleFiles(e.target.files);
        // Reset so the same file can be picked again.
        e.target.value = "";
    }

    function onDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
        handleFiles(e.dataTransfer.files);
    }

    function onDragOver(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "copy";
        setDragOver(true);
    }

    function onDragLeave(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        // Moving over a child element also fires dragleave; only a real exit counts.
        if (e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget)) return;
        setDragOver(false);
    }

    // ---- Attachment actions ----

    async function handleDelete(att: ImageAttachmentDto) {
        try {
            await api.removeImageAttachment(documentId, att.id);
            setAttachments((prev) => prev.filter((a) => a.id !== att.id));
        } catch (e) {
            onError(String(e));
        }
    }

    function toggleFit() {
        setFit((on) => {
            localStorage.setItem(FIT_KEY, on ? "0" : "1");
            return !on;
        });
    }

    /// Give the image the panel width as its own size (aspect ratio kept).
    async function handleFit(att: ImageAttachmentDto) {
        const n = naturals[att.id] ?? { w: att.display_width, h: att.display_height };
        if (!room.w || !n.w || !n.h) return;
        const w = Math.max(40, Math.min(800, Math.floor(room.w)));
        const h = Math.round((w * n.h) / n.w);
        try {
            const dto = await api.resizeImageAttachment(documentId, att.id, w, h);
            setAttachments((prev) => prev.map((a) => (a.id === att.id ? dto : a)));
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleDownload(att: ImageAttachmentDto) {
        try {
            const saved = await api.exportImageAttachment(att.id);
            if (saved) {
                onError(t("Image saved to {path}", { path: saved }));
            }
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleCopy(att: ImageAttachmentDto) {
        try {
            const resp = await fetch(att.data_url);
            const blob = await resp.blob();
            const item = new ClipboardItem({ [blob.type]: blob });
            await navigator.clipboard.write([item]);
            onError(t("Image copied to clipboard."));
        } catch {
            onError(t("Copy failed — clipboard access was denied."));
        }
    }

    function handleResize(att: ImageAttachmentDto) {
        const n = naturals[att.id];
        const aspect = n && n.h ? n.w / n.h : att.display_width / att.display_height;
        return async (newWidth: number) => {
            const w = Math.max(40, Math.min(800, Math.round(newWidth)));
            const h = Math.round(w / aspect);
            setAttachments((prev) =>
                prev.map((a) =>
                    a.id === att.id ? { ...a, display_width: w, display_height: h } : a,
                ),
            );
            try {
                const dto = await api.resizeImageAttachment(documentId, att.id, w, h);
                setAttachments((prev) =>
                    prev.map((a) => (a.id === att.id ? dto : a)),
                );
            } catch (e) {
                onError(String(e));
            }
        };
    }

    // ---- Render ----

    return (
        <div
            className={`img-att-root${dragOver ? " drag-over" : ""}${expanded ? " expanded" : ""}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
        >
            <div className="img-att-header">
                <span className="img-att-label">{t("Images")}</span>
                <button
                    className={`img-att-fit-btn${fit ? " active" : ""}`}
                    aria-pressed={fit}
                    title={
                        fit
                            ? t("Images fit the panel. Click to give each image its own size.")
                            : t("Fit images to the panel")
                    }
                    onClick={toggleFit}
                >
                    <IconExpand size={13} /> {t("Fit")}
                </button>
                <button
                    className="img-att-add-btn"
                    title={t("Add image from file")}
                    onClick={onPickFile}
                    disabled={busy}
                >
                    <IconImage size={16} />
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/gif,image/webp,image/bmp,image/svg+xml"
                    multiple
                    style={{ display: "none" }}
                    onChange={onFileInputChange}
                />
            </div>
            {dragOver && (
                <div className="img-att-drop-zone">
                    <IconImage size={28} />
                    <span>{t("Drop images here")}</span>
                </div>
            )}
            {attachments.length === 0 && !dragOver && (
                <div className="img-att-empty">
                    {t("No images. Click the icon above or drag an image file here.")}
                </div>
            )}
            <div className="img-att-list" ref={listRef}>
                {attachments.map((att) => (
                    <ImageItem
                        key={att.id}
                        att={att}
                        natural={naturals[att.id] ?? null}
                        size={shownSize(att, naturals[att.id], room, fit)}
                        resizable={!fit}
                        onLoaded={(n) =>
                            setNaturals((prev) =>
                                prev[att.id]?.w === n.w && prev[att.id]?.h === n.h ? prev : { ...prev, [att.id]: n },
                            )
                        }
                        onDelete={() => handleDelete(att)}
                        onFullView={() => setFullView(att)}
                        onContextMenu={(x, y) => setMenu({ x, y, att })}
                        onResize={handleResize(att)}
                    />
                ))}
            </div>
            {busy && <div className="img-att-busy">{t("Processing…")}</div>}
            {fullView && (
                <FullViewModal
                    att={fullView}
                    onClose={() => setFullView(null)}
                    onDownload={() => handleDownload(fullView)}
                />
            )}
            {menu && (
                <ImageContextMenu
                    x={menu.x}
                    y={menu.y}
                    onDelete={() => {
                        handleDelete(menu.att);
                        setMenu(null);
                    }}
                    onFit={() => {
                        handleFit(menu.att);
                        setMenu(null);
                    }}
                    onFullView={() => {
                        setFullView(menu.att);
                        setMenu(null);
                    }}
                    onDownload={() => {
                        handleDownload(menu.att);
                        setMenu(null);
                    }}
                    onCopy={() => {
                        handleCopy(menu.att);
                        setMenu(null);
                    }}
                />
            )}
        </div>
    );
}

const EXTENSION_TYPES: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
};

/// The image type of a file, from its type or else its extension; null when
/// it is not an image.
function imageType(file: File): string | null {
    if (file.type.startsWith("image/")) return file.type;
    if (file.type) return null;
    const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
    return EXTENSION_TYPES[ext] ?? null;
}

/// Size an image is drawn at. Fitted: as wide as the panel and no taller
/// than the visible panel, at most MAX_UPSCALE times its real size. Not
/// fitted: its own size, shrunk to the panel width when the panel is narrower.
function shownSize(att: ImageAttachmentDto, natural: Size | undefined, room: Size, fit: boolean): Size {
    const own = { w: att.display_width, h: att.display_height };
    if (!room.w) return own;
    if (fit && natural && natural.w && natural.h) {
        const scale = Math.min(room.w / natural.w, room.h / natural.h, MAX_UPSCALE);
        return { w: Math.round(natural.w * scale), h: Math.round(natural.h * scale) };
    }
    if (own.w > room.w) {
        return { w: Math.floor(room.w), h: Math.round((own.h * room.w) / own.w) };
    }
    return own;
}

// ---------------------------------------------------------------------------
// Image item with resize handle
// ---------------------------------------------------------------------------

function ImageItem({
    att,
    natural,
    size,
    resizable,
    onLoaded,
    onDelete,
    onFullView,
    onContextMenu,
    onResize,
}: {
    att: ImageAttachmentDto;
    natural: Size | null;
    size: Size;
    resizable: boolean;
    onLoaded: (natural: Size) => void;
    onDelete: () => void;
    onFullView: () => void;
    onContextMenu: (x: number, y: number) => void;
    onResize: (newWidth: number) => Promise<void>;
}) {
    function startResize(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (!natural) return;
        const startX = e.clientX;
        const startW = size.w;
        const onMove = (ev: MouseEvent) => {
            const dx = ev.clientX - startX;
            onResize(startW + dx);
        };
        const onUp = () => {
            document.removeEventListener("mousemove", onMove);
            document.removeEventListener("mouseup", onUp);
        };
        document.addEventListener("mousemove", onMove);
        document.addEventListener("mouseup", onUp);
    }

    return (
        <div
            className="img-att-item"
            onContextMenu={(e) => {
                e.preventDefault();
                onContextMenu(e.clientX, e.clientY);
            }}
        >
            <div className="img-att-item-header">
                <span className="img-att-item-name" title={att.filename}>
                    {att.filename}
                </span>
                <button className="img-att-item-del" title={t("Delete image")} onClick={onDelete}>
                    <IconClose size={13} />
                </button>
            </div>
            <div
                className="img-att-item-img-wrap"
                style={{ width: size.w, height: size.h }}
            >
                <img
                    src={att.data_url}
                    alt={att.filename}
                    className="img-att-item-img"
                    onLoad={(e) => {
                        const img = e.currentTarget;
                        onLoaded({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                    onDoubleClick={onFullView}
                    draggable={false}
                />
                {resizable && (
                    <div
                        className="img-att-resize-handle"
                        onMouseDown={startResize}
                        title={t("Drag to resize")}
                    />
                )}
            </div>
            <div className="img-att-item-meta">
                {size.w}×{size.h}
                {natural && (
                    <span className="dim"> · {t("{w}×{h} original", { w: natural.w, h: natural.h })}</span>
                )}
            </div>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Context menu
// ---------------------------------------------------------------------------

function ImageContextMenu({
    x,
    y,
    onDelete,
    onFit,
    onFullView,
    onDownload,
    onCopy,
}: {
    x: number;
    y: number;
    onDelete: () => void;
    onFit: () => void;
    onFullView: () => void;
    onDownload: () => void;
    onCopy: () => void;
}) {
    const left = Math.min(x, window.innerWidth - 220);
    const top = Math.min(y, window.innerHeight - 180);
    return (
        <div className="img-ctx-menu" style={{ left, top }}>
            <button className="img-ctx-item" onClick={onFullView}>
                <IconExpand size={14} /> {t("Full view")}
            </button>
            <button className="img-ctx-item" onClick={onFit}>
                <IconImage size={14} /> {t("Fit to panel width")}
            </button>
            <button className="img-ctx-item" onClick={onDownload}>
                <IconDownload size={14} /> {t("Download…")}
            </button>
            <button className="img-ctx-item" onClick={onCopy}>
                <IconChevronDown size={14} /> {t("Copy")}
            </button>
            <div className="img-ctx-sep" />
            <button className="img-ctx-item danger" onClick={onDelete}>
                <IconTrash size={14} /> {t("Delete")}
            </button>
        </div>
    );
}

// ---------------------------------------------------------------------------
// Full view modal
// ---------------------------------------------------------------------------

function FullViewModal({
    att,
    onClose,
    onDownload,
}: {
    att: ImageAttachmentDto;
    onClose: () => void;
    onDownload: () => void;
}) {
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.stopPropagation();
                onClose();
            }
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [onClose]);

    return (
        <div className="img-fullview-overlay" onClick={onClose}>
            <div className="img-fullview-panel" onClick={(e) => e.stopPropagation()}>
                <div className="img-fullview-header">
                    <span className="img-fullview-title">{att.filename}</span>
                    <div className="img-fullview-actions">
                        <button className="img-fullview-btn" onClick={onDownload} title={t("Download")}>
                            <IconDownload size={16} />
                        </button>
                        <button className="img-fullview-btn" onClick={onClose} title={t("Close (Esc)")}>
                            <IconClose size={16} />
                        </button>
                    </div>
                </div>
                <div className="img-fullview-body">
                    <img src={att.data_url} alt={att.filename} />
                </div>
            </div>
        </div>
    );
}