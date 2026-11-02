import { createRoot } from "react-dom/client";
import App from "./App";
import { PreferencesProvider } from "./services/preferences";
import "./styles/global.css";

const container = document.getElementById("root");
if (!container) {
    throw new Error("Root container #root not found");
}
createRoot(container).render(
    <PreferencesProvider>
        <App />
    </PreferencesProvider>,
);
