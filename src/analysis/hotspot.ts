import type { Graph } from "../graph/types.js";
import { analyzeComplexity } from "./complexity.js";

export interface HotspotResult {
  file: string;
  score: number;
  symbolCount: number;
  totalComplexity: number;
  lines: number;
}

export function findHotspots(
  graph: Graph,
  topN: number = 10,
): HotspotResult[] {
  const fileNodes = new Map(graph.files.map((f) => [f.path, f]));
  const complexityResults = analyzeComplexity(graph);
  const fileScores = new Map<
    string,
    { totalComplexity: number; symbolCount: number; lines: number }
  >();

  for (const r of complexityResults) {
    const entry = fileScores.get(r.symbol.file) ?? {
      totalComplexity: 0,
      symbolCount: 0,
      lines: 1,
    };
    entry.totalComplexity += r.complexity;
    entry.symbolCount++;
    fileScores.set(r.symbol.file, entry);
  }

  for (const [filePath, entry] of fileScores) {
    const fn = fileNodes.get(filePath);
    entry.lines = fn?.lines ?? 1;
  }

  const results: HotspotResult[] = [];
  for (const [file, data] of fileScores) {
    results.push({
      file,
      score: data.totalComplexity * data.lines,
      symbolCount: data.symbolCount,
      totalComplexity: data.totalComplexity,
      lines: data.lines,
    });
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, topN);
}
