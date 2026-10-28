import type { ProjectCoverage } from "./types";

export type FileState = "read" | "write" | "both" | "untouched" | "excluded";
export type StructureActivity = "all" | "touched" | "read" | "written" | "untouched" | "excluded";
export interface FolderCounts {
  files: number;
  directories: number;
  read: number;
  write: number;
  both: number;
  untouched: number;
  excluded: number;
}
export interface ProjectNode {
  path: string;
  name: string;
  parent: string | null;
  kind: "file" | "directory";
  excluded: boolean;
  partial: boolean;
  state: FileState;
  children: string[];
  counts: FolderCounts;
}
export interface ProjectTree {
  nodes: Map<string, ProjectNode>;
  root: ProjectNode;
  paths: string[];
  omitted: number;
}
export interface TreeRow { node: ProjectNode; depth: number }
export interface TreeRows { rows: TreeRow[]; total: number }
export interface MapRectangle { x: number; y: number; width: number; height: number }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
const emptyCounts = (): FolderCounts => ({ files: 0, directories: 0, read: 0, write: 0, both: 0, untouched: 0, excluded: 0 });

/** Inventory paths are relative; rejecting traversal also avoids misleading root membership. */
function relativePath(value: string): string | null {
  const path = value.replace(/\\/g, "/");
  if (path.startsWith("/") || /^[a-z]:/i.test(path) || path.includes("\0")) return null;
  const parts = path.split("/").filter((part) => part && part !== ".");
  if (parts.includes("..")) return null;
  return parts.join("/");
}

/** Every inventory entry is retained, including untouched files and empty/excluded directories. */
export function buildProjectTree(coverage: Pick<ProjectCoverage, "project" | "entries" | "readFiles" | "writtenFiles">): ProjectTree {
  const root: ProjectNode = {
    path: "", name: coverage.project.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) || coverage.project,
    parent: null, kind: "directory", excluded: false, partial: false, state: "untouched", children: [], counts: emptyCounts(),
  };
  const nodes = new Map<string, ProjectNode>([["", root]]);
  const insertion: ProjectNode[] = [root];
  let omitted = 0;
  for (const entry of coverage.entries) {
    const path = relativePath(entry.path);
    if (!path) { omitted++; continue; }
    let parent = root;
    const parts = path.split("/");
    let current = "";
    for (let i = 0; i < parts.length; i++) {
      current = current ? `${current}/${parts[i]}` : parts[i];
      let node = nodes.get(current);
      if (!node) {
        node = {
          path: current, name: parts[i], parent: parent.path,
          kind: i === parts.length - 1 ? entry.kind : "directory",
          excluded: false, partial: false, state: "untouched", children: [], counts: emptyCounts(),
        };
        nodes.set(current, node);
        insertion.push(node);
        parent.children.push(current);
      }
      if (i < parts.length - 1 || entry.kind === "directory") node.kind = "directory";
      if (i === parts.length - 1) node.excluded ||= entry.excluded;
      parent = node;
    }
  }
  const reads = new Set(coverage.readFiles.map(relativePath).filter((path): path is string => path !== null));
  const writes = new Set(coverage.writtenFiles.map(relativePath).filter((path): path is string => path !== null));
  // Parents are created before their descendants. Iteration avoids recursion on deep paths.
  for (let i = insertion.length - 1; i >= 0; i--) {
    const node = insertion[i];
    // A limit or read_dir error may mark a directory excluded after collecting
    // valid children. Preserve that partial inventory rather than hiding it.
    if (node.kind === "directory" && node.excluded && node.children.length > 0) {
      node.excluded = false;
      node.partial = true;
    }
    if (node.excluded) {
      node.counts = { ...emptyCounts(), directories: node.kind === "directory" ? 1 : 0, excluded: 1 };
      node.state = "excluded";
    } else if (node.kind === "file") {
      node.state = reads.has(node.path) ? (writes.has(node.path) ? "both" : "read") : (writes.has(node.path) ? "write" : "untouched");
      node.counts.files = 1;
      node.counts[node.state] = 1;
    } else {
      node.counts.directories += node === root ? 0 : 1;
      node.children.sort((a, b) => {
        const left = nodes.get(a)!, right = nodes.get(b)!;
        return Number(right.kind === "directory") - Number(left.kind === "directory") || collator.compare(left.name, right.name);
      });
    }
    if (node.parent !== null) {
      const parent = nodes.get(node.parent)!;
      if (node.partial) parent.partial = true;
      const counts = parent.counts;
      for (const key of Object.keys(counts) as (keyof FolderCounts)[]) counts[key] += node.counts[key];
    }
  }
  const paths: string[] = [];
  const pending = [...root.children].reverse();
  while (pending.length) {
    const path = pending.pop()!;
    paths.push(path);
    const node = nodes.get(path)!;
    if (!node.excluded) for (let i = node.children.length - 1; i >= 0; i--) pending.push(node.children[i]);
  }
  return { root, nodes, paths, omitted };
}

