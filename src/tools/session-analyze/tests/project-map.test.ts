import { describe, expect, it } from "vitest";
import type { ProjectCoverage } from "../types";
import { buildProjectTree, directorySummary, filterProjectTree, projectBreadcrumbs, projectMapRectangles, projectTreeRows, searchProjectTree } from "../project-map";

type Inventory = Pick<ProjectCoverage, "project" | "entries" | "readFiles" | "writtenFiles">;
const file = (path: string): ProjectCoverage["entries"][number] => ({ path, kind: "file", excluded: false });
const directory = (path: string, excluded = false): ProjectCoverage["entries"][number] => ({ path, kind: "directory", excluded });
const inventory = (entries: Inventory["entries"], readFiles: string[] = [], writtenFiles: string[] = []): Inventory => ({ project: "D:/work/demo", entries, readFiles, writtenFiles });

describe("whole-project inventory tree", () => {
  it("retains untouched files, deduplicates paths and operations, and aggregates disjoint activity", () => {
    const tree = buildProjectTree(inventory([
      file("src/read.ts"), file("src/both.ts"), file("src/both.ts"), file("src/write.ts"),
      file("src/untouched.ts"), file("docs/untouched.md"),
    ], ["src/read.ts", "src\\read.ts", "src/both.ts", "not-in-inventory.ts"], ["src/both.ts", "src/write.ts", "src/write.ts"]));
    expect(tree.root.counts).toEqual({ files: 5, directories: 2, read: 1, write: 1, both: 1, untouched: 2, excluded: 0 });
    expect(tree.nodes.get("src")?.counts).toEqual({ files: 4, directories: 1, read: 1, write: 1, both: 1, untouched: 1, excluded: 0 });
    expect(tree.nodes.get("src/both.ts")?.state).toBe("both");
    expect(tree.nodes.get("docs/untouched.md")?.state).toBe("untouched");
    expect(tree.paths).toHaveLength(7);
    expect(directorySummary(tree.root)).toContain("2 read · 2 written · 2 untouched");
  });

  it("preserves empty and excluded directory placeholders without treating their contents as inventoried", () => {
    const tree = buildProjectTree(inventory([
      directory("empty"), directory("node_modules", true),
      { ...file("external-link.ts"), excluded: true }, file("source.ts"),
    ], ["node_modules/hidden.ts", "external-link.ts"]));
    expect(tree.root.counts.files).toBe(1);
    expect(tree.root.counts.directories).toBe(2);
    expect(tree.root.counts.excluded).toBe(2);
    expect(tree.root.counts.read).toBe(0);
    expect(tree.nodes.get("empty")?.children).toEqual([]);
    expect(tree.paths).toContain("node_modules");
    expect(tree.paths).not.toContain("node_modules/hidden.ts");
    expect(projectTreeRows(tree, "node_modules", new Set(["node_modules"]))).toEqual({ rows: [], total: 0 });
    expect(directorySummary(tree.nodes.get("node_modules")!)).toBe("Excluded; contents not scanned");
  });

  it("retains valid children of a partially listed directory marked excluded by the scanner", () => {
    const tree = buildProjectTree(inventory([
      directory("src", true), file("src/collected.ts"), directory("src/child", true),
      file("src/child/untouched.ts"), directory("src/not-listed", true),
    ], ["src/collected.ts"]));
    expect(tree.root.counts.files).toBe(2);
    expect(tree.root.counts.read).toBe(1);
    expect(tree.root.counts.untouched).toBe(1);
    expect(tree.root.counts.excluded).toBe(1);
    expect(tree.nodes.get("src")).toMatchObject({ excluded: false, partial: true });
    expect(tree.root.partial).toBe(true);
    expect(searchProjectTree(tree, "untouched").rows[0].node.path).toBe("src/child/untouched.ts");
    expect(projectTreeRows(tree, "src", new Set(["src/child"])).rows.map(({ node }) => node.path))
      .toEqual(["src/child", "src/child/untouched.ts", "src/not-listed", "src/collected.ts"]);
    expect(directorySummary(tree.nodes.get("src")!)).toContain("partially scanned");
  });

  it("drills into folders, expands descendants, and returns the correct breadcrumb ancestry", () => {
    const tree = buildProjectTree(inventory([file("src/lib/a.ts"), file("src/b.ts"), file("README.md"), directory("empty")]));
    expect(projectTreeRows(tree, "", new Set()).rows.map(({ node }) => node.path)).toEqual(["empty", "src", "README.md"]);
    const expanded = projectTreeRows(tree, "", new Set(["src", "src/lib"]));
    expect(expanded.rows.map(({ node, depth }) => [node.path, depth])).toEqual([
      ["empty", 0], ["src", 0], ["src/lib", 1], ["src/lib/a.ts", 2], ["src/b.ts", 1], ["README.md", 0],
    ]);
    expect(projectTreeRows(tree, "src/lib", new Set()).rows.map(({ node }) => node.path)).toEqual(["src/lib/a.ts"]);
    expect(projectBreadcrumbs(tree, "src/lib").map((node) => node.path)).toEqual(["", "src", "src/lib"]);
    expect(projectBreadcrumbs(tree, "removed/path").map((node) => node.path)).toEqual([""]);
  });

  it("searches the full inventory independently of expansion or the current folder", () => {
    const tree = buildProjectTree(inventory([file("src/README.md"), file("docs/README.md"), file("docs/guide.md")]));
    expect(searchProjectTree(tree, " readme ").rows.map(({ node }) => node.path)).toEqual(["docs/README.md", "src/README.md"]);
    expect(searchProjectTree(tree, "README")).toMatchObject({ rows: [{ node: { path: "docs/README.md" } }, { node: { path: "src/README.md" } }], total: 2 });
    expect(searchProjectTree(tree, "missing")).toEqual({ rows: [], total: 0 });
  });

  it("does not put absolute, parent-traversing, or invalid paths inside the project", () => {
    const tree = buildProjectTree(inventory([
      file("../outside.ts"), file("/root/file.ts"), file("C:/elsewhere.ts"), file("bad\0name"),
      file("src/../../outside.ts"), file("./src//valid.ts"),
    ]));
    expect(tree.omitted).toBe(5);
    expect(tree.root.counts.files).toBe(1);
    expect(tree.paths).toEqual(["src", "src/valid.ts"]);
  });

  it("makes every expanded or matching row available in a 100,000-file snapshot", () => {
    const entries = Array.from({ length: 100_000 }, (_, index) => file(`folder-${Math.floor(index / 1000)}/file-${index}.ts`));
    const tree = buildProjectTree(inventory(entries));
    expect(tree.root.counts.files).toBe(100_000);
    expect(tree.paths).toHaveLength(100_100);
    const expanded = new Set(tree.root.children);
    const rows = projectTreeRows(tree, "", expanded);
    expect(rows.total).toBe(100_100);
    expect(rows.rows).toHaveLength(100_100);
    expect(rows.rows.at(-1)?.node.path).toBe("folder-99/file-99999.ts");
    expect(projectTreeRows(tree, "folder-99", new Set()).rows).toHaveLength(1000);
    expect(searchProjectTree(tree, "file-99999").rows[0].node.path).toBe("folder-99/file-99999.ts");
    const matches = searchProjectTree(tree, "file-");
    expect(matches.total).toBe(100_000);
    expect(matches.rows).toHaveLength(100_000);
    expect(matches.rows.at(-1)?.node.path).toBe("folder-99/file-99999.ts");
  });

  it("handles deep paths iteratively without dropping ancestry", () => {
    const folder = Array.from({ length: 1_000 }, (_, index) => `d${index}`).join("/");
    const tree = buildProjectTree(inventory([file(`${folder}/leaf.ts`)]));
    expect(tree.root.counts.files).toBe(1);
    expect(tree.root.counts.directories).toBe(1_000);
    expect(projectBreadcrumbs(tree, folder)).toHaveLength(1_001);
    const rows = projectTreeRows(tree, "", new Set(tree.paths));
    expect(rows.total).toBe(1_001);
    expect(rows.rows.at(-1)).toMatchObject({ node: { path: `${folder}/leaf.ts` }, depth: 1_000 });
  });
});

