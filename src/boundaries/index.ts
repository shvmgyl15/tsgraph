import type { Graph } from "../graph/types.js";
import path from "node:path";
import fs from "node:fs";
import { z } from "zod/v4";

export interface LayerConfig {
  name: string;
  path: string;
  dependsOn: string[];
}

export interface BoundariesConfig {
  layers: LayerConfig[];
}

export interface BoundaryViolation {
  fromFile: string;
  fromLayer: string;
  toFile: string;
  toLayer: string;
  toPackage: string;
  rule: string;
}

export interface BoundaryResult {
  violations: BoundaryViolation[];
  allowed: number;
  config: BoundariesConfig;
}

const layerConfigSchema = z.object({
  name: z.string(),
  path: z.string(),
  dependsOn: z.array(z.string()),
});

const boundariesConfigSchema = z.object({
  layers: z.array(layerConfigSchema),
});

export function loadBoundariesConfig(rootDir: string): BoundariesConfig | null {
  const configPath = path.join(rootDir, ".tsgraph", "boundaries.json");
  try {
    const raw = fs.readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw);
    const result = boundariesConfigSchema.safeParse(parsed);
    if (!result.success) return null;
    return result.data;
  } catch {
    return null;
  }
}

const EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const INDEX_PATTERNS = ["/index", ""];

function findLayerByPath(filePath: string, config: BoundariesConfig): LayerConfig | undefined {
  return config.layers.find((layer) => filePath.startsWith(layer.path));
}

function resolveTargetPath(fromFile: string, importPath: string): string | undefined {
  if (importPath.startsWith(".")) {
    const dir = path.posix.dirname(fromFile);
    return path.posix.normalize(path.posix.join(dir, importPath));
  }
  if (importPath.startsWith("/")) {
    return path.posix.normalize(importPath);
  }
  return undefined;
}

function matchFile(resolved: string, files: { path: string }[]): string | undefined {
  for (const file of files) {
    if (file.path === resolved) return file.path;
    for (const ext of EXTENSIONS) {
      if (file.path === resolved + ext) return file.path;
    }
    for (const ext of EXTENSIONS) {
      for (const idx of INDEX_PATTERNS) {
        if (file.path === resolved + idx + ext) return file.path;
      }
    }
  }
  return undefined;
}

export function checkBoundaries(graph: Graph, config: BoundariesConfig): BoundaryResult {
  const violations: BoundaryViolation[] = [];
  let allowed = 0;

  for (const imp of graph.imports) {
    const fromLayer = findLayerByPath(imp.fromFile, config);
    if (!fromLayer) {
      allowed++;
      continue;
    }

    const resolved = resolveTargetPath(imp.fromFile, imp.importPath);
    if (!resolved) {
      allowed++;
      continue;
    }

    const matchedFile = matchFile(resolved, graph.files);
    if (!matchedFile) {
      allowed++;
      continue;
    }

    const toLayer = findLayerByPath(matchedFile, config);
    if (!toLayer) {
      allowed++;
      continue;
    }

    if (fromLayer.name === toLayer.name) {
      allowed++;
      continue;
    }

    if (!fromLayer.dependsOn.includes(toLayer.name)) {
      const targetFile = graph.files.find((f) => f.path === matchedFile);
      violations.push({
        fromFile: imp.fromFile,
        fromLayer: fromLayer.name,
        toFile: matchedFile,
        toLayer: toLayer.name,
        toPackage: targetFile?.packageName ?? toLayer.name,
        rule: `${fromLayer.name} → ${toLayer.name} not allowed`,
      });
    } else {
      allowed++;
    }
  }

  return { violations, allowed, config };
}