/** Retain matching files and every ancestor, with counts for only the visible subset. */
export function filterProjectTree(tree: ProjectTree, activity: StructureActivity): ProjectTree {
  if (activity === "all") return tree;
  const included = new Set<string>([""]);
  // A reverse traversal visits each child before its parent, including deep paths.
  for (let i = tree.paths.length - 1; i >= 0; i--) {
    const node = tree.nodes.get(tree.paths[i])!;
    const matches = activity === "excluded" ? node.excluded : node.kind === "file" && !node.excluded && (
      activity === "touched" ? ["read", "write", "both"].includes(node.state)
        : activity === "read" ? node.state === "read" || node.state === "both"
          : activity === "written" ? node.state === "write" || node.state === "both"
            : node.state === "untouched"
    );
    if (!matches && !included.has(node.path)) continue;
    included.add(node.path);
    if (node.parent !== null) included.add(node.parent);
  }
  const paths = tree.paths.filter((path) => included.has(path));
  const nodes = new Map<string, ProjectNode>();
  for (const path of ["", ...paths]) {
    const node = tree.nodes.get(path)!;
    nodes.set(path, { ...node, children: node.children.filter((child) => included.has(child)), counts: emptyCounts() });
  }
  for (let i = paths.length - 1; i >= 0; i--) {
    const node = nodes.get(paths[i])!;
    if (node.excluded) {
      node.counts.excluded = 1;
      node.counts.directories = node.kind === "directory" ? 1 : 0;
    } else if (node.kind === "file") {
      node.counts.files = 1;
      node.counts[node.state] = 1;
    } else node.counts.directories++;
    const parent = nodes.get(node.parent!)!;
    for (const key of Object.keys(node.counts) as (keyof FolderCounts)[]) parent.counts[key] += node.counts[key];
  }
  return { root: nodes.get("")!, nodes, paths, omitted: tree.omitted };
}

export function projectBreadcrumbs(tree: ProjectTree, path: string): ProjectNode[] {
  const result: ProjectNode[] = [];
  let node = tree.nodes.get(path) ?? tree.root;
  while (true) {
    result.push(node);
    if (node.parent === null) break;
    node = tree.nodes.get(node.parent)!;
  }
  return result.reverse();
}

/** Return every visible row, keeping collapsed folders closed without capping results. */
export function projectTreeRows(tree: ProjectTree, path: string, expanded: ReadonlySet<string>): TreeRows {
  const folder = tree.nodes.get(path) ?? tree.root;
  if (folder.excluded) return { rows: [], total: 0 };
  const pending = folder.children.map((child) => ({ path: child, depth: 0 })).reverse();
  const rows: TreeRow[] = [];
  while (pending.length) {
    const item = pending.pop()!, node = tree.nodes.get(item.path)!;
    rows.push({ node, depth: item.depth });
    if (node.kind === "directory" && !node.excluded && expanded.has(node.path)) {
      for (let i = node.children.length - 1; i >= 0; i--) pending.push({ path: node.children[i], depth: item.depth + 1 });
    }
  }
  return { rows, total: rows.length };
}

/** Search the complete filtered snapshot, independently of folder focus or expansion. */
export function searchProjectTree(tree: ProjectTree, query: string): TreeRows {
  const needle = query.trim().toLocaleLowerCase();
  const rows: TreeRow[] = [];
  for (const path of tree.paths) {
    if (!path.toLocaleLowerCase().includes(needle)) continue;
    rows.push({ node: tree.nodes.get(path)!, depth: 0 });
  }
  return { rows, total: rows.length };
}

export function fileStateLabel(state: FileState): string {
  return { read: "Read only", write: "Write only", both: "Read + write", untouched: "Untouched", excluded: "Excluded" }[state];
}

export function directorySummary(node: ProjectNode): string {
  if (node.excluded) return "Excluded; contents not scanned";
  const c = node.counts;
  if (node.kind === "file") return fileStateLabel(node.state);
  return `${c.files.toLocaleString()} files · ${(c.read + c.both).toLocaleString()} read · ${(c.write + c.both).toLocaleString()} written · ${c.untouched.toLocaleString()} untouched${c.excluded ? ` · ${c.excluded.toLocaleString()} excluded entries` : ""}${node.partial ? " · partially scanned" : ""}`;
}

/** A small balanced treemap. Minimum weight keeps empty directories and tiny groups selectable. */
export function projectMapRectangles(weights: readonly number[]): MapRectangle[] {
  if (!weights.length) return [];
  const sum = weights.reduce((total, weight) => total + Math.max(1, weight), 0);
  const adjusted = weights.map((weight) => Math.max(1, weight, sum * 0.025));
  const output: MapRectangle[] = Array(weights.length);
  const place = (start: number, end: number, x: number, y: number, width: number, height: number) => {
    if (end - start === 1) { output[start] = { x, y, width, height }; return; }
    let total = 0;
    for (let i = start; i < end; i++) total += adjusted[i];
    let running = adjusted[start], split = start + 1;
    while (split < end - 1 && running + adjusted[split] / 2 < total / 2) running += adjusted[split++];
    const ratio = running / total;
    if (width * 1.5 >= height) {
      place(start, split, x, y, width * ratio, height);
      place(split, end, x + width * ratio, y, width * (1 - ratio), height);
    } else {
      place(start, split, x, y, width, height * ratio);
      place(split, end, x, y + height * ratio, width, height * (1 - ratio));
    }
  };
  place(0, weights.length, 0, 0, 100, 100);
  return output;
}
