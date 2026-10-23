import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Cargo locks files under src-tauri/target while building; watching them crashes the dev server.
  // Agent worktrees in .claude/ are whole checkouts with their own builds; watching or
  // scanning them stalls the dev server, so only this checkout's pages are entries.
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/.claude/**"] } },
  optimizeDeps: { entries: ["index.html", "src/**/*.html"] },
  clearScreen: false,
  build: { target: ["es2022", "chrome105", "safari15"] },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
