import path from "node:path";
import { Project } from "ts-morph";
import type { Graph, HTTPRoute } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]);

function appRouteToHttpPath(relativePath: string): string {
  let p = relativePath
    .replace(/^app[/\\]/, "")
    .replace(/\/route\.[jt]sx?$/, "")
    .replace(/\[\.\.\.(.+?)\]/g, "*$1")
    .replace(/\[(.+?)\]/g, ":$1")
    .replace(/^\(.+?\)\//, "")
    .replace(/\/(\(.+?\))/g, "");

  if (!p.startsWith("/")) p = "/" + p;
  return p === "/" ? "/" : p.replace(/\/$/, "");
}

export function extractAPIRoutes(
  graph: Graph,
  scanned: ScannedFile[],
  rootDir: string,
): Graph {
  const routeFiles = scanned.filter((sf) => {
    const base = path.basename(sf.path, path.extname(sf.path));
    return base === "route" && sf.relativePath.startsWith("app/");
  });

  if (routeFiles.length === 0) return graph;

  const project = new Project({ compilerOptions: { noEmit: true } });
  const newRoutes: HTTPRoute[] = [...graph.routes];

  for (const rf of routeFiles) {
    try {
      const sourceFile = project.addSourceFileAtPath(rf.path);
    } catch {
      continue;
    }
  }

  for (const rf of routeFiles) {
    try {
      const sourceFile = project.getSourceFile(rf.path);
      if (!sourceFile) continue;

      const httpPath = appRouteToHttpPath(rf.relativePath);

      for (const func of sourceFile.getFunctions()) {
        const name = func.getName();
        if (!name || !HTTP_METHODS.has(name.toUpperCase())) continue;

        newRoutes.push({
          method: name.toUpperCase(),
          path: httpPath,
          handler: rf.relativePath,
          file: rf.relativePath,
          line: func.getStartLineNumber(),
        });
      }
    } catch {
      continue;
    }
  }

  return { ...graph, routes: newRoutes };
}
