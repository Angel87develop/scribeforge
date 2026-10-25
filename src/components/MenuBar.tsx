/// Application menu bar: File / Edit / View / Project / Documents / Format /
/// Tools / Window / Help.
///
/// Each menu item declares an action id; the Workspace maps ids to real
/// handlers. Items whose action is unavailable in the current state render
/// disabled. Items whose feature is not yet implemented are NOT shown — this
/// bar only exposes working commands.

import { useEffect, useRef, useState } from "react";
import "../styles/menubar.css";

export type MenuAction =
    // File
    | "new-project" | "new-document" | "new-folder" | "open-project" | "open-recent"
    | "save" | "save-as" | "close-project" | "exit"
    // Edit
    | "undo" | "redo" | "cut" | "copy" | "paste" | "select-all"
    | "find" | "find-next" | "find-prev" | "replace" | "search-project"
    // View
    | "toggle-binder" | "toggle-inspector" | "toggle-format-bar"
    | "view-editor" | "focus-mode" | "zoom-in" | "zoom-out" | "zoom-reset"
    // Documents
    | "duplicate" | "rename" | "move-to-trash" | "restore" | "delete-permanently"
    // Format
    | "bold" | "italic" | "underline" | "strikethrough"
    | "align-left" | "align-center" | "align-right" | "align-justify"
    | "list-bullet" | "list-ordered"
    | "paragraph-formatting"
    // Tools
    | "project-search" | "word-count" | "project-stats" | "preferences"
    // Window
    | "reset-layout"
    // Help
    | "about" | "shortcuts";

export interface MenuItemDef {
    action?: MenuAction;
    label: string;
    shortcut?: string;
    separator?: boolean;
    disabled?: boolean;
}

export interface MenuDef {
    label: string;
    items: MenuItemDef[];
}

interface Props {
    menus: MenuDef[];
    onAction: (action: MenuAction) => void;
}

export function MenuBar({ menus, onAction }: Props) {
    const [open, setOpen] = useState<number | null>(null);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        function onDown(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(null);
            }
        }
        document.addEventListener("mousedown", onDown);
        return () => document.removeEventListener("mousedown", onDown);
    }, []);

    return (
        <div className="menubar" ref={ref}>
            {menus.map((menu, i) => (
                <div key={menu.label} className="menubar-item">
                    <button
                        className={`menubar-button${open === i ? " open" : ""}`}
                        onClick={() => setOpen(open === i ? null : i)}
                        onMouseEnter={() => {
                            if (open !== null) setOpen(i);
                        }}
                    >
                        {menu.label}
                    </button>
                    {open === i && (
                        <div className="menubar-dropdown">
                            {menu.items.map((item, j) =>
                                item.separator ? (
                                    <div key={`sep-${j}`} className="menubar-sep" />
                                ) : (
                                    <button
                                        key={item.action ?? item.label}
                                        className="menubar-entry"
                                        disabled={item.disabled}
                                        onClick={() => {
                                            setOpen(null);
                                            if (item.action && !item.disabled) {
                                                onAction(item.action);
                                            }
                                        }}
                                    >
                                        <span className="menubar-entry-label">{item.label}</span>
                                        {item.shortcut && (
                                            <span className="menubar-entry-shortcut">{item.shortcut}</span>
                                        )}
                                    </button>
                                ),
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}
