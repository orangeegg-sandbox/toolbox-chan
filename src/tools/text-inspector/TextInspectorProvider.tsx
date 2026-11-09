import { createContext, useContext, useRef, useState, type PropsWithChildren } from "react";
import { copyText, exportText, useToolbox } from "../../core/sdk";
import { analyze, DEFAULT_RULES, MAX_INPUT_UNITS, type Analysis, type CleanRules } from "./engine";

interface Session {
  source: string;
  rules: CleanRules;
  analysis: Analysis | null;
  error: string;
  sourceVersion: number;
}

function useInspectorState() {
  const { notify } = useToolbox();
  const [session, setSession] = useState<Session>({
    source: "", rules: { ...DEFAULT_RULES }, analysis: null, error: "", sourceVersion: 0,
  });
  const current = useRef(session);
  const activeOutput = useRef(false);
  const [busy, setBusy] = useState(false);
  const [outputError, setOutputError] = useState("");
  function publish(next: Session) {
    current.current = next;
    setSession(next);
  }
  function replaceSource(source: string | null) {
    if (activeOutput.current) return;
    setOutputError("");
    const previous = current.current;
    if (source === null) {
      publish({ ...previous, error: "The clipboard has no plain text. Your previous text is unchanged." });
      return;
    }
    if (source.length > MAX_INPUT_UNITS) {
      publish({ ...previous, error: "Text is too large. Paste at most 100,000 UTF-16 code units. Your previous text is unchanged." });
      return;
    }
    try {
      const analysis = source ? analyze(source, previous.rules) : null;
      publish({ ...previous, source, analysis, error: "", sourceVersion: previous.sourceVersion + 1 });
    } catch {
      publish({ ...previous, error: "Text could not be inspected. Your previous text is unchanged. Try a smaller selection." });
    }
  }
  function changeRules(rules: CleanRules) {
    if (activeOutput.current) return;
    setOutputError("");
    const previous = current.current;
    try {
      const analysis = previous.source ? analyze(previous.source, rules) : null;
      publish({ ...previous, rules, analysis, error: "" });
    } catch {
      publish({ ...previous, error: "These cleaning choices could not be applied. Your previous choices and output are unchanged." });
    }
  }
  function clear() {
    if (activeOutput.current) return;
    setOutputError("");
    publish({ ...current.current, source: "", analysis: null, error: "", sourceVersion: current.current.sourceVersion + 1 });
  }
  async function output(kind: "copy" | "save") {
    const snapshot = current.current;
    if (activeOutput.current || !snapshot.source || !snapshot.analysis || snapshot.analysis.source.invalidCount || snapshot.analysis.result.invalidCount) return;
    activeOutput.current = true;
    setOutputError("");
    setBusy(true);
    try {
      if (kind === "copy") {
        await copyText(snapshot.analysis.output);
        notify("Cleaned text copied.");
      } else if (await exportText(snapshot.analysis.output, "clean-text")) {
        notify("Cleaned text saved.");
      }
    } catch {
      setOutputError(kind === "copy" ? "Could not copy text. Check clipboard access and try again." : "Could not save text. Choose a writable location and try again.");
    } finally {
      activeOutput.current = false;
      setBusy(false);
    }
  }
  return { ...session, busy, outputError, replaceSource, changeRules, clear, copy: () => output("copy"), save: () => output("save") };
}

const Context = createContext<ReturnType<typeof useInspectorState> | null>(null);

export function TextInspectorProvider({ children }: PropsWithChildren) {
  return <Context.Provider value={useInspectorState()}>{children}</Context.Provider>;
}

export function useTextInspector() {
  const state = useContext(Context);
  if (!state) throw new Error("Text inspector provider is missing.");
  return state;
}
