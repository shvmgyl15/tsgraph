import { Project } from "ts-morph";
import type { Graph } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";
import { extractRNComponents } from "./components.js";
import { extractExpoRouter, extractReactNavigation } from "./navigation.js";
import { extractExpoConfig } from "./expoConfig.js";
import { extractPlatformSpecific } from "./platform.js";
import {
  extractRNStyleUsages,
  extractNativeModuleRefs,
  extractRNAPIs,
} from "./apis.js";

export { extractRNComponents } from "./components.js";
export { extractExpoRouter } from "./navigation.js";
export { extractReactNavigation } from "./navigation.js";
export { extractExpoConfig } from "./expoConfig.js";
export { extractPlatformSpecific } from "./platform.js";
export { extractRNStyleUsages, extractNativeModuleRefs, extractRNAPIs } from "./apis.js";

const RN_DEP_PATTERNS = ["react-native", "expo", "expo-router"];

function hasRNDependency(deps: Record<string, string>): boolean {
  for (const pattern of RN_DEP_PATTERNS) {
    if (deps[pattern]) return true;
  }
  return false;
}

function buildProject(scanned: ScannedFile[]): Project {
  const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
  const parsable = scanned.filter(
    (sf) => sf.kind === "ts" || sf.kind === "tsx" || sf.kind === "js" || sf.kind === "jsx",
  );
  for (const sf of parsable) {
    try {
      project.addSourceFileAtPath(sf.path);
    } catch {
      // skip files that fail to parse
    }
  }
  return project;
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

  const project = buildProject(scanned);
  g = extractPlatformSpecific(g, scanned, project);
  g = extractReactNavigation(g, rootDir, scanned, project);
  g = extractRNStyleUsages(g, project);
  g = extractNativeModuleRefs(g, project);
  g = extractRNAPIs(g, project);

  return g;
}
