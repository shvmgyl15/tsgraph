import type { Graph } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";
import { extractRNComponents } from "./components.js";
import { extractExpoRouter } from "./navigation.js";
import { extractExpoConfig } from "./expoConfig.js";

export { extractRNComponents } from "./components.js";
export { extractExpoRouter } from "./navigation.js";
export { extractExpoConfig } from "./expoConfig.js";

const RN_DEP_PATTERNS = ["react-native", "expo", "expo-router"];

function hasRNDependency(deps: Record<string, string>): boolean {
  for (const pattern of RN_DEP_PATTERNS) {
    if (deps[pattern]) return true;
  }
  return false;
}

export function extractReactNative(
  graph: Graph,
  rootDir: string,
  scanned: ScannedFile[],
  dependencies: Record<string, string>,
): Graph {
  if (!hasRNDependency(dependencies)) return graph;

  let g = extractRNComponents(graph, scanned);
  g = extractExpoRouter(g, scanned);
  g = extractExpoConfig(g, rootDir);
  return g;
}
