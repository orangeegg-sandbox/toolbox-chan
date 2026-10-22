import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Cargo locks files under src-tauri/target while building; watching them crashes the dev server.
  server: { port: 1420, strictPort: true, watch: { ignored: ["**/src-tauri/**"] } },
  clearScreen: false,
  build: { target: ["es2022", "chrome105", "safari15"] },
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
