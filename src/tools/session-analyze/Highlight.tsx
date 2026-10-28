import type { ReactNode } from "react";

/** Plain text only: session content never becomes HTML. Bound highlights even
 * for a one-character search in a long tool output. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const needle = query.trim().toLowerCase();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  for (let n = 0; n < 200; n++) {
    const index = lower.indexOf(needle, start);
    if (index < 0) break;
    parts.push(text.slice(start, index), <mark key={index}>{text.slice(index, index + needle.length)}</mark>);
    start = index + needle.length;
  }
  parts.push(text.slice(start));
  return <>{parts}</>;
}
