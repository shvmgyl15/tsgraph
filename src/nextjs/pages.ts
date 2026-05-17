import path from "node:path";
import type { Graph, HTTPRoute } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

function pagePathToRoute(relativePath: string): string | undefined {
  let p = relativePath
    .replace(/^pages[/\\]/, "")
    .replace(/\.[jt]sx?$/, "")
    .replace(/index$/, "")
    .replace(/\[\.\.\.(.+?)\]/, "*$1")
    .replace(/\[(.+?)\]/g, ":$1");

  if (!p.startsWith("/")) p = "/" + p;
  return p === "/" ? "/" : p.replace(/\/$/, "");
}

export function extractPagesRouter(
  graph: Graph,
  scanned: ScannedFile[],
): Graph {
  const newRoutes: HTTPRoute[] = [...graph.routes];

  for (const sf of scanned) {
    const rel = sf.relativePath;
    if (!rel.startsWith("pages/") && !rel.startsWith("pages\\")) continue;
    const ext = path.extname(rel);
    if (ext !== ".ts" && ext !== ".tsx" && ext !== ".js" && ext !== ".jsx") continue;

    const route = pagePathToRoute(rel);
    if (!route) continue;

    const isApi = route.startsWith("/api");
    newRoutes.push({
      method: "GET",
      path: route,
      handler: isApi ? `pages${route}` : rel,
      file: rel,
      line: 1,
    });
  }

  return { ...graph, routes: newRoutes };
}
