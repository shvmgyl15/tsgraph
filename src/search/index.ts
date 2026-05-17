import fs from "node:fs";
import path from "node:path";
import type {
  Graph,
  SymbolNode,
  CallEdge,
  ImportEdge,
  FileNode,
  PackageNode,
} from "../graph/types.js";
import { deserialize } from "../graph/types.js";

export interface CallerResult {
  callerSymbol: SymbolNode;
  edges: CallEdge[];
}

export interface CalleeResult {
  calleeRaw: string;
  edges: CallEdge[];
}

export interface FocusResult {
  pkg: PackageNode;
  files: FileNode[];
  symbols: SymbolNode[];
  imports: ImportEdge[];
}

export interface ContextResult {
  node?: SymbolNode;
  source?: string;
  callers: CallerResult[];
  callees: CalleeResult[];
}

export function loadGraph(graphPath: string): Graph {
  const raw = fs.readFileSync(graphPath, "utf-8");
  return deserialize(raw);
}

export function findCallers(graph: Graph, name: string): CallerResult[] {
  const matchingEdges = graph.calls.filter(
    (c) => c.calleeRaw === name,
  );
  const callerMap = new Map<string, CallerResult>();
  for (const edge of matchingEdges) {
    const caller = graph.symbols.find((s) => s.id === edge.callerSymbolId);
    if (!caller) continue;
    const key = caller.id;
    let result = callerMap.get(key);
    if (!result) {
      result = { callerSymbol: caller, edges: [] };
      callerMap.set(key, result);
    }
    result.edges.push(edge);
  }
  return [...callerMap.values()];
}

export function findCallees(graph: Graph, name: string): CalleeResult[] {
  const sym = graph.symbols.find((s) => s.name === name);
  if (!sym) return [];
  const edges = graph.calls.filter((c) => c.callerSymbolId === sym.id);
  const calleeMap = new Map<string, CalleeResult>();
  for (const edge of edges) {
    let result = calleeMap.get(edge.calleeRaw);
    if (!result) {
      result = { calleeRaw: edge.calleeRaw, edges: [] };
      calleeMap.set(edge.calleeRaw, result);
    }
    result.edges.push(edge);
  }
  return [...calleeMap.values()];
}

export function findNode(graph: Graph, name: string): SymbolNode | undefined {
  return graph.symbols.find((s) => s.name === name);
}

export function readSource(graph: Graph, symbol: SymbolNode): string {
  const filePath = path.join(graph.root, symbol.file);
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.split("\n");
  const start = Math.max(0, symbol.line - 1);
  const end = Math.min(lines.length, symbol.endLine);
  const snippet = lines.slice(start, end);
  const padLen = String(end).length;
  return snippet
    .map((line, i) => {
      const lineNum = symbol.line + i;
      return `${String(lineNum).padStart(padLen)}  ${line}`;
    })
    .join("\n");
}

export function querySymbols(
  graph: Graph,
  pattern: string,
): SymbolNode[] {
  try {
    const re = new RegExp(pattern, "i");
    return graph.symbols.filter(
      (s) =>
        re.test(s.name) ||
        re.test(s.file) ||
        re.test(s.packageName),
    );
  } catch {
    const lower = pattern.toLowerCase();
    return graph.symbols.filter(
      (s) =>
        s.name.toLowerCase().includes(lower) ||
        s.file.toLowerCase().includes(lower) ||
        s.packageName.toLowerCase().includes(lower),
    );
  }
}

export function findImports(
  graph: Graph,
  importPath: string,
): ImportEdge[] {
  const lower = importPath.toLowerCase();
  return graph.imports.filter((i) =>
    i.importPath.toLowerCase().includes(lower),
  );
}

export function findPublic(
  graph: Graph,
  packageName?: string,
): SymbolNode[] {
  return graph.symbols.filter(
    (s) =>
      s.isExported &&
      (packageName === undefined || s.packageName === packageName),
  );
}

export function focusPackage(
  graph: Graph,
  packageName: string,
): FocusResult | undefined {
  const pkg = graph.packages.find((p) => p.name === packageName);
  if (!pkg) return undefined;
  const files = graph.files.filter((f) => f.packageName === packageName);
  const symbols = graph.symbols.filter(
    (s) => s.packageName === packageName,
  );
  const imports = graph.imports.filter(
    (i) => i.fromPackage === packageName,
  );
  return { pkg, files, symbols, imports };
}

export function context(
  graph: Graph,
  symbolName: string,
): ContextResult {
  const node = findNode(graph, symbolName);
  let source: string | undefined;
  if (node) {
    try {
      source = readSource(graph, node);
    } catch {
      // source file not available
    }
  }
  const callers = findCallers(graph, symbolName);
  const callees = findCallees(graph, symbolName);
  return { node, source, callers, callees };
}
