/// The window's title bar, drawn by the app instead of Windows (the window
/// has no system decorations; see `tauri.conf.json`).
///
/// - Left: the ScribeForge logo and name. The rest of the bar drags the
///   window, and a double-click on it maximizes or restores it.
/// - Right: minimize, maximize/restore and close, in the theme's colours.
///   Close goes through the normal close request, so the project is saved
///   and released as with the system button.
/// - The bar dims while the window is not focused, like a native one.
///
/// Outside the desktop app (plain browser) the window buttons do nothing.

import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IconBook } from "./Icons";
import { t } from "../i18n";
import "../styles/titlebar.css";

function appWindow() {
    try {
        return getCurrentWindow();
    } catch {
        return null;
    }
}

export function TitleBar() {
    const [maximized, setMaximized] = useState(false);
    const [focused, setFocused] = useState(true);

    useEffect(() => {
        const win = appWindow();
        if (!win) return;
        const sync = () => {
            win.isMaximized().then(setMaximized).catch(() => {});
        };
        sync();
        const unlisten = [
            win.onResized(sync),
            win.onFocusChanged(({ payload }) => setFocused(payload)),
        ];
        return () => {
            for (const u of unlisten) u.then((f) => f()).catch(() => {});
        };
    }, []);

    const run = (action: (w: NonNullable<ReturnType<typeof appWindow>>) => Promise<void>) => () => {
        const win = appWindow();
        if (win) action(win).catch(() => {});
    };

    return (
        <header className={`titlebar${focused ? "" : " inactive"}`} data-tauri-drag-region>
            <div className="titlebar-brand" data-tauri-drag-region>
                <span className="titlebar-logo" data-tauri-drag-region>
                    <IconBook size={13} />
                </span>
                <span className="titlebar-name" data-tauri-drag-region>
                    Scribe<span className="titlebar-name-accent">Forge</span>
                </span>
            </div>
            <div className="titlebar-controls">
                <button type="button" className="titlebar-btn" title={t("Minimize")} onClick={run((w) => w.minimize())}>
                    <svg viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M0 5.5h10" />
                    </svg>
                </button>
                <button
                    type="button"
                    className="titlebar-btn"
                    title={maximized ? t("Restore") : t("Maximize")}
                    onClick={run((w) => w.toggleMaximize())}
                >
                    {maximized ? (
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                            <path d="M2.5 2.5V0.5h7v7h-2" />
                            <rect x="0.5" y="2.5" width="7" height="7" />
                        </svg>
                    ) : (
                        <svg viewBox="0 0 10 10" aria-hidden="true">
                            <rect x="0.5" y="0.5" width="9" height="9" />
                        </svg>
                    )}
                </button>
                <button type="button" className="titlebar-btn close" title={t("Close")} onClick={run((w) => w.close())}>
                    <svg viewBox="0 0 10 10" aria-hidden="true">
                        <path d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
                    </svg>
                </button>
            </div>
        </header>
    );
}
