import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const env = { ...process.env };
const localCargo = join(root, ".tools", "cargo");
if (
  existsSync(
    join(
      localCargo,
      "bin",
      process.platform === "win32" ? "cargo.exe" : "cargo",
    ),
  )
) {
  env.CARGO_HOME = localCargo;
  env.RUSTUP_HOME = join(root, ".tools", "rustup");
  env.PATH = `${join(localCargo, "bin")}${process.platform === "win32" ? ";" : ":"}${env.PATH ?? ""}`;
}
// Some Windows installations contain the C++ compiler without exposing its environment.
if (process.platform === "win32" && !env.VCINSTALLDIR) {
  const candidates = [
    "Community",
    "Professional",
    "Enterprise",
    "BuildTools",
  ].flatMap((edition) => [
    join(
      env.ProgramFiles ?? "C:\\Program Files",
      "Microsoft Visual Studio",
      "2022",
      edition,
      "VC",
      "Auxiliary",
      "Build",
      "vcvars64.bat",
    ),
    join(
      env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)",
      "Microsoft Visual Studio",
      "2022",
      edition,
      "VC",
      "Auxiliary",
      "Build",
      "vcvars64.bat",
    ),
  ]);
  const compiler = candidates.find(existsSync);
  if (compiler) {
    const setup = spawnSync(
      env.ComSpec ?? "cmd.exe",
      ["/d", "/s", "/c", `""${compiler}" >nul && set"`],
      { env, encoding: "utf8", windowsHide: true },
    );
    if (setup.status === 0)
      for (const line of setup.stdout.split(/\r?\n/)) {
        const split = line.indexOf("=");
        if (split > 0) {
          const key = line.slice(0, split);
          const existing = Object.keys(env).find(
            (name) => name.toLowerCase() === key.toLowerCase(),
          );
          if (existing) delete env[existing];
          env[key] = line.slice(split + 1);
        }
      }
  }
}
const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
const systemPath = pathKeys
  .map((key) => env[key])
  .filter(Boolean)
  .join(process.platform === "win32" ? ";" : ":");
for (const key of pathKeys) delete env[key];
env[process.platform === "win32" ? "Path" : "PATH"] = [
  dirname(process.execPath),
  ...(existsSync(join(localCargo, "bin")) ? [join(localCargo, "bin")] : []),
  systemPath,
].join(process.platform === "win32" ? ";" : ":");
const rustTest = process.argv[2] === "--test-rust";
const child = spawn(
  rustTest ? "cargo" : process.execPath,
  rustTest
    ? [
        "test",
        "--release",
        "--manifest-path",
        join(root, "src-tauri", "Cargo.toml"),
        "--lib",
      ]
    : [
        join(root, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        ...process.argv.slice(2),
      ],
  { cwd: root, env, stdio: "inherit", windowsHide: true },
);
child.on("exit", (code) => process.exit(code ?? 1));
child.on("error", (error) => {
  console.error(error.message);
  process.exit(1);
});
