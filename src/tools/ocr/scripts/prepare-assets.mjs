import {
  mkdir,
  copyFile,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";

// All OCR runtime code and models are copied into the application. No CDN at runtime.
const require = createRequire(import.meta.url);
const root = resolve(import.meta.dirname, "../../../..");
const destination = join(root, "public", "tools", "ocr");
const packageRoot = (name) => dirname(require.resolve(`${name}/package.json`));
await mkdir(join(destination, "core"), { recursive: true });
await mkdir(join(destination, "lang"), { recursive: true });
const assets = [];
async function copy(source, relative) {
  const target = join(destination, relative);
  await copyFile(source, target);
  const data = await readFile(target);
  assets.push({
    path: relative.replaceAll("\\", "/"),
    bytes: data.length,
    sha256: createHash("sha256").update(data).digest("hex"),
  });
}
await copy(
  join(packageRoot("tesseract.js"), "dist", "worker.min.js"),
  "worker.min.js",
);
const core = packageRoot("tesseract.js-core");
for (const name of await readdir(core)) {
  if (/^tesseract-core.*\.(wasm|js)$/.test(name))
    await copy(join(core, name), join("core", name));
}
for (const language of ["eng", "chi_sim", "chi_tra"]) {
  const data = packageRoot(`@tesseract.js-data/${language}`);
  // Integer LSTM models balance download size and accuracy; supplied by the official project.
  await copy(
    join(data, "4.0.0_best_int", `${language}.traineddata.gz`),
    join("lang", `${language}.traineddata.gz`),
  );
  await copy(join(core, "LICENSE"), `LICENSE-${language}.txt`);
}
await copy(
  join(packageRoot("tesseract.js"), "LICENSE.md"),
  "LICENSE-tesseract.txt",
);
await copy(join(core, "LICENSE"), "LICENSE-core.txt");
await writeFile(
  join(destination, "manifest.json"),
  JSON.stringify({ engine: "Tesseract.js", assets }, null, 2),
);
console.log(
  `Prepared ${assets.length} offline OCR assets (${(assets.reduce((sum, a) => sum + a.bytes, 0) / 1024 / 1024).toFixed(1)} MB).`,
);
