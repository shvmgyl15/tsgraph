import type { Graph, SymbolNode } from "../graph/types.js";
import { findCallers } from "../search/index.js";
import { getDiffFiles, isGitRepo } from "../git/index.js";
import type { ChangedFile } from "../git/index.js";
import { checkBoundaries, loadBoundariesConfig } from "../boundaries/index.js";

export interface PlannedChange {
  files: string[];
  symbols: string[];
}

export interface PlanResult {
  changes: PlannedChange;
  affectedCallers: { symbol: SymbolNode; callerCount: number }[];
  affectedFiles: string[];
  summary: string;
}

export interface ReviewFinding {
  type: "orphan" | "boundary" | "changed_export";
  detail: string;
}

export interface ReviewResult {
  changes: { path: string; status: ChangedFile["status"] }[];
  findings: ReviewFinding[];
  totalChanges: number;
  totalFindings: number;
  summary: string;
}

function symbolsInFile(graph: Graph, filePath: string): SymbolNode[] {
  return graph.symbols.filter((s) => s.file === filePath);
}

export function generatePlan(
  graph: Graph,
  files: string[],
  symbols: string[] = [],
): PlanResult {
  const allSymbolNames = new Set(symbols);

  for (const f of files) {
    for (const sym of symbolsInFile(graph, f)) {
      allSymbolNames.add(sym.name);
    }
  }

  const callersMap = new Map<string, { symbol: SymbolNode; callerCount: number }>();

  for (const symName of allSymbolNames) {
    const sym = graph.symbols.find((s) => s.name === symName);
    if (!sym) continue;
    const callers = findCallers(graph, sym.name);
    callersMap.set(symName, {
      symbol: sym,
      callerCount: callers.length,
    });
  }

  const affectedFiles = new Set<string>();
  for (const [_, info] of callersMap) {
    affectedFiles.add(info.symbol.file);
    const callers = findCallers(graph, info.symbol.name);
    for (const c of callers) {
      affectedFiles.add(c.callerSymbol.file);
    }
  }
  for (const f of files) {
    affectedFiles.add(f);
  }

  const totalAffected = callersMap.size;
  const totalCallers = [...callersMap.values()].reduce(
    (sum, c) => sum + c.callerCount,
    0,
  );

  const summary =
    `Plan: ${files.length} file(s), ${allSymbolNames.size} symbol(s) changed. ` +
    `Affects ${totalAffected} symbol(s) with ${totalCallers} total caller(s) across ${affectedFiles.size} file(s).`;

  return {
    changes: { files, symbols: [...allSymbolNames] },
    affectedCallers: [...callersMap.values()],
    affectedFiles: [...affectedFiles],
    summary,
  };
}

export function generateReview(
  graph: Graph,
  rootDir: string,
  base: string = "main",
): ReviewResult {
  const findings: ReviewFinding[] = [];

  if (!isGitRepo(rootDir)) {
    return {
      changes: [],
      findings: [],
      totalChanges: 0,
      totalFindings: 0,
      summary: "Not a git repository — cannot review.",
    };
  }

  const diffFiles = getDiffFiles(rootDir, base);
  const changedPaths = new Set(diffFiles.map((d) => d.path));

  for (const f of diffFiles) {
    const fileSyms = symbolsInFile(graph, f.path);
    for (const sym of fileSyms) {
      if (f.status === "added") {
        const callers = findCallers(graph, sym.id);
        if (callers.length === 0 && !sym.name.startsWith("_")) {
          findings.push({
            type: "orphan",
            detail: `${sym.kind} ${sym.name} in ${sym.file}:${sym.line} — new symbol has no callers`,
          });
        }
      }
      if (f.status === "modified" || f.status === "added") {
        if (sym.isExported) {
          findings.push({
            type: "changed_export",
            detail: `${sym.isExported ? "exported " : ""}${sym.kind} ${sym.name} in ${sym.file}:${sym.line} — public API change`,
          });
        }
      }
    }
  }

  const boundariesConfig = loadBoundariesConfig(rootDir);
  if (boundariesConfig) {
    const result = checkBoundaries(graph, boundariesConfig);
    for (const v of result.violations) {
      if (changedPaths.has(v.fromFile) || changedPaths.has(v.toFile)) {
        findings.push({
          type: "boundary",
          detail: `${v.fromFile} → ${v.toFile}: ${v.rule}`,
        });
      }
    }
  }

  const summary =
    `Review: ${diffFiles.length} file(s) changed vs "${base}". ` +
    `${findings.length} finding(s): ` +
    `${findings.filter((f) => f.type === "orphan").length} orphan(s), ` +
    `${findings.filter((f) => f.type === "changed_export").length} changed export(s), ` +
    `${findings.filter((f) => f.type === "boundary").length} boundary violation(s).`;

  return {
    changes: diffFiles,
    findings,
    totalChanges: diffFiles.length,
    totalFindings: findings.length,
    summary,
  };
}
