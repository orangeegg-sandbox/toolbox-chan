export const LANGUAGES = [
  { value: "eng", label: "English", short: "EN" },
  { value: "eng+chi_tra", label: "English + 繁體中文", short: "EN + 繁" },
  { value: "eng+chi_sim", label: "English + 简体中文", short: "EN + 简" },
  {
    value: "eng+chi_tra+chi_sim",
    label: "English + 繁體 + 简体",
    short: "EN + 中文",
  },
] as const;
export type Language = (typeof LANGUAGES)[number]["value"];
export type Layout = "auto" | "sparse" | "block";
export type OcrMode = "simple" | "overlay" | "custom";
export type Engine = "offline" | "online";
export interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface OcrWord extends Region {
  text: string;
  confidence: number;
}
export interface OnlineConfig {
  endpoint: string;
  model: string;
  apiKey: string;
}
export interface Preferences {
  language: Language;
  layout: Layout;
  keepHistory: boolean;
  autoCopy: boolean;
}
export interface HistoryEntry {
  id: string;
  name: string;
  text: string;
  language: Language;
  createdAt: number;
  confidence: number;
  duration: number;
}
export interface SourceImage {
  name: string;
  url: string;
  width: number;
  height: number;
  bytes: number;
}
