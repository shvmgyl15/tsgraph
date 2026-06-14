import path from "node:path";
import type { Graph, NavigationNode } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const IGNORED_BASES = new Set(["_layout", "_app", "_error", "_not-found", "_loading"]);

function ignoredFile(fileName: string): boolean {
  const base = path.basename(fileName, path.extname(fileName));
  return IGNORED_BASES.has(base);
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function toParam(base: string): string {
  if (base.startsWith("[")) {
    const inner = base.slice(1, -1);
    return inner.startsWith("...") ? `*${inner.slice(3)}` : `:${inner}`;
  }
  return base;
}

function visibleSegments(dirs: string[], base: string): string[] {
  const segs = dirs.filter((d) => !isRouteGroup(d)).map((d) => toParam(d));
  if (base !== "index") segs.push(toParam(base));
  return segs;
}

interface RouteFile {
  file: string;
  dirs: string[];
  base: string;
}

function buildExpoRouterTree(files: ScannedFile[]): NavigationNode[] | undefined {
  const routes: RouteFile[] = [];

  for (const sf of files) {
    const rel = sf.relativePath;
    if (!rel.startsWith("app/") && !rel.startsWith("app\\")) continue;
    const afterApp = rel.replace(/^app[/\\]/, "");
    const fileName = path.basename(afterApp);
    if (ignoredFile(fileName)) continue;

    const dir = path.dirname(afterApp);
    const dirs = dir === "." ? [] : dir.split("/");
    const base = path.basename(fileName, path.extname(fileName));
    routes.push({ file: rel, dirs, base });
  }

  if (routes.length === 0) return undefined;

  // Build a path trie from the route files.
  interface TrieNode {
    name: string;
    children: Map<string, TrieNode>;
    file?: string;
  }

  const root: TrieNode = { name: "", children: new Map() };

  for (const r of routes) {
    let node = root;
    for (const d of r.dirs) {
      if (!node.children.has(d)) {
        node.children.set(d, { name: d, children: new Map() });
      }
      node = node.children.get(d)!;
    }
    if (!node.children.has(r.base)) {
      node.children.set(r.base, { name: r.base, children: new Map() });
    }
    node.children.get(r.base)!.file = r.file;
  }

  // Check if a trie node represents a dir with an index file (has a "page")
  function hasPage(node: TrieNode): boolean {
    const idx = node.children.get("index");
    return !!(idx && idx.file);
  }

  function trieToNav(
    trieNode: TrieNode,
    parentDirs: string[],
  ): NavigationNode | undefined {
    const isGroup = parentDirs.length > 0 && isRouteGroup(parentDirs[parentDirs.length - 1]);

    const segs = visibleSegments(parentDirs, "index");
    const node: NavigationNode = {
      type: "expo-router",
      routeName: segs.join("/") || "index",
      path: "/" + segs.join("/"),
      children: [],
    };

    // Set componentFile from index route if present
    const indexChild = trieNode.children.get("index");
    if (indexChild && indexChild.file) {
      node.componentFile = indexChild.file;
    }

    // For route groups: index file is also a child screen
    if (isGroup && indexChild && indexChild.file) {
      const ik = visibleSegments(parentDirs, "index");
      node.children!.push({
        type: "expo-router",
        routeName: ik.join("/") || "index",
        path: "/" + ik.join("/"),
        componentFile: indexChild.file,
        children: [],
      });
    }

    // Categorize children
    const groupChildren: [string, TrieNode][] = [];
    const dirChildren: [string, TrieNode][] = [];
    const leafChildren: [string, TrieNode][] = [];

    for (const [name, child] of trieNode.children) {
      if (name === "index") continue;

      if (isRouteGroup(name)) {
        groupChildren.push([name, child]);
      } else if (child.children.size > 0) {
        dirChildren.push([name, child]);
      } else {
        leafChildren.push([name, child]);
      }
    }

    // Route groups
    for (const [name, child] of groupChildren) {
      const childDirs = [...parentDirs, name];
      const groupNode = trieToNav(child, childDirs);
      if (groupNode) {
        node.children!.push(groupNode);
      }
    }

    // Regular directories: only create a child node if they have an index page
    // Otherwise, flatten their leaf children into this level
    for (const [name, child] of dirChildren) {
      const childDirs = [...parentDirs, name];

      if (hasPage(child)) {
        const childNode = trieToNav(child, childDirs);
        if (childNode) {
          node.children!.push(childNode);
        }
      } else {
        // No index page: flatten leaf children to this level
        // We need to recursively collect all leaf files
        function collectFlattened(tn: TrieNode, dirPrefix: string[]): NavigationNode[] {
          const result: NavigationNode[] = [];
          for (const [cn, cv] of tn.children) {
            if (cn === "index") continue;
            if (isRouteGroup(cn)) continue;
            if (cv.children.size > 0) {
              result.push(...collectFlattened(cv, [...dirPrefix, cn]));
            } else {
              const segs = visibleSegments([...dirPrefix], cn);
              result.push({
                type: "expo-router",
                routeName: segs.join("/") || cn,
                path: "/" + segs.join("/"),
                componentFile: cv.file,
                children: [],
              });
            }
          }
          return result;
        }

        const flatChildren = collectFlattened(child, [...parentDirs, name]);
        for (const fc of flatChildren) {
          node.children!.push(fc);
        }
      }
    }

    // File leaves
    for (const [name, child] of leafChildren) {
      const segs = visibleSegments(parentDirs, name);
      node.children!.push({
        type: "expo-router",
        routeName: segs.join("/") || name,
        path: "/" + segs.join("/"),
        componentFile: child.file,
        children: [],
      });
    }

    return node;
  }

  const treeRoot = trieToNav(root, []);
  return treeRoot ? [treeRoot] : undefined;
}

export function extractExpoRouter(
  graph: Graph,
  scanned: ScannedFile[],
): Graph {
  const tree = buildExpoRouterTree(scanned);
  if (!tree) return graph;
  return { ...graph, navigationTree: tree };
}
