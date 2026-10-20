import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Box,
  Check,
  ChevronRight,
  CircleHelp,
  Keyboard,
  LoaderCircle,
  X,
  Zap,
} from "lucide-react";
import type { ToolDefinition, ToolboxRoute } from "./tools/contracts";
import { createToolRegistry } from "./tools/registry";
import { ToolboxContext, useToolbox } from "./ToolboxContext";
import { Sidebar } from "./components/Sidebar";
import { ToolboxDialogs } from "./components/ToolboxDialogs";
import { ToolLibrary } from "./pages/ToolLibrary";
import { ContributionsPage } from "./pages/ContributionsPage";
import { ThemeProvider } from "./appearance/ThemeProvider";
import { FontSizeProvider } from "./appearance/FontSizeProvider";
import "./styles.css";

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
          {content}
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
  const palette = useRef<HTMLDialogElement>(null);
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
    document.title = `Little Toolbox — ${title}`;
  }, [title]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (!help.current?.open && !palette.current?.open)
          palette.current?.showModal();
      }
    };
    document.addEventListener("keydown", keydown);
    return () => document.removeEventListener("keydown", keydown);
  }, []);
  return (
    <div className="app-shell">
      <Sidebar
        onSearch={() => palette.current?.showModal()}
        onHelp={() => help.current?.showModal()}
      />
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{title}</strong>
          </div>
          {Status ? (
            <Status />
          ) : (
            <div className="privacy-pill">
              <span className="green-dot" />
              Local by default
            </div>
          )}
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
            ) : (
              <ContributionsPage
                surface={route.page === "history" ? "Activity" : "Settings"}
              />
            )}
          </Suspense>
        </main>
        <footer className="app-footer">
          <span>
            <Box size={13} />A little tool. A little time back.
          </span>
          <span>
            <Zap size={12} />
            Built for the little things.
          </span>
        </footer>
      </div>
      <ToolboxDialogs help={help} palette={palette} activeTool={activeTool} />
    </div>
  );
}
