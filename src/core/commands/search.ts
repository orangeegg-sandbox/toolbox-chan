export interface SearchableCommand {
  id: string;
  name: string;
  description?: string;
  keywords?: readonly string[];
  kind: "tool" | "navigation" | "action";
}

function normalize(value: string) {
  return value.toLocaleLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");
}

function matchScore(term: string, value: string, fuzzy = true): number {
  if (value === term) return 100;
  if (value.startsWith(term)) return 75;
  if (value.split(/[\s:./-]+/).some((word) => word.startsWith(term))) return 60;
  if (value.includes(term)) return 40;
  if (!fuzzy || term.length < 2) return 0;
  let position = -1;
  for (const letter of term) {
    position = value.indexOf(letter, position + 1);
    if (position === -1) return 0;
  }
  return 15;
}

/** Every search word must match; exact tool IDs and aliases rank ahead of actions. */
export function searchCommands<T extends SearchableCommand>(commands: readonly T[], query: string): T[] {
  const actionsOnly = query.trimStart().startsWith(">");
  const terms = normalize(query.replace(/^\s*>/, "").trim()).split(/\s+/).filter(Boolean);
  return commands.flatMap((command, index) => {
    if (actionsOnly && command.kind !== "action") return [];
    const primary = [command.id.replace(/^tool:/, ""), command.name, ...(command.keywords ?? [])].map(normalize);
    const description = normalize(command.description ?? "");
    let score = command.kind === "tool" ? 5 : 0;
    for (const term of terms) {
      const match = Math.max(...primary.map((field) => matchScore(term, field)), matchScore(term, description, false) * 0.4);
      if (!match) return [];
      score += match;
    }
    return [{ command, score, index }];
  }).sort((a, b) => b.score - a.score || a.index - b.index).map(({ command }) => command);
}
