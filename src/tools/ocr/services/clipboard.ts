import { isTauri } from "@tauri-apps/api/core";
import { readImage } from "@tauri-apps/plugin-clipboard-manager";
export async function clipboardImage(): Promise<File> {
  if (isTauri()) {
    const image = await readImage();
    try {
      const { width, height } = await image.size();
      if (width * height > 32_000_000)
        throw new Error(
          "Clipboard image is too large. Please resize it below 32 megapixels.",
        );
      const rgba = await image.rgba();
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas
        .getContext("2d")!
        .putImageData(
          new ImageData(new Uint8ClampedArray(rgba), width, height),
          0,
          0,
        );
      return await new Promise((resolve, reject) =>
        canvas.toBlob(
          (blob) =>
            blob
              ? resolve(
                  new File([blob], "clipboard-image.png", {
                    type: "image/png",
                  }),
                )
              : reject(new Error("Could not paste this image.")),
          "image/png",
        ),
      );
    } finally {
      await image.close();
    }
  }
  if (!navigator.clipboard?.read)
    throw new Error(
      "Press Ctrl+V (⌘V on Mac) to paste an image, or choose a file.",
    );
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (type)
      return new File([await item.getType(type)], "clipboard-image.png", {
        type,
      });
  }
  throw new Error(
    "No image found on the clipboard. Copy an image or take a screenshot first.",
  );
}
