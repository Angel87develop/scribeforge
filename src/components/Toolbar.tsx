/// Main toolbar: grouped, icon-based access to frequent app-level actions.
///
/// Text-formatting controls live in the per-pane FormatBar (see FormatBar.tsx)
/// so each split editor has its own. This bar handles project, document,
/// clipboard/history, and find actions.

import type { MenuAction } from "./MenuBar";
import {
    IconCopy,
    IconDocument,
    IconFolder,
    IconOpen,
    IconPaste,
    IconPlus,
    IconRedo,
    IconSave,
    IconScissors,
    IconSearch,
    IconUndo,
} from "./Icons";
import "../styles/menubar.css";

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
        <div className="toolbar" role="toolbar" aria-label="Main toolbar">
            {/* Project & documents */}
            <div className="toolbar-group">
                <Tb action="new-project" title="New Project" onClick={onAction}>
                    <IconPlus size={16} />
                </Tb>
                <Tb action="open-project" title="Open Project (Ctrl+O)" onClick={onAction}>
                    <IconOpen size={16} />
                </Tb>
                <Tb action="save" title="Save (Ctrl+S)" onClick={onAction}>
                    <IconSave size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            <div className="toolbar-group">
                <Tb action="new-document" title="New Document (Ctrl+N)" onClick={onAction}>
                    <IconDocument size={16} />
                </Tb>
                <Tb action="new-folder" title="New Folder" onClick={onAction}>
                    <IconFolder size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            {/* Edit / history */}
            <div className="toolbar-group">
                <Tb action="undo" title="Undo (Ctrl+Z)" disabled={d("undo")} onClick={onAction}>
                    <IconUndo size={16} />
                </Tb>
                <Tb action="redo" title="Redo (Ctrl+Y)" disabled={d("redo")} onClick={onAction}>
                    <IconRedo size={16} />
                </Tb>
                <Tb action="cut" title="Cut (Ctrl+X)" disabled={d("cut")} onClick={onAction}>
                    <IconScissors size={16} />
                </Tb>
                <Tb action="copy" title="Copy (Ctrl+C)" disabled={d("copy")} onClick={onAction}>
                    <IconCopy size={16} />
                </Tb>
                <Tb action="paste" title="Paste (Ctrl+V)" disabled={d("paste")} onClick={onAction}>
                    <IconPaste size={16} />
                </Tb>
            </div>
            <div className="toolbar-sep" />
            {/* Find */}
            <div className="toolbar-group">
                <Tb action="find" title="Find (Ctrl+F)" onClick={onAction}>
                    <IconSearch size={16} />
                </Tb>
            </div>
        </div>
    );
}
