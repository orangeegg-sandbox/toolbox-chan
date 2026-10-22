import { useRef } from "react";
import { useToolCommands } from "../../core/sdk";
import { useOcr } from "./OcrProvider";
import { OcrCommandHandler } from "./OcrCommandHandler";

const handler = new OcrCommandHandler();

export function OcrCommands() {
  const ocr = useOcr();
  const input = useRef<HTMLInputElement>(null);
  useToolCommands(handler, { ...ocr, openImage: () => input.current?.click() });
  return <input ref={input} type="file" className="sr-only" tabIndex={-1} aria-label="Choose image from command palette" accept="image/png,image/jpeg,image/webp,image/bmp,image/gif" onChange={(event) => {
    const file = event.target.files?.[0];
    if (file) void ocr.loadFile(file);
    event.target.value = "";
  }} />;
}
