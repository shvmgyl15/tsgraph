import type { Graph, SymbolNode, FileNode } from "../graph/types.js";
import {
  getDiffFiles,
  getStaleFiles,
  isGitRepo,
} from "../git/index.js";
import type { ChangedFile } from "../git/index.js";

export interface ChangedSymbolInfo {
  symbol: SymbolNode;
  file: string;
  status: ChangedFile["status"];
}

export interface ChangeResult {
  files: {
    path: string;
    status: ChangedFile["status"];
    symbolCount: number;
  }[];
  symbols: ChangedSymbolInfo[];
  totalFiles: number;
  totalSymbols: number;
}

export interface StaleResult {
  files: {
    path: string;
    symbolCount: number;
    symbolNames: string[];
  }[];
  totalFiles: number;
}

function symbolsInFile(graph: Graph, filePath: string): SymbolNode[] {
  return graph.symbols.filter((s) => s.file === filePath);
}

export function getChanges(
  graph: Graph,
  rootDir: string,
  base: string = "main",
): ChangeResult {
  if (!isGitRepo(rootDir)) {
    return { files: [], symbols: [], totalFiles: 0, totalSymbols: 0 };
  }

  const changed = getDiffFiles(rootDir, base);
  const files: ChangeResult["files"] = [];
  const symbols: ChangedSymbolInfo[] = [];

  for (const c of changed) {
    const graphFile = graph.files.find((f) => f.path === c.path);
    if (!graphFile) {
      files.push({ path: c.path, status: c.status, symbolCount: 0 });
      continue;
    }
    const fileSymbols = symbolsInFile(graph, c.path);
    files.push({
      path: c.path,
      status: c.status,
      symbolCount: fileSymbols.length,
    });
    for (const sym of fileSymbols) {
      symbols.push({ symbol: sym, file: c.path, status: c.status });
    }
  }

  return { files, symbols, totalFiles: files.length, totalSymbols: symbols.length };
}

export function getStale(
  graph: Graph,
  rootDir: string,
  days: number = 90,
): StaleResult {
  if (!isGitRepo(rootDir)) {
    return { files: [], totalFiles: 0 };
  }

  const stalePaths = getStaleFiles(rootDir, days);
  const files: StaleResult["files"] = [];

  for (const p of stalePaths) {
    const syms = symbolsInFile(graph, p);
    if (syms.length === 0) continue;
    files.push({
      path: p,
      symbolCount: syms.length,
      symbolNames: syms.map((s) => s.name),
    });
  }

  return { files, totalFiles: files.length };
}
