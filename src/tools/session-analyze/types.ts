/** Portable, evidence-based session report. Keep the bundled skill schema in sync. */
export type AgentPlatform = "codex" | "claude" | "dsh" | "other";
export type TowerOrigin = "yes" | "no" | "unknown";
export interface SessionPreview {
  sourcePath: string;
  id: string;
  agent: AgentPlatform;
  title: string;
  project: string | null;
  modifiedAt: number;
  sizeBytes: number;
  tower: TowerOrigin;
}
export interface SessionCatalog {
  sessions: SessionPreview[];
  sources: { agent: AgentPlatform; path: string; found: boolean }[];
  warnings: string[];
}
export interface SessionEvent {
  id: string;
  order: number;
  timestamp: string | null;
  kind: "message" | "tool" | "mcp" | "skill" | "context" | "compaction";
  name: string;
  role: string | null;
  text: string;
  callId: string | null;
  status: "observed" | "success" | "error" | "unknown";
  source: string;
}
export interface FileActivity {
  path: string;
  operation: "read" | "write" | "list" | "search";
  eventId: string;
  evidence: "explicit" | "inferred";
}
/** One evidenced request or non-overlapping usage delta; unknown attribution stays null. */
export interface UsageSample {
  id: string;
  model: string | null;
  /** Zoned ISO 8601 date-time, or null when the instant is unknown. */
  timestamp: string | null;
  /** Total input including cache reads and writes. */
  inputTokens: number | null;
  outputTokens: number | null;
  /** Cache-read subset of inputTokens. */
  cachedInputTokens: number | null;
  /** Cache-write subset of inputTokens, disjoint from cache reads. */
  cacheWriteInputTokens: number | null;
  source: string;
}
export interface GeneralChatAnalyze {
  schemaVersion: 1;
  session: SessionPreview;
  analyzedAt: string;
  events: SessionEvent[];
  files: FileActivity[];
  usage: {
    /** Total input including cache reads/writes; cachedInputTokens is a subset. */
    inputTokens: number | null;
    /** Total output; separately reported reasoningTokens is a subset. */
    outputTokens: number | null;
    cachedInputTokens: number | null;
    reasoningTokens: number | null;
    basis: string;
  };
  /** Optional in v1; samples may cover only part of the aggregate usage. */
  usageSamples?: UsageSample[];
  /** True only when all session usage, including retries, has evidenced sample attribution. Absent means unknown. */
  usageSamplesComplete?: boolean;
  cost: {
    amount: number | null;
    currency: "USD";
    basis: "reported" | "estimated" | "unknown";
    detail: string;
  };
  warnings: string[];
}
export interface ProjectCoverage {
  project: string;
  totalFiles: number;
  readFiles: string[];
  writtenFiles: string[];
  untouchedFiles: string[];
  outsideProject: string[];
  /** Original recorded operations that could not be mapped to an included snapshot file. */
  unmatchedFiles: Array<FileActivity & { reason: "not-in-snapshot" | "outside-project" | "unresolved" }>;
  basis: string;
  warnings: string[];
  entries: { path: string; kind: "file" | "directory"; excluded: boolean }[];
  scannedAt: number;
  cached: boolean;
  includeDependencies: boolean;
  respectGitignore: boolean;
  ignoredEntries: number;
  complete: boolean;
}
