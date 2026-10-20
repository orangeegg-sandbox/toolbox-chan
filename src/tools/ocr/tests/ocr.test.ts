import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_IMAGE_BYTES, validateImage } from "../services/images";
import {
  clearStoredHistory,
  loadHistory,
  loadPreferences,
  saveHistory,
  savePreferences,
} from "../storage";
import { recognizeOnline, validateEndpoint } from "../services/online";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("image input boundaries", () => {
  it("accepts the supported raster types and rejects empty, huge, PDF, and SVG inputs", () => {
    for (const type of [
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/bmp",
      "image/gif",
    ])
      expect(() => validateImage({ type, size: 100 })).not.toThrow();
    for (const file of [
      { type: "image/png", size: 0 },
      { type: "image/png", size: MAX_IMAGE_BYTES + 1 },
      { type: "application/pdf", size: 100 },
      { type: "image/svg+xml", size: 100 },
    ])
      expect(() => validateImage(file)).toThrow();
  });
});
describe("local persistence", () => {
  it("restores settings and ignores invalid fields from an older or corrupted store", () => {
    savePreferences({
      language: "eng+chi_tra",
      layout: "sparse",
      autoCopy: true,
      keepHistory: false,
    });
    expect(loadPreferences()).toEqual({
      language: "eng+chi_tra",
      layout: "sparse",
      autoCopy: true,
      keepHistory: false,
    });
    localStorage.setItem(
      "little-toolbox.preferences.v1",
      '{"language":"bad","keepHistory":"false","layout":"bad"}',
    );
    expect(loadPreferences()).toEqual({
      language: "eng",
      layout: "auto",
      autoCopy: false,
      keepHistory: true,
    });
    localStorage.setItem("little-toolbox.preferences.v1", "null");
    expect(loadPreferences().language).toBe("eng");
  });
  it("caps history, excludes invalid records, and supports deletion", () => {
    const entries = Array.from({ length: 25 }, (_, i) => ({
      id: String(i),
      name: "test.png",
      text: "Hello",
      language: "eng" as const,
      createdAt: Date.now(),
      duration: 1,
      confidence: 98,
    }));
    saveHistory(entries);
    expect(loadHistory()).toHaveLength(20);
    localStorage.setItem(
      "little-toolbox.history.v1",
      '[{}, {"text":"partial"}]',
    );
    expect(loadHistory()).toEqual([]);
    saveHistory(entries);
    clearStoredHistory();
    expect(loadHistory()).toEqual([]);
  });
  it("recovers safely from malformed JSON and unavailable storage", () => {
    localStorage.setItem("little-toolbox.history.v1", "broken");
    expect(loadHistory()).toEqual([]);
    vi.stubGlobal("localStorage", {
      getItem() {
        throw new Error("Denied");
      },
    });
    expect(loadHistory()).toEqual([]);
    expect(loadPreferences().keepHistory).toBe(true);
  });
});
describe("online provider adapter", () => {
  it("allows HTTPS and local HTTP but rejects unsafe URLs and embedded credentials", () => {
    expect(validateEndpoint("https://api.openai.com/v1/")).toBe(
      "https://api.openai.com/v1/chat/completions",
    );
    expect(validateEndpoint("http://localhost:1234/v1")).toBe(
      "http://localhost:1234/v1/chat/completions",
    );
    for (const url of [
      "invalid",
      "http://provider.example/v1",
      "file:///image.png",
      "https://user:secret@example.com/v1",
      "https://example.com/v1?api_key=secret",
      "https://example.com/v1#key",
    ])
      expect(() => validateEndpoint(url)).toThrow();
  });
  it("sends a vision request to the configured provider and parses its text", async () => {
    vi.stubGlobal("window", {});
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [
          { message: { content: "Hello 中文" }, finish_reason: "stop" },
        ],
      }),
    });
    vi.stubGlobal("fetch", fetch);
    const canvas = {
      toDataURL: () => "data:image/png;base64,dGVzdA==",
    } as HTMLCanvasElement;
    const config = {
      endpoint: "https://provider.example/v1",
      model: "vision-model",
      apiKey: "session-secret",
    };
    const result = await recognizeOnline(
      canvas,
      config,
      "eng+chi_tra",
      new AbortController().signal,
    );
    expect(result.text).toBe("Hello 中文");
    expect(fetch.mock.calls[0][0]).toBe(
      "https://provider.example/v1/chat/completions",
    );
    const request = fetch.mock.calls[0][1];
    expect(request.headers.Authorization).toBe("Bearer session-secret");
    expect(JSON.parse(request.body).messages[1].content[1].image_url.url).toBe(
      canvas.toDataURL(),
    );
  });
  it("reports provider errors and truncated responses without treating them as completed OCR", async () => {
    vi.stubGlobal("window", {});
    const canvas = {
      toDataURL: () => "data:image/png;base64,dGVzdA==",
    } as HTMLCanvasElement;
    const config = {
      endpoint: "https://provider.example/v1",
      model: "vision-model",
      apiKey: "",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401 }),
    );
    await expect(
      recognizeOnline(canvas, config, "eng", new AbortController().signal),
    ).rejects.toThrow("401");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [
            { message: { content: "Partial" }, finish_reason: "length" },
          ],
        }),
      }),
    );
    await expect(
      recognizeOnline(canvas, config, "eng", new AbortController().signal),
    ).rejects.toThrow("cut the text short");
  });
});
