import type { Graph, ImportEdge, SymbolNode } from "../graph/types.js";

export interface CouplingResult {
  packageName: string;
  coupledTo: string;
  importCount: number;
  fileCount: number;
}

export interface DepsNode {
  name: string;
  kind: string;
  file: string;
  line: number;
  children: DepsNode[];
}

export function analyzeCoupling(graph: Graph): CouplingResult[] {
  const pkgFiles = new Map<string, Set<string>>();
  for (const f of graph.files) {
    const files = pkgFiles.get(f.packageName) ?? new Set();
    files.add(f.path);
    pkgFiles.set(f.packageName, files);
  }

  const pkgImportTargets = new Map<string, Map<string, { files: Set<string>; count: number }>>();
  for (const imp of graph.imports) {
    const target = imp.importPath.split("/")[0];
    const byPkg = pkgImportTargets.get(imp.fromPackage) ?? new Map();
    const entry = byPkg.get(target) ?? { files: new Set<string>(), count: 0 };
    entry.files.add(imp.fromFile);
    entry.count++;
    byPkg.set(target, entry);
    pkgImportTargets.set(imp.fromPackage, byPkg);
  }

  const results: CouplingResult[] = [];
  for (const [pkg, targets] of pkgImportTargets) {
    for (const [target, entry] of targets) {
      if (pkg === target) continue;
      results.push({
        packageName: pkg,
        coupledTo: target,
        importCount: entry.count,
        fileCount: entry.files.size,
      });
    }
  }

  results.sort((a, b) => b.importCount - a.importCount);
  return results;
}

export function dependencyTree(
  graph: Graph,
  symbolName: string,
  maxDepth: number = 3,
): DepsNode | undefined {
  const sym = graph.symbols.find((s) => s.name === symbolName);
  if (!sym) return undefined;

  function buildTree(
    current: SymbolNode,
    depth: number,
    visited: Set<string>,
  ): DepsNode {
    const node: DepsNode = {
      name: current.name,
      kind: current.kind,
      file: current.file,
      line: current.line,
      children: [],
    };

    if (depth >= maxDepth) return node;

    const calleeEdges = graph.calls.filter(
      (c) => c.callerSymbolId === current.id,
    );

    for (const edge of calleeEdges) {
      if (visited.has(edge.calleeRaw)) continue;
      visited.add(edge.calleeRaw);

      const calleeSym = graph.symbols.find(
        (s) => s.name === edge.calleeRaw && s.file === edge.file,
      );

      if (calleeSym) {
        node.children.push(buildTree(calleeSym, depth + 1, visited));
      } else {
        node.children.push({
          name: edge.calleeRaw,
          kind: "unknown",
          file: edge.file,
          line: edge.line,
          children: [],
        });
      }
    }

    return node;
  }

  return buildTree(sym, 0, new Set([symbolName]));
}
