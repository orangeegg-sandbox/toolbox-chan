// Test-only modules: this HTML entry is never included in the production build.
import {
  createContext,
  useContext,
  useState,
  type PropsWithChildren,
} from "react";
import { createRoot } from "react-dom/client";
import { Calculator, FileText } from "lucide-react";
import { ToolboxApp } from "../../ToolboxApp";
// Fixture tools use the same SDK entry point as production tools.
import {
  ToolCommandHandler,
  ToolPage,
  ToolPanel,
  useToolCommands,
  type ToolDefinition,
  type ToolSurfaceProps,
} from "../../sdk";

const CounterContext = createContext<{
  count: number;
  step: number;
  increment: () => void;
  setStep: (step: number) => void;
}>(null!);
function CounterProvider({ children }: PropsWithChildren) {
  const [count, setCount] = useState(0),
    [step, setStep] = useState(1);
  return (
    <CounterContext.Provider
      value={{ count, step, increment: () => setCount(count + step), setStep }}
    >
      {children}
    </CounterContext.Provider>
  );
}
function CounterWorkspace({ tool }: ToolSurfaceProps) {
  const { count, increment } = useContext(CounterContext);
  return (
    <ToolPage
      tool={tool}
      toolbar={<p>Toolbar supplied by the counter module.</p>}
      footer={<p>Counter footer slot.</p>}
    >
      <ToolPanel title="Counter panel">
        <output aria-label="Counter value">{count}</output>
        <button className="button primary" onClick={increment}>
          Increment counter
        </button>
      </ToolPanel>
      <ToolPanel title="Counter settings">
        <CounterSettings />
      </ToolPanel>
    </ToolPage>
  );
}
function CounterSettings() {
  const { step, setStep } = useContext(CounterContext);
  return (
    <label>
      Counter step
      <input
        type="number"
        value={step}
        onChange={(event) => setStep(Number(event.target.value))}
      />
    </label>
  );
}
type CounterCommandState = { increment: () => void };
class CounterCommandHandler extends ToolCommandHandler<CounterCommandState, "increment"> {
  protected readonly definitions = [
    {
      id: "counter.increment",
      name: "Increment counter",
      description: "Add the current step to the counter",
      keywords: ["plus"],
      action: "increment" as const,
    },
  ];
  protected readonly actions = {
    increment: (state: CounterCommandState) => state.increment(),
  };
}
const counterCommandHandler = new CounterCommandHandler();
function CounterCommands() {
  const state = useContext(CounterContext);
  useToolCommands(counterCommandHandler, state);
  return null;
}
const NotesContext = createContext<{
  text: string;
  setText: (text: string) => void;
}>(null!);
function NotesProvider({ children }: PropsWithChildren) {
  const [text, setText] = useState("");
  return (
    <NotesContext.Provider value={{ text, setText }}>
      {children}
    </NotesContext.Provider>
  );
}
function NotesWorkspace({ tool }: ToolSurfaceProps) {
  const { text, setText } = useContext(NotesContext);
  return (
    <ToolPage tool={tool}>
      <ToolPanel title="Notes panel">
        <textarea
          aria-label="Fixture note"
          value={text}
          onChange={(event) => setText(event.target.value)}
        />
      </ToolPanel>
    </ToolPage>
  );
}
const tools: ToolDefinition[] = [
  {
    id: "counter",
    name: "Counter fixture",
    description: "A different tool",
    keywords: ["tally"],
    category: "Fixtures",
    icon: Calculator,
    Provider: CounterProvider,
    Workspace: CounterWorkspace,
    Commands: CounterCommands,
    Activity: () => <p>Counter activity contribution.</p>,
  },
  {
    id: "notes",
    name: "Notes fixture",
    description: "Another independent tool",
    keywords: ["scratchpad"],
    category: "Fixtures",
    icon: FileText,
    Provider: NotesProvider,
    Workspace: NotesWorkspace,
  },
];
createRoot(document.getElementById("root")!).render(
  <ToolboxApp tools={location.search.includes("empty") ? [] : tools} />,
);
