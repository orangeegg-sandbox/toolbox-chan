import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Cargo locks files under src-tauri/target while building; watching them crashes the dev server.
  // .tools/ (the local Rust toolchain) and agent worktrees in .claude/ hold tens of thousands
  // of files; watching or scanning them stalls the dev server, so only this checkout's pages are entries.
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**", "**/.claude/**", "**/.tools/**"] } },
  optimizeDeps: { entries: ["index.html", "src/**/*.html"] },
  clearScreen: false,
  build: { target: ["es2022", "chrome105", "safari15"] },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
