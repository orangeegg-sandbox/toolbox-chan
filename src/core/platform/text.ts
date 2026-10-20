import { isTauri, invoke } from "@tauri-apps/api/core";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
export async function copyText(text: string) {
  if (isTauri()) await writeText(text);
  else await navigator.clipboard.writeText(text);
}
export async function exportText(
  text: string,
  sourceName: string,
): Promise<boolean> {
  const name = `${sourceName.replace(/\.[^.]+$/, "").replace(/[<>:"/\\|?*\x00-\x1f]/g, "_") || "extracted-text"}.txt`;
  if (isTauri()) return invoke<boolean>("save_text", { text, name });
  const url = URL.createObjectURL(
    new Blob([text], { type: "text/plain;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
