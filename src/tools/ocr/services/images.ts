import type { SourceImage } from "../types";
import type { Region } from "../types";

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_PIXELS = 32_000_000;
export function validateImage(file: Pick<File, "type" | "size">) {
  if (
    ![
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/bmp",
      "image/gif",
    ].includes(file.type)
  )
    throw new Error(
      "Choose a PNG, JPG, WebP, BMP, or GIF image. For PDFs, export a page as an image first.",
    );
  if (file.size > MAX_IMAGE_BYTES)
    throw new Error(
      "This image is too large. Please choose an image smaller than 25 MB.",
    );
  if (file.size === 0)
    throw new Error("This image is empty. Please choose another image.");
}
export async function readImage(file: File): Promise<SourceImage> {
  validateImage(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error(
        "This image could not be opened. Please try another image.",
      );
    if (image.naturalWidth * image.naturalHeight > MAX_IMAGE_PIXELS)
      throw new Error(
        "This image has too many pixels. Please resize it below 32 megapixels.",
      );
    return {
      name: file.name,
      url,
      width: image.naturalWidth,
      height: image.naturalHeight,
      bytes: file.size,
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error instanceof Error
      ? error
      : new Error("This image could not be opened.");
  }
}

export async function sampleImage(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 1440;
  canvas.height = 920;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#6a57c8";
  ctx.fillRect(100, 100, 60, 8);
  ctx.fillStyle = "#20222a";
  ctx.font = "bold 64px Arial";
  ctx.fillText("A little less busywork.", 100, 225);
  ctx.font = "34px Arial";
  [
    "A little more time for what matters.",
    "",
    "Your ideas deserve more than a screenshot.",
    "Turn images into editable text, right on your device.",
    "",
    "No uploads. No accounts. Just your little toolbox.",
  ].forEach((line, i) => ctx.fillText(line, 100, 335 + i * 64));
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(
              new File([blob], "a-little-less-busywork.png", {
                type: "image/png",
              }),
            )
          : reject(new Error("Could not create sample image.")),
      "image/png",
    ),
  );
}

export async function prepareImage(
  source: SourceImage,
  rotation: number,
): Promise<HTMLCanvasElement> {
  const image = new Image();
  image.src = source.url;
  await image.decode();
  const quarterTurn = Math.abs(rotation % 180) === 90;
  const w = quarterTurn ? source.height : source.width;
  const h = quarterTurn ? source.width : source.height;
  // Upscale small screenshots; bound memory and processing time on large images.
  const scale = Math.min(
    Math.max(1, 1400 / Math.max(w, h)),
    3400 / Math.max(w, h),
  );
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * scale);
  canvas.height = Math.round(h * scale);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.drawImage(
    image,
    (-source.width * scale) / 2,
    (-source.height * scale) / 2,
    source.width * scale,
    source.height * scale,
  );
  return canvas;
}

export function cropImage(
  canvas: HTMLCanvasElement,
  region: Region,
): HTMLCanvasElement {
  const left = Math.max(0, Math.floor(region.x * canvas.width));
  const top = Math.max(0, Math.floor(region.y * canvas.height));
  const width = Math.min(
    canvas.width - left,
    Math.max(1, Math.ceil(region.width * canvas.width)),
  );
  const height = Math.min(
    canvas.height - top,
    Math.max(1, Math.ceil(region.height * canvas.height)),
  );
  const crop = document.createElement("canvas");
  crop.width = width;
  crop.height = height;
  crop
    .getContext("2d")!
    .drawImage(canvas, left, top, width, height, 0, 0, width, height);
  return crop;
}

export async function rotatedImage(source: SourceImage): Promise<File> {
  const canvas = await prepareImage(source, 90);
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(
              new File([blob], source.name.replace(/\.[^.]+$/, "") + ".png", {
                type: "image/png",
              }),
            )
          : reject(new Error("Could not rotate this image.")),
      "image/png",
    ),
  );
}
