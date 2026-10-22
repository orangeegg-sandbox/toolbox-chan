import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "../..");
const coreRoot = join(sourceRoot, "core");
const coreSdk = join(coreRoot, "sdk");
const toolsRoot = join(sourceRoot, "tools");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.(ts|tsx|mjs)$/.test(entry.name)
        ? [join(directory, entry.name)]
        : [],
  );
}
function dependencies(file: string): string[] {
  const source = ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
  const imports: string[] = [];
  function visit(node: ts.Node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    )
      imports.push(node.moduleSpecifier.text);
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    )
      imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  return imports
    .filter((name) => name.startsWith("."))
    .map((name) => resolve(dirname(file), name).replace(/\.(ts|tsx)$/, ""));
}

it("keeps core independent of tool implementations and tools independent of siblings", () => {
  const violations: string[] = [];
  for (const file of files(coreRoot)) {
    for (const dependency of dependencies(file))
      if (dependency.startsWith(toolsRoot + sep))
        violations.push(
          `${relative(sourceRoot, file)} imports ${relative(sourceRoot, dependency)}`,
        );
  }
  for (const file of files(toolsRoot)) {
    // The registry (tools/index.ts) is the one file that may import every tool.
    const [owner, ...rest] = relative(toolsRoot, file).split(sep);
    for (const dependency of dependencies(file)) {
      if (
        rest.length &&
        dependency.startsWith(toolsRoot + sep) &&
        relative(toolsRoot, dependency).split(sep)[0] !== owner
      )
        violations.push(
          `${relative(sourceRoot, file)} imports a sibling tool`,
        );
      if (dependency.startsWith(coreRoot + sep) && dependency !== coreSdk)
        violations.push(
          `${relative(sourceRoot, file)} imports ${relative(sourceRoot, dependency)}; use core/sdk`,
        );
    }
  }
  expect(violations).toEqual([]);
});
