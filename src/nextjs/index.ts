import type { Graph } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";
import { extractAppRouter } from "./router.js";
import { extractPagesRouter } from "./pages.js";
import { classifyReactComponents } from "./react.js";
import { extractAPIRoutes } from "./routes.js";

export { extractAppRouter } from "./router.js";
export { extractPagesRouter } from "./pages.js";
export { classifyReactComponents } from "./react.js";
export { extractAPIRoutes } from "./routes.js";

export function extractNextJs(
  graph: Graph,
  rootDir: string,
  scanned: ScannedFile[],
): Graph {
  let g = extractAppRouter(graph, scanned);
  g = extractPagesRouter(g, scanned);
  g = classifyReactComponents(g, rootDir);
  g = extractAPIRoutes(g, scanned, rootDir);
  return g;
}
