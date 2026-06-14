import fs from "node:fs";
import path from "node:path";
import type { ExpoConfig, Graph } from "../graph/types.js";

function tryReadJson(filePath: string): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function maybeReadJsConfig(filePath: string): Record<string, any> | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const cleaned = raw
      .replace(/\/\/.*$/gm, "")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/export default/, "module.exports =");
    const mod = { exports: {} as Record<string, any> };
    const fn = new Function("module", "exports", "require", cleaned);
    fn(mod, mod.exports, () => ({}));
    return mod.exports as Record<string, any>;
  } catch {
    return null;
  }
}

function readExpoConfig(rootDir: string): ExpoConfig | undefined {
  const appJsonPath = path.join(rootDir, "app.json");
  const appConfigJsPath = path.join(rootDir, "app.config.js");
  const appConfigTsPath = path.join(rootDir, "app.config.ts");

  let raw: Record<string, any> | null = null;

  if (fs.existsSync(appConfigJsPath)) {
    raw = maybeReadJsConfig(appConfigJsPath);
  } else if (fs.existsSync(appConfigTsPath)) {
    raw = maybeReadJsConfig(appConfigTsPath);
  } else {
    raw = tryReadJson(appJsonPath);
  }

  if (!raw) return undefined;

  const expo = raw.expo ?? raw;
  const ios = expo.ios ?? {};
  const android = expo.android ?? {};
  const plugins: string[] = [];

  if (Array.isArray(expo.plugins)) {
    for (const p of expo.plugins) {
      if (typeof p === "string") {
        plugins.push(p);
      } else if (Array.isArray(p) && typeof p[0] === "string") {
        plugins.push(p[0]);
      }
    }
  }

  return {
    scheme: expo.scheme,
    bundleId: ios.bundleIdentifier ?? android.package,
    plugins,
  };
}

export function extractExpoConfig(graph: Graph, rootDir: string): Graph {
  const config = readExpoConfig(rootDir);
  if (!config) return graph;
  return { ...graph, expoConfig: config };
}
