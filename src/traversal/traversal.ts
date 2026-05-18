import fs from "node:fs";
import path from "node:path";
import type { Graph, SymbolNode } from "../graph/types.js";

export interface ImpactNode {
  symbol: SymbolNode;
  depth: number;
  callChain: string[];
}

export function impact(
  graph: Graph,
  symbolName: string,
  maxDepth: number = 5,
): ImpactNode[] {
  const start = graph.symbols.find((s) => s.name === symbolName);
  if (!start) return [];

  const results: ImpactNode[] = [];
  const visited = new Set<string>();
  const queue: { sym: SymbolNode; depth: number; chain: string[] }[] = [
    { sym: start, depth: 0, chain: [start.name] },
  ];
  visited.add(start.id);

  while (queue.length > 0) {
    const { sym, depth, chain } = queue.shift()!;
    if (depth > 0) {
      results.push({ symbol: sym, depth, callChain: chain });
    }
    if (depth >= maxDepth) continue;

    const callers = graph.calls.filter((c) => c.calleeRaw === sym.name);
    for (const edge of callers) {
      const caller = graph.symbols.find((s) => s.id === edge.callerSymbolId);
      if (!caller || visited.has(caller.id)) continue;
      visited.add(caller.id);
      queue.push({
        sym: caller,
        depth: depth + 1,
        chain: [...chain, caller.name],
      });
    }
  }

  return results;
}

export interface PathNode {
  name: string;
  kind: string;
  file: string;
  line: number;
}

export function findPath(
  graph: Graph,
  fromName: string,
  toName: string,
  maxDepth: number = 10,
): PathNode[] | undefined {
  const from = graph.symbols.find((s) => s.name === fromName);
  const to = graph.symbols.find((s) => s.name === toName);
  if (!from || !to) return undefined;
  if (from.id === to.id) return [{ name: from.name, kind: from.kind, file: from.file, line: from.line }];

  const visited = new Set<string>();
  const parent = new Map<string, { prev: string; edge: { name: string; kind: string; file: string; line: number } }>();
  const queue: string[] = [from.id];
  visited.add(from.id);

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    const current = graph.symbols.find((s) => s.id === currentId);
    if (!current) continue;

    const calleeEdges = graph.calls.filter((c) => c.callerSymbolId === currentId);
    for (const edge of calleeEdges) {
      const callee = graph.symbols.find(
        (s) => s.name === edge.calleeRaw,
      );
      if (!callee || visited.has(callee.id)) continue;
      visited.add(callee.id);
      parent.set(callee.id, {
        prev: currentId,
        edge: { name: callee.name, kind: callee.kind, file: callee.file, line: callee.line },
      });
      if (callee.id === to.id) {
        const pathNodes: PathNode[] = [];
        let step: string | undefined = to.id;
        while (step) {
          const sym = graph.symbols.find((s) => s.id === step)!;
          pathNodes.unshift({ name: sym.name, kind: sym.kind, file: sym.file, line: sym.line });
          const p = parent.get(step);
          step = p?.prev;
        }
        return pathNodes;
      }
      queue.push(callee.id);
    }
  }

  return undefined;
}

export interface OrphanResult {
  symbol: SymbolNode;
  reason: string;
}

export function findOrphans(graph: Graph): OrphanResult[] {
  const calledNames = new Set(graph.calls.map((c) => c.calleeRaw));
  const testTargets = new Set(graph.testEdges.map((t) => t.target));

  const results: OrphanResult[] = [];

  for (const sym of graph.symbols) {
    if (sym.isExported) {
      const incomingCallers = graph.calls.filter((c) => c.calleeRaw === sym.name);
      if (incomingCallers.length === 0 && !testTargets.has(sym.name)) {
        results.push({ symbol: sym, reason: "exported but no callers or tests" });
      }
    } else {
      if (!calledNames.has(sym.name) && !testTargets.has(sym.name)) {
        results.push({ symbol: sym, reason: "unexported, no callers or tests" });
      }
    }
  }

  return results;
}

export interface TraceMatch {
  symbol: SymbolNode;
  file: string;
  line: number;
  contextLine: string;
}

export interface TraceResult {
  match: TraceMatch;
  callers: ImpactNode[];
}

export function trace(
  graph: Graph,
  searchString: string,
  maxDepth: number = 5,
): TraceResult[] {
  const lowerSearch = searchString.toLowerCase();
  const results: TraceResult[] = [];

  for (const sym of graph.symbols) {
    if (sym.kind !== "function" && sym.kind !== "method" && sym.kind !== "const") continue;

    const filePath = path.join(graph.root, sym.file);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const lines = content.split("\n");
    const start = Math.max(0, sym.line - 1);
    const end = Math.min(lines.length, sym.endLine);

    for (let i = start; i < end; i++) {
      if (lines[i].toLowerCase().includes(lowerSearch)) {
        const impactNodes = impact(graph, sym.name, maxDepth);
        results.push({
          match: {
            symbol: sym,
            file: sym.file,
            line: i + 1,
            contextLine: lines[i].trim(),
          },
          callers: impactNodes,
        });
      }
    }
  }

  return results;
}