describe("structure activity filtering", () => {
  const mixed = () => buildProjectTree(inventory([
    file("src/nested/read.ts"), file("src/nested/both.ts"), file("src/write.ts"), file("src/untouched.ts"),
    file("docs/guide.md"), directory("empty"), directory("vendor", true),
    directory("src/unlisted", true), { ...file("linked-file.ts"), excluded: true },
  ], ["src/nested/read.ts", "src/nested/both.ts"], ["src/nested/both.ts", "src/write.ts"]));

  it.each([
    ["touched", ["src/nested/both.ts", "src/nested/read.ts", "src/write.ts"]],
    ["read", ["src/nested/both.ts", "src/nested/read.ts"]],
    ["written", ["src/nested/both.ts", "src/write.ts"]],
    ["untouched", ["docs/guide.md", "src/untouched.ts"]],
  ] as const)("retains ancestors and recounts the %s subset", (activity, expectedFiles) => {
    const filtered = filterProjectTree(mixed(), activity);
    expect(filtered.paths.filter((path) => filtered.nodes.get(path)!.kind === "file")).toEqual(expectedFiles);
    expect(filtered.root.counts.files).toBe(expectedFiles.length);
    expect(filtered.paths).not.toContain("empty");
    expect(filtered.paths).not.toContain("vendor");
    for (const path of expectedFiles) {
      for (const parent of projectBreadcrumbs(filtered, path).slice(0, -1)) {
        expect(parent.kind).toBe("directory");
        expect(filtered.nodes.has(parent.path)).toBe(true);
      }
    }
    expect(projectTreeRows(filtered, "", new Set(filtered.paths)).total).toBe(filtered.paths.length);
    expect(searchProjectTree(filtered, "nested").rows.every(({ node }) => node.path.startsWith("src/nested"))).toBe(true);
  });

  it("keeps excluded placeholders with their ancestors and never invents inventoried files", () => {
    const filtered = filterProjectTree(mixed(), "excluded");
    expect(filtered.paths).toEqual(["src", "src/unlisted", "vendor", "linked-file.ts"]);
    expect(filtered.root.counts).toEqual({ files: 0, directories: 3, read: 0, write: 0, both: 0, untouched: 0, excluded: 3 });
    expect(filtered.nodes.get("src")!.children).toEqual(["src/unlisted"]);
    expect(projectTreeRows(filtered, "vendor", new Set()).rows).toEqual([]);
  });

  it("preserves the original tree and resets to the full inventory", () => {
    const original = mixed();
    const before = JSON.stringify([...original.nodes]);
    const filtered = filterProjectTree(original, "touched");
    expect(filtered.root).not.toBe(original.root);
    expect(filtered.nodes.get("src")!.children).not.toBe(original.nodes.get("src")!.children);
    expect(filtered.nodes.get("src")!.counts).not.toBe(original.nodes.get("src")!.counts);
    expect(JSON.stringify([...original.nodes])).toBe(before);
    expect(filterProjectTree(original, "all")).toBe(original);
    expect(original.root.counts.files).toBe(5);
    expect(original.paths).toContain("empty");
  });

  it("returns an empty root when no files match and retains deep ancestry without recursion", () => {
    const folder = Array.from({ length: 1000 }, (_, index) => `d${index}`).join("/");
    const original = buildProjectTree(inventory([file(`${folder}/leaf.ts`)], [`${folder}/leaf.ts`]));
    const empty = filterProjectTree(original, "written");
    expect(empty.paths).toEqual([]);
    expect(empty.root.children).toEqual([]);
    expect(empty.root.counts.files).toBe(0);
    const read = filterProjectTree(original, "read");
    expect(read.paths).toHaveLength(1001);
    expect(read.root.counts.files).toBe(1);
    expect(projectBreadcrumbs(read, folder)).toHaveLength(1001);
  });
});

describe("folder map layout", () => {
  it("covers the map without overlaps and keeps empty or tiny entries selectable", () => {
    const rectangles = projectMapRectangles([100_000, 200, 1, 0, 0, 30, 12, 2, 1, 1, 1, 1]);
    expect(rectangles).toHaveLength(12);
    expect(rectangles.reduce((area, rect) => area + rect.width * rect.height, 0)).toBeCloseTo(10_000);
    for (let i = 0; i < rectangles.length; i++) {
      const a = rectangles[i];
      expect(a.width).toBeGreaterThan(0);
      expect(a.height).toBeGreaterThan(0);
      expect(a.x + a.width).toBeLessThanOrEqual(100.000001);
      expect(a.y + a.height).toBeLessThanOrEqual(100.000001);
      for (let j = i + 1; j < rectangles.length; j++) {
        const b = rectangles[j];
        const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
        const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        expect(overlapWidth <= 0.000001 || overlapHeight <= 0.000001).toBe(true);
      }
    }
  });

  it("handles empty and single-entry folders", () => {
    expect(projectMapRectangles([])).toEqual([]);
    expect(projectMapRectangles([0])).toEqual([{ x: 0, y: 0, width: 100, height: 100 }]);
  });
});
