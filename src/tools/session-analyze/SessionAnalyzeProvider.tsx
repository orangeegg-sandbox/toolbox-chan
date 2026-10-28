import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { analyzeSession, loadPricing, openPricingFolder, scanCoverage, scanSessions } from "./backend";
import { estimateSessionCost } from "./pricing";
import { MAX_IMPORT_BYTES, parseReport } from "./import";
import type { GeneralChatAnalyze, ProjectCoverage, SessionCatalog, SessionPreview } from "./types";

const importedPreview = (result: GeneralChatAnalyze): SessionPreview => ({ ...result.session, sourcePath: `imported:${result.session.sourcePath}`, title: `Imported · ${result.session.title || result.session.id}` });

function useSessionState() {
  const [catalog, setCatalog] = useState<SessionCatalog>({ sessions: [], sources: [], warnings: [] });
  const [report, setReport] = useState<GeneralChatAnalyze | null>(null);
  const [coverage, setCoverage] = useState<ProjectCoverage | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [scanned, setScanned] = useState(false);
  const [workspaceTab, setWorkspaceTab] = useState<"sessions" | "analysis">("sessions");
  const [pricing, setPricing] = useState<Awaited<ReturnType<typeof loadPricing>> | null>(null);
  const [pricingError, setPricingError] = useState("");
  const imported = useRef(new Map<string, GeneralChatAnalyze>());
  const running = useRef(false);
  async function work(label: string, action: () => Promise<void>) {
    if (running.current) return;
    running.current = true;
    setBusy(label);
    setError("");
    try { await action(); } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { running.current = false; setBusy(""); }
  }
  const key = (session: SessionPreview) => `${session.agent}:${session.sourcePath}:${session.id}`;
  async function readPrices() {
    try {
      const next = await loadPricing();
      setPricing(next);
      setPricingError("");
      return next;
    } catch (cause) {
      setPricing(null);
      setPricingError(cause instanceof Error ? cause.message : String(cause));
      return null;
    }
  }
  async function priceReport(result: GeneralChatAnalyze): Promise<GeneralChatAnalyze> {
    const next = await readPrices();
    if (!next || result.cost.basis !== "unknown") return result;
    const estimate = estimateSessionCost(result, next.catalog);
    return estimate.amount === null ? result : { ...result, cost: { amount: estimate.amount, currency: "USD", basis: "estimated", detail: estimate.detail } };
  }
  return {
    catalog, report, coverage, busy, error, scanned, pricing, pricingError, workspaceTab, setWorkspaceTab,
    refresh: () => work("Finding sessions…", async () => {
      const next = await scanSessions();
      const known = new Set(next.sessions.map(key));
      next.sessions.push(...[...imported.current.values()].map(importedPreview).filter((item) => !known.has(key(item))));
      setCatalog(next);
      setScanned(true);
    }),
    analyze: (session: SessionPreview) => work(`Analyzing ${session.title || session.id}…`, async () => {
      const cached = imported.current.get(key(session));
      const result = await priceReport(cached ?? await analyzeSession(session));
      if (cached) imported.current.set(key(session), result);
      if (!cached) setCatalog((old) => ({ ...old, sessions: old.sessions.map((item) => key(item) === key(session) ? result.session : item) }));
      setReport(result);
      setCoverage(null);
      setWorkspaceTab("analysis");
    }),
    importFile: (file: File) => work("Importing report…", async () => {
      if (file.size > MAX_IMPORT_BYTES) throw new Error("Report is too large. Maximum size is 20 MiB.");
      const result = await priceReport(parseReport(await file.text()));
      const preview = importedPreview(result);
      imported.current.set(key(preview), result);
      setCatalog((old) => ({ ...old, sessions: [preview, ...old.sessions.filter((item) => key(item) !== key(preview))] }));
      setReport(result);
      setCoverage(null);
      setWorkspaceTab("analysis");
    }),
    getCoverage: (rescan = false, includeDependencies = false, respectGitignore = false) => work(rescan ? "Rescanning project structure…" : "Loading project structure…", async () => { if (report) setCoverage(await scanCoverage(report, rescan, includeDependencies, respectGitignore)); }),
    reloadPrices: () => work("Reloading model prices…", async () => { await readPrices(); }),
    openPrices: () => work("Opening the pricing folder…", openPricingFolder),
    saveEstimate: (amount: number, detail: string) => {
      if (!report || report.cost.basis === "reported" || !Number.isFinite(amount) || amount < 0) return;
      const next: GeneralChatAnalyze = { ...report, cost: { amount, currency: "USD", basis: "estimated", detail } };
      const importKey = key(importedPreview(report));
      if (imported.current.has(importKey)) imported.current.set(importKey, next);
      setReport(next);
    },
    exportAction: (action: () => Promise<void>) => work("Exporting report…", action),
  };
}
type State = ReturnType<typeof useSessionState>;
const Context = createContext<State | null>(null);
export function SessionAnalyzeProvider({ children }: { children?: ReactNode }) {
  return <Context.Provider value={useSessionState()}>{children}</Context.Provider>;
}
export function useSessionAnalyze() {
  const value = useContext(Context);
  if (!value) throw new Error("Session analyze provider is missing.");
  return value;
}
