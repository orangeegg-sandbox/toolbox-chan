import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type PropsWithChildren,
  type DragEvent,
} from "react";
import { useToolbox } from "../../core/ToolboxContext";
import { cropImage, prepareImage, readImage } from "./services/images";
import { OcrCancelled, OcrEngine, type OcrProgress } from "./services/offline";
import { recognizeOnline, validateEndpoint } from "./services/online";
import { clipboardImage } from "./services/clipboard";
import { copyText, exportText } from "../../core/platform/text";
import {
  clearStoredHistory,
  loadHistory,
  loadPreferences,
  saveHistory,
  savePreferences,
} from "./storage";
import type {
  Engine,
  HistoryEntry,
  OcrMode,
  OcrWord,
  OnlineConfig,
  Preferences,
  Region,
  SourceImage,
} from "./types";
import { errorMessage } from "./utils";
function useOcrController() {
  const { route, modifier, notify, openTool, openSettings } = useToolbox();
  const active = route.page === "tool" && route.toolId === "ocr";
  const [preferences, setPreferences] = useState(loadPreferences);
  const [history, setHistory] = useState(loadHistory);
  const [source, setSource] = useState<SourceImage | null>(null);
  const [mode, setMode] = useState<OcrMode>("simple");
  const [engine, setEngine] = useState<Engine>("offline");
  const [online, setOnline] = useState<OnlineConfig>({
    endpoint: "https://api.openai.com/v1",
    model: "",
    apiKey: "",
  });
  const [regions, setRegions] = useState<Region[]>([]);
  const [activeRegion, setActiveRegion] = useState<number | null>(null);
  const [regionTexts, setRegionTexts] = useState<string[]>([]);
  const [words, setWords] = useState<OcrWord[]>([]);
  const [text, setText] = useState("");
  const [result, setResult] = useState<{
    confidence: number;
    duration: number;
    name: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadingImage, setLoadingImage] = useState(false);
  const [progress, setProgress] = useState<OcrProgress>({
    progress: 0,
    status: "",
  });
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const ocr = useRef(new OcrEngine());
  const busyRef = useRef(false);
  const job = useRef(0);
  const imageLoad = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const dragDepth = useRef(0);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);
  useEffect(
    () => () => {
      ocr.current.cancel();
      abort.current?.abort();
    },
    [],
  );
  useEffect(
    () => () => {
      if (source) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  const updatePreferences = (update: Partial<Preferences>) => {
    const next = { ...preferences, ...update };
    setPreferences(next);
    try {
      savePreferences(next);
    } catch {
      notify("Settings could not be saved on this device.", true);
    }
    if (update.keepHistory === false) {
      setHistory([]);
      try {
        clearStoredHistory();
      } catch {
        notify("Stored history could not be cleared.", true);
      }
    }
  };
  const loadFile = useCallback(
    async (file: File) => {
      if (busyRef.current) {
        notify("Wait for recognition to finish, or cancel it first.");
        return;
      }
      const token = ++imageLoad.current;
      setLoadingImage(true);
      setError("");
      try {
        const next = await readImage(file);
        if (token !== imageLoad.current) {
          URL.revokeObjectURL(next.url);
          return;
        }
        setSource(next);
        setText("");
        setWords([]);
        setRegions([]);
        setActiveRegion(null);
        setRegionTexts([]);
        setResult(null);
        openTool("ocr");
      } catch (failure) {
        if (token === imageLoad.current) setError(errorMessage(failure));
      } finally {
        if (token === imageLoad.current) setLoadingImage(false);
      }
    },
    [notify, openTool],
  );
  const pasteImage = async () => {
    if (busyRef.current) return;
    try {
      await loadFile(await clipboardImage());
    } catch (failure) {
      notify(errorMessage(failure), true);
    }
  };
  const copy = async () => {
    if (!text.trim()) return;
    try {
      await copyText(text);
      setCopied(true);
      notify("Text copied to clipboard.");
    } catch {
      notify(
        "Clipboard access failed. You can select the text and copy it manually.",
        true,
      );
    }
  };
  const download = async () => {
    try {
      if (
        await exportText(text, result?.name ?? source?.name ?? "extracted-text")
      )
        notify("Text exported.");
    } catch (failure) {
      notify(`Could not export text: ${errorMessage(failure)}`, true);
    }
  };
  const cancel = () => {
    job.current++;
    ocr.current.cancel();
    abort.current?.abort();
    busyRef.current = false;
    setBusy(false);
    setProgress({ progress: 0, status: "" });
    notify("Recognition cancelled.");
  };
  const extract = async () => {
    if (!source || busyRef.current || loadingImage) return;
    if (mode === "custom" && !regions.length) {
      setError("Highlight at least one area on the image first.");
      return;
    }
    if (engine === "online") {
      try {
        validateEndpoint(online.endpoint);
        if (!online.model.trim())
          throw new Error(
            "Add your online OCR model and API key in Settings first.",
          );
      } catch (failure) {
        setError(errorMessage(failure));
        return;
      }
    }
    const token = ++job.current;
    const start = performance.now();
    busyRef.current = true;
    setBusy(true);
    setError("");
    setWords([]);
    setText("");
    setRegionTexts([]);
    setResult(null);
    setProgress({ progress: 0.01, status: "Preparing your image…" });
    const controller = new AbortController();
    abort.current = controller;
    const timeout = setTimeout(() => {
      controller.abort();
      ocr.current.cancel();
    }, 120_000);
    try {
      const canvas = await prepareImage(source, 0);
      const selected =
        mode === "custom" ? regions : [{ x: 0, y: 0, width: 1, height: 1 }];
      const results = [];
      for (let index = 0; index < selected.length; index++) {
        if (token !== job.current || controller.signal.aborted)
          throw new OcrCancelled();
        const image =
          mode === "custom" ? cropImage(canvas, selected[index]) : canvas;
        const onProgress = (p: OcrProgress) => {
          if (token === job.current)
            setProgress({
              progress: (index + p.progress) / selected.length,
              status:
                selected.length > 1
                  ? `Region ${index + 1} of ${selected.length} · ${p.status}`
                  : p.status,
            });
        };
        if (engine === "online")
          onProgress({
            progress: 0.25,
            status: "Reading with your online provider…",
          });
        results.push(
          engine === "offline"
            ? await ocr.current.recognize(
                image,
                preferences.language,
                mode === "custom" && preferences.layout === "auto"
                  ? "block"
                  : preferences.layout,
                onProgress,
              )
            : await recognizeOnline(
                image,
                online,
                preferences.language,
                controller.signal,
              ),
        );
      }
      if (token !== job.current || controller.signal.aborted)
        throw new OcrCancelled();
      const recognized = results
        .map((r) => r.text)
        .filter(Boolean)
        .join("\n\n");
      const confidence =
        engine === "offline"
          ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
          : -1;
      const duration = (performance.now() - start) / 1000;
      setText(recognized);
      setRegionTexts(mode === "custom" ? results.map((r) => r.text) : []);
      setWords(mode === "overlay" ? results[0].words : []);
      setResult({ confidence, duration, name: source.name });
      setProgress({
        progress: 1,
        status: recognized
          ? "All done. Make it yours."
          : "No text detected. Try a clearer image or another layout.",
      });
      if (recognized && preferences.keepHistory) {
        const entry: HistoryEntry = {
          id: crypto.randomUUID(),
          name: source.name,
          text: recognized,
          language: preferences.language,
          createdAt: Date.now(),
          confidence,
          duration,
        };
        const next = [entry, ...history].slice(0, 20);
        setHistory(next);
        try {
          saveHistory(next);
        } catch {
          notify(
            "Text is ready, but local history is full and could not be saved.",
            true,
          );
        }
      }
      if (recognized && preferences.autoCopy) {
        try {
          await copyText(recognized);
          notify("Text extracted and copied.");
        } catch {
          notify(
            "Text is ready. Automatic copy could not access the clipboard.",
            true,
          );
        }
      }
    } catch (failure) {
      if (token === job.current) {
        const timedOut = controller.signal.aborted;
        setError(
          timedOut
            ? "Recognition timed out. Try a smaller image or fewer highlighted regions."
            : failure instanceof OcrCancelled
              ? "Recognition cancelled. You can try again."
              : `Could not read this image. ${errorMessage(failure)}`,
        );
      }
    } finally {
      clearTimeout(timeout);
      if (token === job.current) {
        busyRef.current = false;
        setBusy(false);
        abort.current = null;
      }
    }
  };
  const restore = (entry: HistoryEntry) => {
    if (busyRef.current) {
      notify("Finish or cancel the current recognition first.");
      return;
    }
    imageLoad.current++;
    setLoadingImage(false);
    setSource(null);
    setRegions([]);
    setActiveRegion(null);
    setRegionTexts([]);
    setWords([]);
    setText(entry.text);
    setResult({
      confidence: entry.confidence,
      duration: entry.duration,
      name: entry.name,
    });
    setError("");
    openTool("ocr");
  };
  const removeHistory = (id?: string) => {
    if (busyRef.current) {
      notify("Finish or cancel the current recognition first.");
      return;
    }
    const next = id ? history.filter((entry) => entry.id !== id) : [];
    setHistory(next);
    try {
      saveHistory(next);
    } catch {
      notify("History could not be updated.", true);
    }
  };
  const changeMode = (next: OcrMode) => {
    setMode(next);
    setActiveRegion(null);
    setWords([]);
    setError("");
  };
  const changeEngine = (next: Engine) => {
    setEngine(next);
    if (next === "online" && mode === "overlay") setMode("simple");
    setWords([]);
    setError("");
  };
  useEffect(() => {
    if (!active) return;
    const paste = (event: ClipboardEvent) => {
      const item = Array.from(event.clipboardData?.items ?? []).find(
        (i) => i.kind === "file" && i.type.startsWith("image/"),
      );
      const file = item?.getAsFile();
      if (file) {
        event.preventDefault();
        void loadFile(file);
      }
    };
    document.addEventListener("paste", paste);
    return () => document.removeEventListener("paste", paste);
  }, [loadFile, active]);
  useEffect(() => {
    if (!active) return;
    const keydown = (event: KeyboardEvent) => {
      if (
        !(event.ctrlKey || event.metaKey) ||
        document.querySelector("dialog[open]")
      )
        return;
      if (event.key.toLowerCase() === "o") {
        event.preventDefault();
        if (!busyRef.current) fileInput.current?.click();
      }
      if (event.key === "Enter" && active) {
        event.preventDefault();
        void extract();
      }
      if (event.shiftKey && event.key.toLowerCase() === "c" && text) {
        event.preventDefault();
        void copy();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  });
  const drop = (event: DragEvent) => {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file) void loadFile(file);
  };
  const textCount = [...text].length;
  const updateRegions = (next: Region[]) => {
    setRegions(next);
    setActiveRegion(null);
    setRegionTexts([]);
  };
  const editText = (next: string) => {
    setText(next);
    // A free-form edit no longer has a reliable per-region correspondence.
    setRegionTexts([]);
    setActiveRegion(null);
  };
  const editRegionText = (index: number, next: string) => {
    const updated = regionTexts.map((value, i) => i === index ? next : value);
    setRegionTexts(updated);
    setText(updated.filter(Boolean).join("\n\n"));
  };
  return {
    preferences,
    history,
    source,
    setSource,
    mode,
    engine,
    online,
    setOnline,
    regions,
    setRegions: updateRegions,
    activeRegion,
    setActiveRegion,
    regionTexts,
    editRegionText,
    words,
    setWords,
    text,
    setText: editText,
    result,
    busy,
    loadingImage,
    progress,
    error,
    setError,
    dragging,
    setDragging,
    copied,
    fileInput,
    dragDepth,
    modifier,
    notify,
    openTool,
    openSettings,
    updatePreferences,
    loadFile,
    pasteImage,
    copy,
    download,
    cancel,
    extract,
    restore,
    removeHistory,
    changeMode,
    changeEngine,
    drop,
    textCount,
  };
}
const OcrContext = createContext<ReturnType<typeof useOcrController> | null>(
  null,
);
export function OcrProvider({ children }: PropsWithChildren) {
  const controller = useOcrController();
  return (
    <OcrContext.Provider value={controller}>{children}</OcrContext.Provider>
  );
}
export function useOcr() {
  const context = useContext(OcrContext);
  if (!context) throw new Error("OCR surfaces require OcrProvider.");
  return context;
}
