import path from "node:path";
import { Project, Node } from "ts-morph";
import type { Graph, SymbolNode, RNPlatform } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const PLATFORM_RE = /\.(ios|android|native)\.(ts|tsx|js|jsx)$/;

function parsePlatformSuffix(fileName: string): { base: string; platform: RNPlatform } | undefined {
  const match = fileName.match(PLATFORM_RE);
  if (!match) return undefined;
  const platform = match[1] as RNPlatform;
  const base = fileName.slice(0, match.index) + "." + match[2];
  return { base, platform };
}

interface PlatformGroup {
  ios?: string;
  android?: string;
  native?: string;
  base?: string;
}

function groupPlatformFiles(scanned: ScannedFile[]): Map<string, PlatformGroup> {
  const groups = new Map<string, PlatformGroup>();

  for (const sf of scanned) {
    const fileName = path.basename(sf.relativePath);
    const parsed = parsePlatformSuffix(fileName);
    if (!parsed) continue;

    const basePath = path.join(path.dirname(sf.relativePath), parsed.base);
      const group = groups.get(basePath) ?? {};
    if (parsed.platform === "ios" || parsed.platform === "android" || parsed.platform === "native") {
      group[parsed.platform] = sf.relativePath;
    }
    groups.set(basePath, group);
  }

  return groups;
}

function detectPlatformSelect(project: Project, graph: Graph): Graph {
  const updatedSymbols = [...graph.symbols];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = graph.root
      ? path.relative(graph.root, sourceFile.getFilePath())
      : sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return false;

      const exprText = node.getExpression().getText();

      if (exprText === "Platform.select") {
        const args = node.getArguments();
        if (args.length === 1) {
          const arg = args[0];
          if (Node.isObjectLiteralExpression(arg)) {
            const platformProps: string[] = [];
            for (const prop of arg.getProperties()) {
              if (Node.isPropertyAssignment(prop)) {
                const key = prop.getName();
                if (key === "ios" || key === "android" || key === "native" || key === "default") {
                  platformProps.push(key);
                }
              }
            }
            if (platformProps.length > 0) {
              const funcName = findEnclosingFunctionName(node);
              if (funcName) {
                const sym = updatedSymbols.find(
                  (s) => s.name === funcName && s.file === relPath,
                );
                if (sym && !sym.platform) {
                  sym.platform = "all";
                }
              }
            }
          }
        }
      }

      if (exprText === "Platform.OS") {
        const parent = node.getParent();
        if (parent && (Node.isBinaryExpression(parent) || Node.isPropertyAccessExpression(parent))) {
          const funcName = findEnclosingFunctionName(node);
          if (funcName) {
            const sym = updatedSymbols.find(
              (s) => s.name === funcName && s.file === relPath,
            );
            if (sym && !sym.platform) {
              sym.platform = "all";
            }
          }
        }
      }

      return false;
    });
  }

  return { ...graph, symbols: updatedSymbols };
}

function findEnclosingFunctionName(node: Node): string | undefined {
  let current = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current) || Node.isFunctionExpression(current)) {
      return current.getName() ?? undefined;
    }
    if (Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      return undefined;
    }
    if (Node.isMethodDeclaration(current)) {
      const name = current.getName();
      const cls = current.getParent();
      if (cls && Node.isClassDeclaration(cls) && cls.getName()) {
        return `${cls.getName()}.${name}`;
      }
      return name;
    }
    current = current.getParent();
  }
  return undefined;
}

export function extractPlatformSpecific(
  graph: Graph,
  scanned: ScannedFile[],
  project?: Project,
): Graph {
  const platformGroups = groupPlatformFiles(scanned);
  if (platformGroups.size === 0) return graph;

  const baseToVariant = new Map<string, string[]>();
  for (const [basePath, group] of platformGroups) {
    const variants: string[] = [];
    if (group.ios) variants.push(group.ios);
    if (group.android) variants.push(group.android);
    if (group.native) variants.push(group.native);
    baseToVariant.set(basePath, variants);
  }

  const updatedSymbols: SymbolNode[] = [];

  for (const sym of graph.symbols) {
    const fileName = path.basename(sym.file);
    const parsed = parsePlatformSuffix(fileName);

    if (parsed) {
      const basePath = path.join(path.dirname(sym.file), parsed.base);
      const group = platformGroups.get(basePath);

      const platform = parsed.platform as "ios" | "android" | "native";
      const updated = { ...sym, platform };
      if (group?.base) {
        updated.baseFile = group.base;
      }
      updatedSymbols.push(updated);
    } else {
      const basePath = path.join(path.dirname(sym.file), fileName);
      const variants = baseToVariant.get(basePath);

      if (variants && variants.length > 0) {
        const platformVariants: { ios?: string; android?: string; native?: string } = {};
        for (const v of variants) {
          const p = parsePlatformSuffix(path.basename(v));
          if (p && (p.platform === "ios" || p.platform === "android" || p.platform === "native")) {
            platformVariants[p.platform] = v;
          }
        }
        updatedSymbols.push({
          ...sym,
          platform: "all",
          platformVariants: Object.keys(platformVariants).length > 0 ? platformVariants : undefined,
        });
      } else {
        updatedSymbols.push({ ...sym, platform: sym.platform ?? "all" });
      }
    }
  }

  // Synthesize base symbols for variant-only files
  for (const [basePath, group] of platformGroups) {
    if (group.base) continue;
    const baseFileName = path.basename(basePath);
    const baseDir = path.dirname(basePath);
    const fileExt = path.extname(baseFileName);
    const baseName = path.basename(baseFileName, fileExt);

    const existing = graph.symbols.find((s) => s.file === basePath);
    if (existing) continue;

    updatedSymbols.push({
      id: `synthetic_${basePath.replace(/[/\\]/g, "_")}`,
      kind: "var",
      name: baseName,
      packageName: graph.packages[0]?.name ?? "",
      file: basePath,
      line: 0,
      endLine: 0,
      isExported: false,
      synthetic: true,
      platform: "all",
      platformVariants: {
        ios: group.ios,
        android: group.android,
        native: group.native,
      },
    });
  }

  let result = { ...graph, symbols: updatedSymbols };

  if (project) {
    result = detectPlatformSelect(project, result);
  }

  return result;
}
