import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri expects a fixed port and bundle output directory.
export default defineConfig({
  plugins: [react()],
  // Prevent Vite from obscuring Rust panics.
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
  },
  // Tauri webview can use env vars to target dev or prod.
  envPrefix: ["VITE", "TAURI_"],
  build: {
    // Produce smaller bundles for the webview.
    target: "es2021",
    minify: "esbuild",
    sourcemap: false,
    outDir: "dist",
    emptyOutDir: true,
  },
});
