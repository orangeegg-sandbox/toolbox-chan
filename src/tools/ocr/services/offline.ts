import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import type { Language, Layout, OcrWord } from "../types";

export class OcrCancelled extends Error {
  constructor() {
    super("Recognition cancelled.");
  }
}
export interface OcrProgress {
  progress: number;
  status: string;
}

// One warm worker for repeated actions; a cancelled/reconfigured worker is released.
export class OcrEngine {
  private worker: Worker | null = null;
  private language: Language | null = null;
  private generation = 0;
  private workerEpoch = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private rejectJob: ((error: Error) => void) | null = null;
  private report: ((progress: OcrProgress) => void) | null = null;

  async recognize(
    image: HTMLCanvasElement,
    language: Language,
    layout: Layout,
    onProgress: (p: OcrProgress) => void,
  ) {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    const token = ++this.generation;
    this.report = onProgress;
    const abort = new Promise<never>((_, reject) => {
      this.rejectJob = reject;
    });
    const operation = async () => {
      if (this.worker && this.language !== language) {
        await this.worker.terminate();
        this.worker = null;
      }
      if (token !== this.generation) throw new OcrCancelled();
      if (!this.worker) {
        const epoch = ++this.workerEpoch;
        onProgress({ progress: 0.03, status: "Starting the offline engine…" });
        const base = new URL("./tools/ocr/", document.baseURI).href;
        const worker = await createWorker(language, OEM.LSTM_ONLY, {
          workerPath: `${base}worker.min.js`,
          corePath: `${base}core`,
          langPath: `${base}lang`,
          workerBlobURL: true,
          logger: (message) => {
            if (epoch !== this.workerEpoch) return;
            const reading = message.status === "recognizing text";
            this.report?.({
              progress: reading
                ? 0.22 + message.progress * 0.77
                : Math.min(0.21, 0.04 + message.progress * 0.17),
              status: reading
                ? "Reading your image…"
                : "Preparing language models…",
            });
          },
          errorHandler: (error) => {
            if (epoch === this.workerEpoch)
              this.rejectJob?.(new Error(String(error)));
          },
        });
        if (token !== this.generation) {
          await worker.terminate();
          throw new OcrCancelled();
        }
        this.worker = worker;
        this.language = language;
      }
      await this.worker.setParameters({
        tessedit_pageseg_mode:
          layout === "sparse"
            ? PSM.SPARSE_TEXT
            : layout === "block"
              ? PSM.SINGLE_BLOCK
              : PSM.AUTO,
        preserve_interword_spaces: "1",
      });
      const { data } = await this.worker.recognize(
        image,
        {},
        { text: true, blocks: true },
      );
      if (token !== this.generation) throw new OcrCancelled();
      const words: OcrWord[] = (data.blocks ?? []).flatMap((block) =>
        block.paragraphs.flatMap((paragraph) =>
          paragraph.lines.flatMap((line) =>
            line.words.map((word) => ({
              text: word.text,
              confidence: word.confidence,
              x: word.bbox.x0 / image.width,
              y: word.bbox.y0 / image.height,
              width: (word.bbox.x1 - word.bbox.x0) / image.width,
              height: (word.bbox.y1 - word.bbox.y0) / image.height,
            })),
          ),
        ),
      );
      return { text: data.text.trim(), confidence: data.confidence, words };
    };
    try {
      return await Promise.race([operation(), abort]);
    } catch (error) {
      if (token === this.generation) this.cancel();
      throw error;
    } finally {
      if (token === this.generation) {
        this.rejectJob = null;
        this.report = null;
        this.idleTimer = setTimeout(() => this.cancel(), 60_000);
      }
    }
  }

  cancel() {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
    this.generation++;
    this.workerEpoch++;
    this.rejectJob?.(new OcrCancelled());
    this.rejectJob = null;
    this.report = null;
    const worker = this.worker;
    this.worker = null;
    this.language = null;
    if (worker) void worker.terminate().catch(() => {});
  }
}
