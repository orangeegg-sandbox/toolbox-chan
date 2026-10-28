import { invoke, isTauri } from "@tauri-apps/api/core";
import type { GeneralChatAnalyze, ProjectCoverage, SessionCatalog, SessionPreview } from "./types";
import { MAX_IMPORT_BYTES } from "./import";
import { parsePricingDocuments } from "./pricing";
import bundledPrices from "./pricing/deepseek.json?raw";

export const desktop = isTauri();
export async function loadPricing() {
  const source = desktop
    ? await invoke<{ folder: string; files: { name: string; json: string }[] }>("session_analyze_prices")
    : { folder: null, files: [{ name: "deepseek.json", json: bundledPrices }] };
  return { folder: source.folder, files: source.files.map((file) => file.name), ...parsePricingDocuments(source.files) };
}
export function openPricingFolder(): Promise<void> {
  return invoke("session_analyze_open_prices");
}
export async function scanSessions(): Promise<SessionCatalog> {
  return desktop ? invoke("session_analyze_scan") : { sessions: [], sources: [], warnings: [] };
}
export function analyzeSession(session: SessionPreview): Promise<GeneralChatAnalyze> {
  return invoke("session_analyze_run", { sourcePath: session.sourcePath, agent: session.agent });
}
export function scanCoverage(report: GeneralChatAnalyze, rescan = false, includeDependencies = false, respectGitignore = false): Promise<ProjectCoverage> {
  const failed = new Set(report.events.filter((event) => event.status === "error").map((event) => event.id));
  return invoke("session_analyze_coverage", { project: report.session.project, files: report.files.filter((file) => !failed.has(file.eventId)), rescan, includeDependencies, respectGitignore });
}
export async function exportReport(report: GeneralChatAnalyze): Promise<void> {
  const json = JSON.stringify(report);
  if (new TextEncoder().encode(json).byteLength > MAX_IMPORT_BYTES) throw new Error("Report exceeds the 20 MiB portable JSON limit.");
  const name = `${report.session.id.replace(/[^a-z0-9_-]/gi, "_").slice(0, 100) || "session"}.analysis.json`;
  if (desktop) {
    await invoke("session_analyze_export", { json, name });
    return;
  }
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
