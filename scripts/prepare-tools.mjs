import { readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Optional, tool-owned build hooks. Runtime navigation uses src/tools/index.ts.
const tools = resolve(import.meta.dirname, "../src/tools");
for (const entry of await readdir(tools, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const hook = join(tools, entry.name, "scripts", "prepare-assets.mjs");
  if (existsSync(hook)) await import(pathToFileURL(hook).href);
}
