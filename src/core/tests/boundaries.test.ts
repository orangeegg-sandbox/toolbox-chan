import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const sourceRoot = resolve(import.meta.dirname, "../..");
const toolsRoot = join(sourceRoot, "tools");
function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(directory, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
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
    .map((name) => resolve(dirname(file), name));
}

it("keeps core independent of tool implementations and tools independent of siblings", () => {
  const violations: string[] = [];
  for (const file of files(join(sourceRoot, "core"))) {
    for (const dependency of dependencies(file))
      if (dependency.startsWith(toolsRoot + sep))
        violations.push(
          `${relative(sourceRoot, file)} imports ${relative(sourceRoot, dependency)}`,
        );
  }
  for (const entry of readdirSync(toolsRoot, { withFileTypes: true }).filter(
    (entry) => entry.isDirectory(),
  )) {
    for (const file of files(join(toolsRoot, entry.name))) {
      for (const dependency of dependencies(file)) {
        if (
          dependency.startsWith(toolsRoot + sep) &&
          relative(toolsRoot, dependency).split(sep)[0] !== entry.name
        )
          violations.push(
            `${relative(sourceRoot, file)} imports a sibling tool`,
          );
      }
    }
  }
  expect(violations).toEqual([]);
});
