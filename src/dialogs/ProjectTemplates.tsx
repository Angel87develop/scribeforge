/// Project Templates selector — the first-run and new-project window.
///
/// Layout: left category sidebar, centre template grid, right preview pane,
/// bottom action bar (Open Recent, Open Existing File, Cancel, Open).

import { useEffect, useMemo, useState } from "react";
import { api, type CategoryDto, type TemplatePreview } from "../services/api";
import { categoryIcon } from "../templates/categoryIcons";
import {
    IconBook,
    IconClock,
    IconClose,
    IconDocument,
    IconOpen,
    IconPlus,
} from "../components/Icons";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { RecentProjectsDialog } from "./RecentProjectsDialog";
import "../styles/templates.css";

type Status = { kind: "idle" } | { kind: "busy"; message: string } | { kind: "error"; message: string } | { kind: "success"; message: string };

interface Props {
    onProjectOpened: () => void;
    onCancel: () => void;
}

export function ProjectTemplates({ onProjectOpened, onCancel }: Props) {
    const [categories, setCategories] = useState<CategoryDto[]>([]);
    const [activeCategory, setActiveCategory] = useState("getting-started");
    const [templates, setTemplates] = useState<TemplatePreview[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<TemplatePreview | null>(null);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const [overlay, setOverlay] = useState<null | "recent" | "create">(null);
    const [defaultDir, setDefaultDir] = useState("");

    // Load categories on mount.
    useEffect(() => {
        api.listCategories().then(setCategories).catch((e) => {
            setStatus({ kind: "error", message: `Failed to load categories: ${e}` });
        });
    }, []);

    // Load templates whenever the active category changes.
    useEffect(() => {
        setStatus({ kind: "idle" });
        setSelectedTemplate(null);
        api.listTemplates(activeCategory)
            .then(setTemplates)
            .catch((e) => {
                setTemplates([]);
                setStatus({ kind: "error", message: `Failed to load templates: ${e}` });
            });
    }, [activeCategory]);

    // Resolve a sensible default project directory (Documents/ScribeForge).
    useEffect(() => {
        api.getDefaultProjectDir()
            .then(setDefaultDir)
            .catch(() => setDefaultDir(""));
    }, []);

    const activeCat = useMemo(
        () => categories.find((c) => c.id === activeCategory),
        [categories, activeCategory],
    );

    const handleOpen = () => {
        if (!selectedTemplate) {
            setStatus({ kind: "error", message: "Select a template first." });
            return;
        }
        setOverlay("create");
    };

    const handleOpenExisting = async () => {
        setStatus({ kind: "busy", message: "Opening file dialog…" });
        try {
            const result = await api.openExistingFileDialog();
            if (result) {
                setStatus({ kind: "success", message: `Opened ${result.manifest.name}` });
                onProjectOpened();
            } else {
                setStatus({ kind: "idle" });
            }
        } catch (e) {
            setStatus({ kind: "error", message: `Failed to open project: ${e}` });
        }
    };

    const handleOpenRecentPath = async (path: string) => {
        setStatus({ kind: "busy", message: "Opening project…" });
        setOverlay(null);
        try {
            const result = await api.openProjectAtPath(path);
            setStatus({ kind: "success", message: `Opened ${result.manifest.name}` });
            onProjectOpened();
        } catch (e) {
            setStatus({ kind: "error", message: `Failed to open project: ${e}` });
        }
    };

    const handleCreated = () => {
        setOverlay(null);
        setStatus({ kind: "success", message: "Project created." });
        onProjectOpened();
    };

    const selectedIcon = selectedTemplate ? categoryIcon(selectedTemplate.category) : IconDocument;

    return (
        <div className="templates-root">
            {/* Banner */}
            <div className="templates-banner">
                <div className="templates-banner-icon">
                    <IconBook size={22} />
                </div>
                <div>
                    <div className="templates-banner-title">ScribeForge</div>
                    <div className="templates-banner-subtitle">Project Templates</div>
                </div>
            </div>

            {/* Body */}
            <div className="templates-body">
                {/* Sidebar */}
                <div className="templates-sidebar">
                    {categories.map((cat) => {
                        const Icon = categoryIcon(cat.id);
                        const count = cat.id === activeCategory ? templates.length : null;
                        return (
                            <div
                                key={cat.id}
                                className={`category-item${cat.id === activeCategory ? " active" : ""}`}
                                onClick={() => setActiveCategory(cat.id)}
                                title={cat.description}
                            >
                                <Icon size={15} className="cat-icon" />
                                <span>{cat.label}</span>
                                {count !== null && <span className="cat-count">{count}</span>}
                            </div>
                        );
                    })}
                </div>

                {/* Centre: template grid */}
                <div className="templates-center">
                    <div className="templates-center-header">
                        <div className="templates-center-title">
                            {activeCat ? activeCat.label : "Templates"}
                        </div>
                        {activeCat && (
                            <div className="templates-center-desc">{activeCat.description}</div>
                        )}
                    </div>
                    <div className="templates-grid-scroll">
                        {templates.length === 0 ? (
                            <div
                                style={{
                                    color: "var(--text-muted)",
                                    fontSize: "var(--font-size-sm)",
                                    fontStyle: "italic",
                                    padding: "20px",
                                }}
                            >
                                No templates in this category.
                            </div>
                        ) : (
                            <div className="templates-grid">
                                {templates.map((tpl) => {
                                    const Icon = categoryIcon(tpl.category);
                                    const isSelected = selectedTemplate?.id === tpl.id;
                                    return (
                                        <div
                                            key={tpl.id}
                                            className={`template-card${isSelected ? " selected" : ""}`}
                                            onClick={() => setSelectedTemplate(tpl)}
                                            onDoubleClick={() => {
                                                setSelectedTemplate(tpl);
                                                setOverlay("create");
                                            }}
                                        >
                                            <div className="template-card-icon">
                                                <Icon size={18} />
                                            </div>
                                            <div className="template-card-name">{tpl.name}</div>
                                            <div className="template-card-desc">{tpl.description}</div>
                                            <div className={`template-card-badge${tpl.has_starter_content ? "" : " empty"}`}>
                                                <span className="dot" />
                                                {tpl.has_starter_content ? "Includes sample content" : "Empty"}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right: preview pane */}
                <div className="templates-preview">
                    {selectedTemplate ? (
                        <>
                            <div className="templates-preview-header">
                                <div className="templates-preview-icon">
                                    {(() => {
                                        const Icon = selectedIcon;
                                        return <Icon size={24} />;
                                    })()}
                                </div>
                                <div>
                                    <div className="templates-preview-name">{selectedTemplate.name}</div>
                                    <div className="templates-preview-category">
                                        {selectedTemplate.category.replace(/-/g, " ")}
                                    </div>
                                </div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">Description</div>
                                <div className="templates-preview-text">{selectedTemplate.description}</div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">Preview</div>
                                <div className="templates-preview-text">{selectedTemplate.preview}</div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">Starter Content</div>
                                <div className="templates-preview-text">
                                    {selectedTemplate.has_starter_content
                                        ? "This template creates sample documents you can edit or delete."
                                        : "This template creates an empty project structure."}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="templates-preview-empty">
                            Select a template to see its preview.
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom action bar */}
            <div className="templates-actions">
                <div className="btn-group">
                    <button onClick={() => setOverlay("recent")}>
                        <IconClock size={15} /> Open Recent
                    </button>
                    <button onClick={handleOpenExisting}>
                        <IconOpen size={15} /> Open Existing File
                    </button>
                </div>
                <div className="spacer" />
                <button onClick={onCancel}>
                    <IconClose size={15} /> Cancel
                </button>
                <button
                    className="primary"
                    disabled={!selectedTemplate || status.kind === "busy"}
                    onClick={handleOpen}
                >
                    <IconPlus size={15} /> Open
                </button>
            </div>

            {/* Status bar */}
            <div className="status-bar">
                {status.kind === "busy" && (
                    <>
                        <div className="spinner" />
                        <span className="status-message">{status.message}</span>
                    </>
                )}
                {status.kind === "error" && (
                    <span className="status-message status-error">{status.message}</span>
                )}
                {status.kind === "success" && (
                    <span className="status-message status-success">{status.message}</span>
                )}
                {status.kind === "idle" && (
                    <span className="status-message">
                        {templates.length} template{templates.length !== 1 ? "s" : ""} available
                    </span>
                )}
                <span>ScribeForge 0.1.0</span>
            </div>

            {/* Overlays */}
            {overlay === "recent" && (
                <RecentProjectsDialog
                    onOpen={handleOpenRecentPath}
                    onClose={() => setOverlay(null)}
                />
            )}
            {overlay === "create" && selectedTemplate && (
                <CreateProjectDialog
                    template={selectedTemplate}
                    defaultDir={defaultDir}
                    onCreated={handleCreated}
                    onCancel={() => setOverlay(null)}
                />
            )}
        </div>
    );
}
