import path from "node:path";
import type { AppRouterNode, Graph } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const APP_ROUTER_FILES = new Set([
  "page", "layout", "loading", "error", "not-found",
  "route", "template", "default",
]);

type FileMap = Record<string, string>;

function classifyFile(fileName: string): string | undefined {
  const base = path.basename(fileName, path.extname(fileName));
  if (APP_ROUTER_FILES.has(base)) return base;
  return undefined;
}

function buildRouterTree(
  appDir: string,
  files: ScannedFile[],
): AppRouterNode | undefined {
  const dirMap = new Map<string, FileMap>();

  for (const sf of files) {
    const rel = sf.relativePath;
    if (!rel.startsWith("app/") && !rel.startsWith("app\\")) continue;
    const afterApp = rel.replace(/^app[/\\]/, "");
    const dir = path.dirname(afterApp);
    const fileName = path.basename(afterApp);
    const kind = classifyFile(fileName);
    if (!kind) continue;

    let entry = dirMap.get(dir);
    if (!entry) {
      entry = {};
      dirMap.set(dir, entry);
    }
    entry[kind] = rel;
  }

  if (dirMap.size === 0) return undefined;

  const segments = [...dirMap.keys()].filter((d) => d !== ".");

  function nodeForDir(dirParts: string[]): AppRouterNode {
    const dirPath = dirParts.join("/");
    const files = dirMap.get(dirPath) ?? {};
    const childDirs = segments.filter((s) => {
      const parts = s.split("/");
      if (parts.length !== dirParts.length + 1) return false;
      return parts.slice(0, -1).join("/") === dirPath;
    });

    return {
      path: "/" + dirParts.map((p) => p.replace(/^\(|\)$/g, "")).join("/"),
      dir: dirPath === "." ? "app" : path.join("app", dirPath),
      files: {
        page: files.page,
        layout: files.layout,
        loading: files.loading,
        error: files.error,
        notFound: files["not-found"],
        route: files.route,
        template: files.template,
        default: files.default,
      },
      children: childDirs.map((s) => {
        const parts = s.split("/");
        return nodeForDir(parts);
      }),
    };
  }

  const rootChildren = segments
    .filter((s) => !s.includes("/"))
    .map((s) => nodeForDir(s === "." ? [] : [s]));

  const rootFiles = dirMap.get(".") ?? {};
  return {
    path: "/",
    dir: "app",
    files: {
      page: rootFiles.page,
      layout: rootFiles.layout,
      loading: rootFiles.loading,
      error: rootFiles.error,
      notFound: rootFiles["not-found"],
      route: rootFiles.route,
      template: rootFiles.template,
      default: rootFiles.default,
    },
    children: rootChildren,
  };
}

export function extractAppRouter(
  graph: Graph,
  scanned: ScannedFile[],
): Graph {
  const tree = buildRouterTree(graph.root, scanned);
  return { ...graph, appRouter: tree ?? undefined };
}
