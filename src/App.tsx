/// ScribeForge application root.
///
/// Manages the top-level view state:
/// - "templates" — the Project Templates selector (shown on first run).
/// - "workspace" — the editor workspace (shown when a project is open).
/// - "welcome" — a minimal screen shown when the user cancels the selector
///   without a project open.

import { useState } from "react";
import { api } from "./services/api";
import { ProjectTemplates } from "./dialogs/ProjectTemplates";
import { Workspace } from "./components/Workspace";
import { IconBook, IconPlus } from "./components/Icons";

type View = "templates" | "workspace" | "welcome";

export default function App() {
    const [view, setView] = useState<View>("templates");

    if (view === "templates") {
        return (
            <ProjectTemplates
                onProjectOpened={() => setView("workspace")}
                onCancel={() => setView("welcome")}
            />
        );
    }

    if (view === "workspace") {
        return <Workspace onBackToTemplates={() => setView("templates")} />;
    }

    // Welcome / idle screen.
    return (
        <div className="welcome-root">
            <div className="welcome-icon">
                <IconBook size={40} />
            </div>
            <div className="welcome-title">ScribeForge</div>
            <div className="welcome-text">
                No project is open. Create a new project or open an existing one to begin writing.
            </div>
            <div className="welcome-actions">
                <button className="primary" onClick={() => setView("templates")}>
                    <IconPlus size={15} /> New Project
                </button>
                <button onClick={() => api.quitApp()}>Quit</button>
            </div>
        </div>
    );
}
