import type { GeneralChatAnalyze, SessionPreview } from "./types";

export const AGENT_LABELS = { codex: "Codex", claude: "Claude Code", dsh: "DSH", other: "Other" };
export function filterSessions(sessions: SessionPreview[], query: string, project: string, agent: string, tower: string) {
  const needle = query.trim().toLocaleLowerCase();
  return sessions.filter((session) => (!project || (session.project ?? "") === project)
    && (!agent || session.agent === agent) && (!tower || session.tower === tower)
    && (!needle || [session.title, session.id, session.project, session.sourcePath].join(" ").toLocaleLowerCase().includes(needle)));
}
export function projectName(path: string | null) {
  return path?.split(/[\\/]/).filter(Boolean).pop() || "No project recorded";
}
export function estimateCost(usage: GeneralChatAnalyze["usage"], rates: string[]): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null || usage.cachedInputTokens === null
    || usage.cachedInputTokens > usage.inputTokens || rates.length !== 3 || rates.some((rate) => !rate.trim())) return null;
  const [input, cached, output] = rates.map(Number);
  if (![input, cached, output].every((rate) => Number.isFinite(rate) && rate >= 0)) return null;
  const total = ((usage.inputTokens - usage.cachedInputTokens) * input + usage.cachedInputTokens * cached + usage.outputTokens * output) / 1_000_000;
  return Number.isFinite(total) ? total : null;
}
export function contextSignals(report: GeneralChatAnalyze) {
  const reads = new Map<string, number>();
  for (const file of report.files.filter((file) => file.operation === "read")) reads.set(file.path, (reads.get(file.path) ?? 0) + 1);
  return {
    repeatedReads: [...reads].filter(([, count]) => count > 1).sort((a, b) => b[1] - a[1]),
    largestEvents: [...report.events].filter((event) => event.text.length > 0).sort((a, b) => b.text.length - a.text.length),
    contextEvents: report.events.filter((event) => ["context", "skill", "compaction"].includes(event.kind)),
  };
}
