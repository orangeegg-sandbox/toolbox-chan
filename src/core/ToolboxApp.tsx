import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronRight,
  CircleHelp,
  Keyboard,
  LoaderCircle,
  X,
} from "lucide-react";
import type { ToolDefinition, ToolboxRoute } from "./tools/contracts";
import { createToolRegistry } from "./tools/registry";
import { ToolboxContext, useToolbox } from "./ToolboxContext";
import { Sidebar } from "./components/Sidebar";
import { ToolboxDialogs } from "./components/ToolboxDialogs";
import { ToolLibrary } from "./pages/ToolLibrary";
import { ContributionsPage } from "./pages/ContributionsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ThemeProvider } from "./appearance/ThemeProvider";
import { FontSizeProvider } from "./appearance/FontSizeProvider";
import { CommandProvider, ToolCommandScope } from "./commands/CommandProvider";
import { ShortcutProvider, usePaletteShortcut } from "./commands/ShortcutProvider";
import { createShortcutMatcher } from "./commands/shortcuts";
import { CommandPalette } from "./components/CommandPalette";
import { usePaletteCommands } from "./commands/usePaletteCommands";
import { useDesktopPalette } from "./commands/useDesktopPalette";
import "./styles.css";
import "./commands/palette.css";

export function ToolboxApp({ tools }: { tools: readonly ToolDefinition[] }) {
  const registry = useMemo(() => createToolRegistry(tools), [tools]);
  const [route, setRoute] = useState<ToolboxRoute>(() =>
    tools.length ? { page: "tool", toolId: tools[0].id } : { page: "tools" },
  );
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(
    null,
  );
  const notify = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const navigate = useCallback(
    (next: ToolboxRoute) => {
      if (next.page !== "tool" || registry.get(next.toolId)) setRoute(next);
    },
    [registry],
  );
  const openTool = useCallback(
    (toolId: string) => navigate({ page: "tool", toolId }),
    [navigate],
  );
  const openSettings = useCallback(
    () => navigate({ page: "settings" }),
    [navigate],
  );
  const modifier = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
  const services = useMemo(
    () => ({
      tools: registry.tools,
      route,
      modifier,
      navigate,
      openTool,
      openSettings,
      notify,
    }),
    [registry, route, modifier, navigate, openTool, openSettings, notify],
  );
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 6500 : 3000);
    return () => clearTimeout(timer);
  }, [notice]);

  // Providers stay mounted while navigating; inactive tools retain their session state.
  const content = registry.tools.reduceRight(
    (children, tool) => {
      const Provider = tool.Provider;
      return Provider ? (
        <Provider key={tool.id}>{children}</Provider>
      ) : (
        children
      );
    },
    <ToolboxShell />,
  );
  return (
    <ThemeProvider>
      <FontSizeProvider>
        <ToolboxContext.Provider value={services}>
          <ShortcutProvider>
            <CommandProvider>{content}</CommandProvider>
          </ShortcutProvider>
          {notice && (
            <div
              className={`toast ${notice.error ? "toast-error" : ""}`}
              role={notice.error ? "alert" : "status"}
            >
              {notice.error ? <CircleHelp size={17} /> : <Check size={17} />}
              <span>{notice.text}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice(null)}
              >
                <X size={14} />
              </button>
            </div>
          )}
        </ToolboxContext.Provider>
      </FontSizeProvider>
    </ThemeProvider>
  );
}

function ToolboxShell() {
  const { tools, route } = useToolbox();
  const help = useRef<HTMLDialogElement>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { shortcut, shortcutLabel, nativeActive, nativeRequest, recording } = usePaletteShortcut();
  const openPalette = useCallback(() => {
    help.current?.close();
    setPaletteOpen(true);
  }, []);
  const openHelp = useCallback(() => help.current?.showModal(), []);
  const paletteCommands = usePaletteCommands(openHelp);
  useDesktopPalette(paletteCommands, shortcutLabel);
  const activeTool =
    route.page === "tool"
      ? tools.find((tool) => tool.id === route.toolId)
      : undefined;
  const title =
    activeTool?.name ??
    (route.page === "tools"
      ? "Your toolbox"
      : route.page === "history"
        ? "Recent activity"
        : "Settings");
  const Status = activeTool?.Status;
  const Workspace = activeTool?.Workspace;
  useEffect(() => {
    document.title = `Toolbox-Chan — ${title}`;
  }, [title]);
  useEffect(() => {
    const matcher = createShortcutMatcher(shortcut, openPalette);
    const keydown = (event: KeyboardEvent) => {
      if (recording || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!event.repeat) openPalette();
        return;
      }
      if (!nativeActive && matcher.keydown(event)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    const keyup = (event: KeyboardEvent) => { if (!recording && !nativeActive) matcher.keyup(event); };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("keyup", keyup);
    window.addEventListener("blur", matcher.reset);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("keyup", keyup);
      window.removeEventListener("blur", matcher.reset);
    };
  }, [shortcut, recording, nativeActive, openPalette]);
  useEffect(() => {
    if (nativeRequest) openPalette();
  }, [nativeRequest, openPalette]);
  return (
    <div className="app-shell">
      <Sidebar
        onSearch={openPalette}
        onHelp={openHelp}
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          {Status && <Status />}
          <button
            className="icon-button top-help"
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            onClick={() => help.current?.showModal()}
          >
            <Keyboard size={17} />
          </button>
        </header>
        <main>
          <Suspense
            fallback={
              <div className="empty-view" role="status">
                <LoaderCircle className="spin" size={25} />
                <p>Opening your tool…</p>
              </div>
            }
          >
            {activeTool && Workspace ? (
              <Workspace key={activeTool.id} tool={activeTool} />
            ) : route.page === "tools" ? (
              <ToolLibrary />
            ) : route.page === "history" ? (
              <ContributionsPage />
            ) : (
              <SettingsPage />
            )}
          </Suspense>
        </main>
      </div>
      {tools.map((tool) => tool.Commands ? (
        <ToolCommandScope key={tool.id} toolId={tool.id}><tool.Commands /></ToolCommandScope>
      ) : null)}
      <ToolboxDialogs help={help} activeTool={activeTool} />
      {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} onHelp={openHelp} />}
    </div>
  );
}
