import type { Graph } from "../graph/types.js";

export function generateReport(graph: Graph): string {
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

  lines.push("## Summary");
  lines.push("");
  lines.push(`- Files: ${graph.files.length}`);
  lines.push(`- Symbols: ${graph.symbols.length}`);
  lines.push(`- Calls: ${graph.calls.length}`);
  lines.push(`- Imports: ${graph.imports.length}`);
  lines.push(`- Dependencies: ${graph.dependencies.length}`);

  return lines.join("\n") + "\n";
}
