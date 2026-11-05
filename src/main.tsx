import { createRoot } from "react-dom/client";
import App from "./App";
import { TitleBar } from "./components/TitleBar";
import { PreferencesProvider } from "./services/preferences";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
    throw new Error("Root container #root not found");
}
createRoot(container).render(
    <PreferencesProvider>
        <div className="app-frame">
            <TitleBar />
            <div className="app-content">
                <App />
            </div>
        </div>
    </PreferencesProvider>,
);
