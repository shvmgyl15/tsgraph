import type { Graph } from "../graph/types.js";
import fs from "node:fs";
import path from "node:path";
import { analyzeCoupling, findHotspots } from "../analysis/index.js";
import { checkBoundaries, loadBoundariesConfig } from "../boundaries/index.js";
import { getStale } from "../changes/index.js";

export interface ReportOptions {
  rootDir?: string;
  includeBoundaries?: boolean;
  includeStale?: boolean;
  includeHotspots?: boolean;
}

export function generateReport(graph: Graph, opts: ReportOptions = {}): string {
  const lines: string[] = [];

  lines.push("# tsgraph Report");
  lines.push("");
  lines.push(`Generated at: ${graph.generatedAt}`);
  lines.push(`Root: \`${graph.root}\``);
  lines.push("");

  lines.push("## Packages");
  lines.push("");
  for (const pkg of graph.packages) {
    lines.push(`- **${pkg.name}** — ${pkg.files.length} files`);
  }
  lines.push("");

  if (graph.dependencies.length > 0) {
    lines.push("## Dependencies");
    lines.push("");
    lines.push("| Module | Version |");
    lines.push("| --- | --- |");
    for (const dep of graph.dependencies) {
      lines.push(`| \`${dep.module}\` | \`${dep.version}\` |`);
    }
    lines.push("");
  }

  lines.push("## Symbols");
  lines.push("");
  const kindCounts = new Map<string, number>();
  for (const sym of graph.symbols) {
    kindCounts.set(sym.kind, (kindCounts.get(sym.kind) ?? 0) + 1);
  }
  for (const [kind, count] of [...kindCounts.entries()].sort()) {
    lines.push(`- **${kind}**: ${count}`);
  }
  lines.push("");

  if (opts.includeHotspots) {
    lines.push("## Hotspots");
    lines.push("");
    const hotspots = findHotspots(graph, 10);
    if (hotspots.length > 0) {
      lines.push("| File | Score | Complexity | Lines |");
      lines.push("| --- | --- | --- | --- |");
      for (const h of hotspots) {
        lines.push(`| \`${h.file}\` | ${h.score} | ${h.totalComplexity} | ${h.lines} |`);
      }
      lines.push("");
    }
  }

  if (opts.includeBoundaries && opts.rootDir) {
    const config = loadBoundariesConfig(opts.rootDir);
    if (config) {
      const result = checkBoundaries(graph, config);
      lines.push("## Architecture Boundaries");
      lines.push("");
      lines.push(`- Layers: ${config.layers.map((l) => l.name).join(", ")}`);
      lines.push(`- Allowed imports: ${result.allowed}`);
      lines.push(`- Violations: ${result.violations.length}`);
      if (result.violations.length > 0) {
        lines.push("");
        for (const v of result.violations.slice(0, 20)) {
          lines.push(`- ❌ \`${v.fromFile}\` → \`${v.toFile}\`: ${v.rule}`);
        }
        if (result.violations.length > 20) {
          lines.push(`- ... and ${result.violations.length - 20} more`);
        }
      }
      lines.push("");
    }
  }

  if (opts.includeStale && opts.rootDir) {
    const stale = getStale(graph, opts.rootDir, 90);
    if (stale.totalFiles > 0) {
      lines.push("## Stale Files");
      lines.push("");
      lines.push(`Files untouched in 90+ days: ${stale.totalFiles}`);
      for (const f of stale.files.slice(0, 20)) {
        lines.push(`- \`${f.path}\` — ${f.symbolCount} symbol(s)`);
      }
      if (stale.files.length > 20) {
        lines.push(`- ... and ${stale.files.length - 20} more`);
      }
      lines.push("");
    }
  }

  if (graph.packages.length > 1) {
    lines.push("## Coupling");
    lines.push("");
    const coupling = analyzeCoupling(graph).slice(0, 15);
    if (coupling.length > 0) {
      lines.push("| Package | Coupled To | Imports | Files |");
      lines.push("| --- | --- | --- | --- |");
      for (const c of coupling) {
        lines.push(`| ${c.packageName} | ${c.coupledTo} | ${c.importCount} | ${c.fileCount} |`);
      }
      lines.push("");
    }
  }

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Files: ${graph.files.length}`);
  lines.push(`- Symbols: ${graph.symbols.length}`);
  lines.push(`- Calls: ${graph.calls.length}`);
  lines.push(`- Imports: ${graph.imports.length}`);
  lines.push(`- Dependencies: ${graph.dependencies.length}`);

  return lines.join("\n") + "\n";
}
