/// Project Templates selector — the first-run and new-project window.
///
/// Layout: left category sidebar, centre template grid, right preview pane,
/// bottom action bar (Open Recent, Open Existing File, Import from Scrivener,
/// Cancel, Open).

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type CategoryDto, type OpenProjectResult, type TemplatePreview } from "../services/api";
import { usePreferences } from "../services/preferences";
import { categoryIcon } from "../templates/categoryIcons";
import {
    IconClock,
    IconClose,
    IconDocument,
    IconImport,
    IconOpen,
    IconPlus,
} from "../components/Icons";
import { CreateProjectDialog } from "./CreateProjectDialog";
import { ImportScrivenerDialog } from "./ImportScrivenerDialog";
import { RecentProjectsDialog } from "./RecentProjectsDialog";
import { SyncTip, useGuardedOpen } from "./SyncDialogs";
import "../styles/templates.css";
import { t, tn } from "../i18n";

type Status = { kind: "idle" } | { kind: "busy"; message: string } | { kind: "error"; message: string } | { kind: "success"; message: string };

interface Props {
    onProjectOpened: () => void;
    /** Open the Scrivener import dialog right away (File → Import from Scrivener). */
    startImport?: boolean;
    onCancel: () => void;
}

export function ProjectTemplates({ onProjectOpened, onCancel, startImport = false }: Props) {
    const [categories, setCategories] = useState<CategoryDto[]>([]);
    const [activeCategory, setActiveCategory] = useState("getting-started");
    const [templates, setTemplates] = useState<TemplatePreview[]>([]);
    const [selectedTemplate, setSelectedTemplate] = useState<TemplatePreview | null>(null);
    const [status, setStatus] = useState<Status>({ kind: "idle" });
    const [overlay, setOverlay] = useState<null | "recent" | "create" | "import">(startImport ? "import" : null);
    const [defaultDir, setDefaultDir] = useState("");
    const { prefs, save: savePrefs } = usePreferences();

    const opened = useCallback(
        (result: OpenProjectResult) => {
            setStatus({ kind: "success", message: t("Opened {name}", { name: result.manifest.name }) });
            onProjectOpened();
        },
        [onProjectOpened],
    );
    const failed = useCallback((message: string) => setStatus({ kind: "error", message }), []);
    // Asks first when another computer has the project open or is still
    // syncing a newer version.
    const cancelled = useCallback(() => setStatus({ kind: "idle" }), []);
    const guarded = useGuardedOpen(opened, failed, cancelled);

    // Load categories on mount.
    useEffect(() => {
        api.listCategories().then(setCategories).catch((e) => {
            setStatus({ kind: "error", message: t("Failed to load categories: {error}", { error: String(e) }) });
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
                setStatus({ kind: "error", message: t("Failed to load templates: {error}", { error: String(e) }) });
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
            setStatus({ kind: "error", message: t("Select a template first.") });
            return;
        }
        setOverlay("create");
    };

    const handleOpenExisting = async () => {
        setStatus({ kind: "busy", message: t("Opening file dialog…") });
        try {
            const path = await api.pickProjectFile();
            setStatus(path ? { kind: "busy", message: t("Opening project…") } : { kind: "idle" });
            if (path) await guarded.request(path);
        } catch (e) {
            setStatus({ kind: "error", message: t("Failed to open project: {error}", { error: String(e) }) });
        }
    };

    const handleOpenRecentPath = async (path: string) => {
        setStatus({ kind: "busy", message: t("Opening project…") });
        setOverlay(null);
        await guarded.request(path);
    };

    /** First-run tip: make a cloud folder the place for new projects. */
    const chooseProjectsFolder = async () => {
        try {
            const dir = await api.pickDirectory(t("Default folder for new projects"));
            if (!dir || !prefs) return;
            const stored = await savePrefs({ ...prefs, default_project_dir: dir });
            setDefaultDir(stored.default_project_dir || dir);
        } catch (e) {
            setStatus({ kind: "error", message: String(e) });
        }
    };

    const handleCreated = () => {
        setOverlay(null);
        setStatus({ kind: "success", message: t("Project created.") });
        onProjectOpened();
    };

    const selectedIcon = selectedTemplate ? categoryIcon(selectedTemplate.category) : IconDocument;

    return (
        <div className="templates-root">
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
                                title={t(cat.description)}
                            >
                                <Icon size={15} className="cat-icon" />
                                <span>{t(cat.label)}</span>
                                {count !== null && <span className="cat-count">{count}</span>}
                            </div>
                        );
                    })}
                </div>

                {/* Centre: template grid */}
                <div className="templates-center">
                    <div className="templates-center-header">
                        <div className="templates-center-title">
                            {activeCat ? t(activeCat.label) : t("Templates")}
                        </div>
                        {activeCat && (
                            <div className="templates-center-desc">{t(activeCat.description)}</div>
                        )}
                    </div>
                    <SyncTip onChooseFolder={chooseProjectsFolder} />
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
                                {t("No templates in this category.")}
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
                                            <div className="template-card-name">{t(tpl.name)}</div>
                                            <div className="template-card-desc">{t(tpl.description)}</div>
                                            <div className={`template-card-badge${tpl.has_starter_content ? "" : " empty"}`}>
                                                <span className="dot" />
                                                {tpl.has_starter_content ? t("Includes sample content") : t("Empty")}
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
                                    <div className="templates-preview-name">{t(selectedTemplate.name)}</div>
                                    <div className="templates-preview-category">
                                        {t(
                                            categories.find((c) => c.id === selectedTemplate.category)?.label ??
                                                selectedTemplate.category.replace(/-/g, " "),
                                        )}
                                    </div>
                                </div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">{t("Description")}</div>
                                <div className="templates-preview-text">{t(selectedTemplate.description)}</div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">{t("Preview")}</div>
                                <div className="templates-preview-text">{t(selectedTemplate.preview)}</div>
                            </div>
                            <div className="templates-preview-section">
                                <div className="templates-preview-label">{t("Starter Content")}</div>
                                <div className="templates-preview-text">
                                    {selectedTemplate.has_starter_content
                                        ? t("This template creates sample documents you can edit or delete.")
                                        : t("This template creates an empty project structure.")}
                                </div>
                            </div>
                        </>
                    ) : (
                        <div className="templates-preview-empty">
                            {t("Select a template to see its preview.")}
                        </div>
                    )}
                </div>
            </div>

            {/* Bottom action bar */}
            <div className="templates-actions">
                <div className="btn-group">
                    <button onClick={() => setOverlay("recent")}>
                        <IconClock size={15} /> {t("Open Recent")}
                    </button>
                    <button onClick={handleOpenExisting}>
                        <IconOpen size={15} /> {t("Open Existing File")}
                    </button>
                    <button onClick={() => setOverlay("import")}>
                        <IconImport size={15} /> {t("Import from Scrivener")}
                    </button>
                </div>
                <div className="spacer" />
                <button onClick={onCancel}>
                    <IconClose size={15} /> {t("Cancel")}
                </button>
                <button
                    className="primary"
                    disabled={!selectedTemplate || status.kind === "busy"}
                    onClick={handleOpen}
                >
                    <IconPlus size={15} /> {t("Open")}
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
                        {tn(templates.length, "{n} template available", "{n} templates available")}
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
            {guarded.dialog}
            {overlay === "import" && (
                <ImportScrivenerDialog
                    defaultDir={defaultDir}
                    onDone={() => {
                        setOverlay(null);
                        onProjectOpened();
                    }}
                    onCancel={() => setOverlay(null)}
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
