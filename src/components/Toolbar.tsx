/// Main toolbar: grouped, icon-based access to frequent app-level actions.
///
/// Text-formatting controls live in the per-pane FormatBar (see FormatBar.tsx)
/// so each split editor has its own. This bar handles project, document,
/// clipboard/history, and find actions.

import type { MenuAction } from "./MenuBar";
import {
    IconCopy,
    IconDocument,
    IconExport,
    IconFolder,
    IconMaximize,
    IconOpen,
    IconPaste,
    IconPlus,
    IconRedo,
    IconSave,
    IconScissors,
    IconSearch,
    IconSettings,
    IconUndo,
} from "./Icons";
import "../styles/menubar.css";
import { t } from "../i18n";

interface Props {
    onAction: (action: MenuAction) => void;
    disabledActions: Set<MenuAction>;
}

function Tb({
    action,
    title,
    children,
    disabled,
    onClick,
}: {
    action: MenuAction;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
    onClick: (a: MenuAction) => void;
}) {
    return (
        <button
            className="toolbar-btn"
            title={title}
            aria-label={title}
            disabled={disabled}
            onClick={() => onClick(action)}
        >
            {children}
        </button>
    );
}

export function Toolbar({ onAction, disabledActions }: Props) {
    const d = (a: MenuAction) => disabledActions.has(a);
    return (
        <div className="toolbar" role="toolbar" aria-label={t("Main toolbar")}>
            {/* Project & documents */}
            <div className="toolbar-group">
                <Tb action="new-project" title={t("New Project")} onClick={onAction}>
                    <IconPlus size={16} />
                </Tb>
                <Tb action="open-project" title={t("Open Project (Ctrl+O)")} onClick={onAction}>
                    <IconOpen size={16} />
                </Tb>
                <Tb action="save" title={t("Save (Ctrl+S)")} onClick={onAction}>
                    <IconSave size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            <div className="toolbar-group">
                <Tb action="new-document" title={t("New Document (Ctrl+N)")} onClick={onAction}>
                    <IconDocument size={16} />
                </Tb>
                <Tb action="new-folder" title={t("New Folder")} onClick={onAction}>
                    <IconFolder size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            {/* Edit / history */}
            <div className="toolbar-group">
                <Tb action="undo" title={t("Undo (Ctrl+Z)")} disabled={d("undo")} onClick={onAction}>
                    <IconUndo size={16} />
                </Tb>
                <Tb action="redo" title={t("Redo (Ctrl+Y)")} disabled={d("redo")} onClick={onAction}>
                    <IconRedo size={16} />
                </Tb>
                <Tb action="cut" title={t("Cut (Ctrl+X)")} disabled={d("cut")} onClick={onAction}>
                    <IconScissors size={16} />
                </Tb>
                <Tb action="copy" title={t("Copy (Ctrl+C)")} disabled={d("copy")} onClick={onAction}>
                    <IconCopy size={16} />
                </Tb>
                <Tb action="paste" title={t("Paste (Ctrl+V)")} disabled={d("paste")} onClick={onAction}>
                    <IconPaste size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            {/* Find */}
            <div className="toolbar-group">
                <Tb action="find" title={t("Find (Ctrl+F)")} onClick={onAction}>
                    <IconSearch size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            {/* Writing & output */}
            <div className="toolbar-group">
                <Tb
                    action="composition-mode"
                    title={t("Composition Mode (F11)")}
                    disabled={d("composition-mode")}
                    onClick={onAction}
                >
                    <IconMaximize size={16} />
                </Tb>
                <Tb action="compile" title={t("Compile (Ctrl+Shift+P)")} onClick={onAction}>
                    <IconExport size={16} />
                </Tb>
                <Tb action="preferences" title={t("Preferences (Ctrl+,)")} onClick={onAction}>
                    <IconSettings size={16} />
                </Tb>
            </div>
        </div>
    );
}
