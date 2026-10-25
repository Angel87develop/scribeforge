/// Image attachments shown in the Inspector's Notes tab.
///
/// Features:
/// - Click the image icon (top-right) to open a native file picker.
/// - Drag-and-drop image files directly onto the drop zone.
/// - Each attached image renders below the notes textarea at its display size.
/// - Drag the bottom-right handle to resize (aspect ratio preserved).
/// - Right-click any image for a context menu: Delete, Fit to container,
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

interface Props {
    documentId: string;
    onError: (msg: string) => void;
}

export function ImageAttachments({ documentId, onError }: Props) {
    const [attachments, setAttachments] = useState<ImageAttachmentDto[]>([]);
    const [dragOver, setDragOver] = useState(false);
    const [fullView, setFullView] = useState<ImageAttachmentDto | null>(null);
    const [menu, setMenu] = useState<{ x: number; y: number; att: ImageAttachmentDto } | null>(null);
    const [busy, setBusy] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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

    function readFileAsDataUrl(file: File): Promise<string> {
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
            if (!file.type.startsWith("image/")) {
                onError(`"${file.name}" is not an image (got ${file.type || "unknown type"}).`);
                continue;
            }
            try {
                const dataUrl = await readFileAsDataUrl(file);
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
        setDragOver(true);
    }

    function onDragLeave(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
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

    async function handleFit(att: ImageAttachmentDto) {
        try {
            const dto = await api.resizeImageAttachment(
                documentId,
                att.id,
                240,
                180,
            );
            setAttachments((prev) => prev.map((a) => (a.id === att.id ? dto : a)));
        } catch (e) {
            onError(String(e));
        }
    }

    async function handleDownload(att: ImageAttachmentDto) {
        try {
            const saved = await api.exportImageAttachment(att.id);
            if (saved) {
                onError(`Image saved to ${saved}`);
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
            onError("Image copied to clipboard.");
        } catch {
            onError("Copy failed — clipboard access was denied.");
        }
    }

    function handleResize(
        att: ImageAttachmentDto,
        naturalWidth: number,
        naturalHeight: number,
    ) {
        const aspect = naturalWidth / naturalHeight;
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
            className={`img-att-root${dragOver ? " drag-over" : ""}`}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
        >
            <div className="img-att-header">
                <span className="img-att-label">Images</span>
                <button
                    className="img-att-add-btn"
                    title="Add image from file"
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
                    <span>Drop images here</span>
                </div>
            )}
            {attachments.length === 0 && !dragOver && (
                <div className="img-att-empty">
                    No images. Click the icon above or drag an image file here.
                </div>
            )}
            <div className="img-att-list">
                {attachments.map((att) => (
                    <ImageItem
                        key={att.id}
                        att={att}
                        onDelete={() => handleDelete(att)}
                        onFullView={() => setFullView(att)}
                        onContextMenu={(x, y) => setMenu({ x, y, att })}
                        onResize={handleResize(att, att.display_width, att.display_height)}
                    />
                ))}
            </div>
            {busy && <div className="img-att-busy">Processing…</div>}
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

// ---------------------------------------------------------------------------
// Image item with resize handle
// ---------------------------------------------------------------------------

function ImageItem({
    att,
    onDelete,
    onFullView,
    onContextMenu,
    onResize,
}: {
    att: ImageAttachmentDto;
    onDelete: () => void;
    onFullView: () => void;
    onContextMenu: (x: number, y: number) => void;
    onResize: (newWidth: number) => Promise<void>;
}) {
    const [natural, setNatural] = useState({ w: 0, h: 0 });

    function startResize(e: React.MouseEvent) {
        e.preventDefault();
        e.stopPropagation();
        if (natural.w === 0) return;
        const startX = e.clientX;
        const startW = att.display_width;
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
                <button className="img-att-item-del" title="Delete image" onClick={onDelete}>
                    <IconClose size={13} />
                </button>
            </div>
            <div
                className="img-att-item-img-wrap"
                style={{ width: att.display_width, height: att.display_height }}
            >
                <img
                    src={att.data_url}
                    alt={att.filename}
                    className="img-att-item-img"
                    onLoad={(e) => {
                        const img = e.currentTarget;
                        setNatural({ w: img.naturalWidth, h: img.naturalHeight });
                    }}
                    onDoubleClick={onFullView}
                    draggable={false}
                />
                <div
                    className="img-att-resize-handle"
                    onMouseDown={startResize}
                    title="Drag to resize"
                />
            </div>
            <div className="img-att-item-meta">
                {att.display_width}×{att.display_height}
                {natural.w > 0 && <span className="dim"> · {natural.w}×{natural.h} original</span>}
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
                <IconExpand size={14} /> Full view
            </button>
            <button className="img-ctx-item" onClick={onFit}>
                <IconImage size={14} /> Fit to size
            </button>
            <button className="img-ctx-item" onClick={onDownload}>
                <IconDownload size={14} /> Download…
            </button>
            <button className="img-ctx-item" onClick={onCopy}>
                <IconChevronDown size={14} /> Copy
            </button>
            <div className="img-ctx-sep" />
            <button className="img-ctx-item danger" onClick={onDelete}>
                <IconTrash size={14} /> Delete
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
                        <button className="img-fullview-btn" onClick={onDownload} title="Download">
                            <IconDownload size={16} />
                        </button>
                        <button className="img-fullview-btn" onClick={onClose} title="Close (Esc)">
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