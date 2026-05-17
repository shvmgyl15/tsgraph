#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { scanFiles } from "../scanner/index.js";
import type { ScannedFile } from "../scanner/index.js";
import { parseProject } from "../parser/index.js";
import { serialize } from "../graph/types.js";
import { generateReport } from "../report/index.js";
import {
  loadGraph,
  findCallers,
  findCallees,
  findNode,
  readSource,
  querySymbols,
  findImports,
  findPublic,
  focusPackage,
  context,
} from "../search/index.js";
import {
  analyzeComplexity,
  findHotspots,
  analyzeCoupling,
  dependencyTree,
} from "../analysis/index.js";
import type { DepsNode } from "../analysis/index.js";
import {
  impact,
  findPath,
  findOrphans,
  trace,
} from "../traversal/index.js";
import type { ImpactNode } from "../traversal/index.js";
import { startMcpServer } from "../mcp/server.js";
import {
  checkBoundaries,
  loadBoundariesConfig,
} from "../boundaries/index.js";
import { getChanges, getStale } from "../changes/index.js";
import { generatePlan, generateReview } from "../plan/index.js";
import { addOpencodePlugin } from "../opencode/index.js";

const program = new Command();

function loadGraphFromCwd(): ReturnType<typeof loadGraph> {
  const graphPath = path.resolve(process.cwd(), ".tsgraph", "graph.json");
  return loadGraph(graphPath);
}

function handleError(err: unknown) {
  console.error((err as Error).message);
  process.exit(1);
}

program
  .name("tsgraph")
  .description("Local AST-based TypeScript/React/Next.js codebase indexer")
  .version("0.1.0");

function buildManifest(rootDir: string, files: ScannedFile[]): void {
  const manifest: Record<string, { mtime: number; size: number }> = {};
  for (const sf of files) {
    try {
      const stat = fs.statSync(sf.path);
      manifest[sf.relativePath] = { mtime: stat.mtimeMs, size: stat.size };
    } catch {
      // skip files that can't be stat'd
    }
  }
  const manifestPath = path.join(rootDir, ".tsgraph", "manifest.json");
  fs.writeFileSync(manifestPath, JSON.stringify({ version: 1, files: manifest }, null, 2), "utf-8");
}

function isBuildStale(rootDir: string, files: ScannedFile[]): boolean {
  const manifestPath = path.join(rootDir, ".tsgraph", "manifest.json");
  let manifest: { version?: number; files?: Record<string, { mtime: number; size: number }> };
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch {
    return true;
  }
  if (!manifest.files) return true;
  const scanned = new Set<string>();
  for (const sf of files) {
    scanned.add(sf.relativePath);
    const old = manifest.files[sf.relativePath];
    if (!old) return true;
    let stat: { mtimeMs: number; size: number };
    try {
      stat = fs.statSync(sf.path);
    } catch {
      return true;
    }
    if (old.mtime !== stat.mtimeMs || old.size !== stat.size) return true;
  }
  for (const key of Object.keys(manifest.files)) {
    if (!scanned.has(key)) return true;
  }
  return false;
}

program
  .command("build")
  .description("Generate .tsgraph/graph.json and GRAPH_REPORT.md")
  .argument("<root>", "root directory of the project")
  .option("--precise", "use type-checked enrichment (slower)")
  .option("--force", "force full rebuild even if no changes detected")
  .action((root: string, opts: { precise?: boolean; force?: boolean }) => {
    const rootDir = path.resolve(root);

    const { files, errors } = scanFiles(rootDir);
    for (const err of errors) {
      console.error("scan warning:", err.message);
    }

    const outDir = path.join(rootDir, ".tsgraph");
    fs.mkdirSync(outDir, { recursive: true });

    if (!opts.force && !isBuildStale(rootDir, files)) {
      console.log("tsgraph: no changes detected (use --force to rebuild)");
      return;
    }

    const graph = parseProject(rootDir, files);

    const graphPath = path.join(outDir, "graph.json");
    fs.writeFileSync(graphPath, serialize(graph), "utf-8");

    buildManifest(rootDir, files);

    const reportPath = path.join(outDir, "GRAPH_REPORT.md");
    fs.writeFileSync(
      reportPath,
      generateReport(graph, {
        rootDir,
        includeBoundaries: true,
        includeStale: true,
        includeHotspots: true,
      }),
      "utf-8",
    );

    const fileCount = graph.files.length;
    const symbolCount = graph.symbols.length;
    const callCount = graph.calls.length;
    const depCount = graph.dependencies.length;

    console.log(
      `tsgraph: indexed ${fileCount} files, ${symbolCount} symbols, ${callCount} calls, ${depCount} deps`,
    );
  });

program
  .command("callers <symbol>")
  .description("Show which functions call a given symbol")
  .action((symbol: string) => {
    try {
      const graph = loadGraphFromCwd();
      const results = findCallers(graph, symbol);
      if (results.length === 0) {
        console.log(`No callers found for "${symbol}"`);
        return;
      }
      console.log(`Callers of "${symbol}" (${results.length}):`);
      for (const r of results) {
        const locations = r.edges
          .map((e) => `${e.file}:${e.line}`)
          .join(", ");
        console.log(`  ${r.callerSymbol.name} — ${locations}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("callees <symbol>")
  .description("Show which functions a given symbol calls")
  .action((symbol: string) => {
    try {
      const graph = loadGraphFromCwd();
      const results = findCallees(graph, symbol);
      if (results.length === 0) {
        console.log(`No callees found for "${symbol}"`);
        return;
      }
      console.log(`Callees of "${symbol}" (${results.length}):`);
      for (const r of results) {
        const locations = r.edges
          .map((e) => `${e.file}:${e.line}`)
          .join(", ");
        console.log(`  ${r.calleeRaw} — ${locations}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("node <symbol>")
  .description("Show detailed information about a symbol")
  .action((symbol: string) => {
    try {
      const graph = loadGraphFromCwd();
      const n = findNode(graph, symbol);
      if (!n) {
        console.log(`Symbol "${symbol}" not found`);
        return;
      }
      console.log(`Node: ${n.name}`);
      console.log(`  Kind:      ${n.kind}`);
      console.log(`  File:      ${n.file}:${n.line}`);
      console.log(`  Lines:     ${n.line}–${n.endLine}`);
      console.log(`  Exported:  ${n.isExported}`);
      console.log(`  Package:   ${n.packageName}`);
      if (n.receiver) console.log(`  Receiver:  ${n.receiver}`);
      if (n.arity !== undefined) console.log(`  Arity:     ${n.arity}`);
      if (n.doc) console.log(`  Doc:       ${n.doc}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("source <symbol>")
  .description("Extract the source code for a specific symbol")
  .action((symbol: string) => {
    try {
      const graph = loadGraphFromCwd();
      const n = findNode(graph, symbol);
      if (!n) {
        console.log(`Symbol "${symbol}" not found`);
        return;
      }
      try {
        const src = readSource(graph, n);
        console.log(`// ${n.file}:${n.line}–${n.endLine}`);
        console.log(src);
      } catch {
        console.log(`Could not read source file: ${n.file}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("query <pattern>")
  .description("Search for symbols matching a pattern")
  .action((pattern: string) => {
    try {
      const graph = loadGraphFromCwd();
      const results = querySymbols(graph, pattern);
      if (results.length === 0) {
        console.log(`No symbols matching "${pattern}"`);
        return;
      }
      const kindCount = new Map<string, number>();
      for (const s of results) {
        kindCount.set(s.kind, (kindCount.get(s.kind) ?? 0) + 1);
      }
      console.log(
        `Found ${results.length} symbols matching "${pattern}":`,
      );
      console.log(`  Kinds: ${[...kindCount.entries()].map(([k, c]) => `${k}(${c})`).join(", ")}`);
      for (const s of results) {
        const exported = s.isExported ? "export " : "";
        const receiver = s.receiver ? `${s.receiver}.` : "";
        console.log(`  ${exported}${s.kind} ${receiver}${s.name} — ${s.file}:${s.line}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("imports <path>")
  .description("Find all files importing a specific package path")
  .action((importPath: string) => {
    try {
      const graph = loadGraphFromCwd();
      const results = findImports(graph, importPath);
      if (results.length === 0) {
        console.log(`No imports matching "${importPath}"`);
        const pkgPath = path.resolve(process.cwd(), "package.json");
        try {
          if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
            const deps = { ...pkg.dependencies, ...pkg.devDependencies };
            const lower = importPath.toLowerCase();
            const depMatches = Object.keys(deps).filter((k) => k.toLowerCase().includes(lower));
            if (depMatches.length > 0) {
              console.log(`Hint: "${depMatches[0]}" is in package.json dependencies but has no direct imports in source code.`);
            }
          }
        } catch {
          // ignore package.json read/parse errors
        }
        return;
      }
      console.log(`Imports matching "${importPath}" (${results.length}):`);
      for (const r of results) {
        const alias = r.alias ? ` as ${r.alias}` : "";
        const kind = r.isDefault ? "default" : "named";
        console.log(`  ${r.fromFile} → ${kind} import ${r.importPath}${alias}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("public [package]")
  .description("Show exported symbols, optionally scoped to a package")
  .action((packageName?: string) => {
    try {
      const graph = loadGraphFromCwd();
      const results = findPublic(graph, packageName);
      if (results.length === 0) {
        console.log("No exported symbols found");
        return;
      }
      const scope = packageName ? ` in package "${packageName}"` : "";
      console.log(`Exported symbols${scope} (${results.length}):`);
      for (const s of results) {
        const receiver = s.receiver ? `${s.receiver}.` : "";
        console.log(`  ${s.kind} ${receiver}${s.name} — ${s.file}:${s.line}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("focus <package>")
  .description("Show all assets for a specific package")
  .action((packageName: string) => {
    try {
      const graph = loadGraphFromCwd();
      const result = focusPackage(graph, packageName);
      if (!result) {
        console.log(`Package "${packageName}" not found`);
        return;
      }
      console.log(`Package: ${result.pkg.name}`);
      console.log(`  Files:   ${result.files.length}`);
      console.log(`  Symbols: ${result.symbols.length}`);
      console.log(`  Imports: ${result.imports.length}`);
      console.log("");
      if (result.symbols.length > 0) {
        console.log("Symbols:");
        for (const s of result.symbols.slice(0, 30)) {
          const exported = s.isExported ? "export " : "";
          const receiver = s.receiver ? `${s.receiver}.` : "";
          console.log(`  ${exported}${s.kind} ${receiver}${s.name} — ${s.file}:${s.line}`);
        }
        if (result.symbols.length > 30) {
          console.log(`  ... and ${result.symbols.length - 30} more`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("context <symbol>")
  .description("Bundle node, source, callers, and callees for a symbol")
  .action((symbol: string) => {
    try {
      const graph = loadGraphFromCwd();
      const ctx = context(graph, symbol);
      if (!ctx.node) {
        console.log(`Symbol "${symbol}" not found`);
        return;
      }
      console.log(`=== Context: ${ctx.node.name} ===`);
      console.log(`Kind: ${ctx.node.kind} | File: ${ctx.node.file}:${ctx.node.line}`);
      console.log("");

      if (ctx.source) {
        console.log("--- Source ---");
        console.log(ctx.source);
        console.log("");
      }

      if (ctx.callers.length > 0) {
        console.log(`--- Callers (${ctx.callers.length}) ---`);
        for (const r of ctx.callers) {
          const locations = r.edges
            .map((e) => `${e.file}:${e.line}`)
            .join(", ");
          console.log(`  ${r.callerSymbol.name} — ${locations}`);
        }
        console.log("");
      }

      if (ctx.callees.length > 0) {
        console.log(`--- Callees (${ctx.callees.length}) ---`);
        for (const r of ctx.callees) {
          const locations = r.edges
            .map((e) => `${e.file}:${e.line}`)
            .join(", ");
          console.log(`  ${r.calleeRaw} — ${locations}`);
        }
        console.log("");
      }
    } catch (err) {
      handleError(err);
    }
  });

function printDepsTree(node: DepsNode, prefix: string = "", isLast: boolean = true) {
  const connector = isLast ? "└── " : "├── ";
  console.log(`${prefix}${connector}${node.name} (${node.kind}, ${node.file}:${node.line})`);
  const childPrefix = prefix + (isLast ? "    " : "│   ");
  for (let i = 0; i < node.children.length; i++) {
    printDepsTree(node.children[i], childPrefix, i === node.children.length - 1);
  }
}

program
  .command("complexity [file]")
  .description("Show cyclomatic complexity for functions and methods")
  .option("-s, --sort", "Sort by complexity descending")
  .option("-m, --min <number>", "Minimum complexity threshold")
  .option("-j, --json", "Output as JSON")
  .action((file: string | undefined, opts: { sort?: boolean; min?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const results = analyzeComplexity(graph, file);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No functions or methods found.");
        return;
      }

      let filtered = results;
      if (opts.min) {
        const threshold = parseInt(opts.min, 10);
        filtered = results.filter((r) => r.complexity >= threshold);
      }

      if (opts.sort) {
        filtered.sort((a, b) => b.complexity - a.complexity);
      }

      const maxNameLen = Math.max(...filtered.map((r) => r.symbol.name.length), 6);
      const header = `${"Symbol".padEnd(maxNameLen)}  Complexity  File:Line`;
      console.log(header);
      console.log("─".repeat(header.length));
      for (const r of filtered) {
        const receiver = r.symbol.receiver ? `${r.symbol.receiver}.` : "";
        console.log(
          `${(receiver + r.symbol.name).padEnd(maxNameLen)}  ${String(r.complexity).padStart(9)}  ${r.symbol.file}:${r.symbol.line}`,
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("hotspot")
  .description("Rank files by complexity × size (hotness score)")
  .option("-t, --top <number>", "Number of results", "10")
  .option("-j, --json", "Output as JSON")
  .action((opts: { top?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const topN = parseInt(opts.top ?? "10", 10);
      const hotspots = findHotspots(graph, topN);

      if (opts.json) {
        console.log(JSON.stringify(hotspots, null, 2));
        return;
      }

      if (hotspots.length === 0) {
        console.log("No hotspots found.");
        return;
      }

      const header = "File                                                 Score    Symbols  Complexity  Lines";
      console.log(header);
      console.log("─".repeat(header.length));
      for (const h of hotspots) {
        console.log(
          `${h.file.padEnd(52)} ${String(h.score).padStart(7)} ${String(h.symbolCount).padStart(8)} ${String(h.totalComplexity).padStart(11)} ${String(h.lines).padStart(6)}`,
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("coupling")
  .description("Show package coupling based on import edges")
  .option("-p, --package <name>", "Filter to a specific package")
  .option("-j, --json", "Output as JSON")
  .action((opts: { package?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      let results = analyzeCoupling(graph);

      if (opts.package) {
        results = results.filter((r) => r.packageName === opts.package);
      }

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No coupling data found.");
        return;
      }

      const header = "Package       Coupled To        Imports  Files";
      console.log(header);
      console.log("─".repeat(header.length));
      for (const r of results) {
        console.log(
          `${r.packageName.padEnd(14)} ${r.coupledTo.padEnd(18)} ${String(r.importCount).padStart(7)} ${String(r.fileCount).padStart(6)}`,
        );
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("deps <symbol>")
  .description("Show the call dependency tree for a symbol")
  .option("-d, --depth <number>", "Max tree depth", "3")
  .action((symbol: string, opts: { depth?: string }) => {
    try {
      const graph = loadGraphFromCwd();
      const maxDepth = parseInt(opts.depth ?? "3", 10);
      const tree = dependencyTree(graph, symbol, maxDepth);

      if (!tree) {
        console.log(`Symbol "${symbol}" not found.`);
        return;
      }

      console.log(`Dependency tree for "${symbol}" (depth ${maxDepth}):`);
      console.log("");
      printDepsTree(tree);
    } catch (err) {
      handleError(err);
    }
  });

function printImpactTree(results: ImpactNode[], symbolName: string) {
  const byDepth = new Map<number, ImpactNode[]>();
  for (const r of results) {
    const list = byDepth.get(r.depth) ?? [];
    list.push(r);
    byDepth.set(r.depth, list);
  }

  console.log(`Impact of "${symbolName}":`);
  for (const [depth, nodes] of [...byDepth.entries()].sort((a, b) => a[0] - b[0])) {
    for (const n of nodes) {
      const prefix = "  ".repeat(depth);
      console.log(`${prefix}${n.symbol.name} (depth ${depth}, ${n.symbol.file}:${n.symbol.line})`);
      }
    }
  }

program
  .command("impact <symbol>")
  .description("Show downstream blast radius (callers recursively)")
  .option("--depth <number>", "Max traversal depth", "5")
  .option("-j, --json", "Output as JSON")
  .action((symbol: string, opts: { depth?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const maxDepth = parseInt(opts.depth ?? "5", 10);
      const results = impact(graph, symbol, maxDepth);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No callers found for "${symbol}".`);
        return;
      }

      printImpactTree(results, symbol);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("path <from> <to>")
  .description("Find shortest call path between two symbols")
  .option("--depth <number>", "Max traversal depth", "10")
  .option("-j, --json", "Output as JSON")
  .action((from: string, to: string, opts: { depth?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const maxDepth = parseInt(opts.depth ?? "10", 10);
      const results = findPath(graph, from, to, maxDepth);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (!results) {
        console.log(`No path found from "${from}" to "${to}".`);
        return;
      }

      console.log(`Shortest path from "${from}" to "${to}":`);
      for (let i = 0; i < results.length; i++) {
        const n = results[i];
        const arrow = i < results.length - 1 ? " →" : "";
        console.log(`  ${n.kind} ${n.name} (${n.file}:${n.line})${arrow}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("orphans")
  .description("Find dead code — symbols with no callers or tests")
  .option("-j, --json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const results = findOrphans(graph);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log("No orphans found.");
        return;
      }

      console.log(`Orphans (${results.length}):`);
      for (const r of results) {
        console.log(`  ${r.symbol.kind} ${r.symbol.name} — ${r.reason} (${r.symbol.file}:${r.symbol.line})`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("trace <string>")
  .description("Find a string literal across symbols and trace callers upstream")
  .option("--depth <number>", "Max caller traversal depth", "5")
  .option("-j, --json", "Output as JSON")
  .action((searchString: string, opts: { depth?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const maxDepth = parseInt(opts.depth ?? "5", 10);
      const results = trace(graph, searchString, maxDepth);

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`No matches found for "${searchString}".`);
        return;
      }

      console.log(`Trace results for "${searchString}" (${results.length} match(es)):`);
      for (const r of results) {
        console.log(`  ${r.match.symbol.name} at ${r.match.file}:${r.match.line}`);
        console.log(`    context: ${r.match.contextLine}`);
        if (r.callers.length > 0) {
          console.log(`    callers: ${r.callers.map((c) => c.symbol.name).join(", ")}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("boundaries")
  .description("Check architecture boundaries defined in .tsgraph/boundaries.json")
  .option("-j, --json", "Output as JSON")
  .action((opts: { json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const config = loadBoundariesConfig(process.cwd());
      if (!config) {
        console.log("No .tsgraph/boundaries.json found.");
        return;
      }
      const result = checkBoundaries(graph, config);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Boundary check: ${result.violations.length} violation(s), ${result.allowed} allowed`);
      console.log(`Layers: ${config.layers.map((l) => l.name).join(", ")}`);
      console.log("");
      if (result.violations.length > 0) {
        console.log("Violations:");
        for (const v of result.violations) {
          console.log(`  ❌ ${v.fromFile} → ${v.toFile}: ${v.rule}`);
        }
      } else {
        console.log("All imports respect layer boundaries.");
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("changes")
  .description("Show files and symbols changed vs a base branch")
  .option("--base <branch>", "Base branch to compare against", "main")
  .option("-j, --json", "Output as JSON")
  .action((opts: { base?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const result = getChanges(graph, process.cwd(), opts.base ?? "main");

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.totalFiles === 0) {
        console.log("No changes found.");
        return;
      }

      console.log(`Changes vs "${opts.base}" (${result.totalFiles} files, ${result.totalSymbols} symbols):`);
      for (const f of result.files) {
        const status = f.status === "added" ? "+" : f.status === "deleted" ? "-" : "M";
        console.log(`  ${status} ${f.path} (${f.symbolCount} symbols)`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("stale")
  .description("Show files not modified in N days")
  .option("--days <number>", "Staleness threshold in days", "90")
  .option("-j, --json", "Output as JSON")
  .action((opts: { days?: string; json?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const days = parseInt(opts.days ?? "90", 10);
      const result = getStale(graph, process.cwd(), days);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (result.totalFiles === 0) {
        console.log("No stale files found.");
        return;
      }

      console.log(`Stale files (${days}+ days, ${result.totalFiles} total):`);
      for (const f of result.files) {
        console.log(`  ${f.path} — ${f.symbolCount} symbol(s): ${f.symbolNames.join(", ")}`);
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("plan")
  .description("Generate a change plan showing blast radius for given files/symbols")
  .argument("<files...>", "Files being changed")
  .option("-s, --symbols <symbols>", "Comma-separated symbols being changed")
  .option("--md", "Output as Markdown")
  .action((files: string[], opts: { symbols?: string; md?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const symbols = opts.symbols ? opts.symbols.split(",").map((s) => s.trim()).filter(Boolean) : [];
      const result = generatePlan(graph, files, symbols);

      if (opts.md) {
        console.log(`## Change Plan`);
        console.log(``);
        console.log(`${result.summary}`);
        console.log(``);
        console.log(`### Files Changed`);
        for (const f of result.changes.files) {
          console.log(`- \`${f}\``);
        }
        console.log(``);
        console.log(`### Symbols Changed`);
        for (const s of result.changes.symbols) {
          console.log(`- \`${s}\``);
        }
        console.log(``);
        console.log(`### Affected Files`);
        for (const f of result.affectedFiles) {
          console.log(`- \`${f}\``);
        }
        console.log(``);
        console.log(`### Caller Impact`);
        for (const c of result.affectedCallers) {
          console.log(`- \`${c.symbol.name}\` — ${c.callerCount} caller(s) at ${c.symbol.file}:${c.symbol.line}`);
        }
        return;
      }

      console.log(result.summary);
      console.log("");
      console.log(`Files changed: ${result.changes.files.length}`);
      for (const f of result.changes.files) {
        console.log(`  ${f}`);
      }
      console.log(`Symbols changed: ${result.changes.symbols.length}`);
      for (const s of result.changes.symbols) {
        const sym = graph.symbols.find((n) => n.name === s);
        if (sym) console.log(`  ${sym.kind} ${s} — ${sym.file}:${sym.line}`);
      }
      console.log(`Affected files: ${result.affectedFiles.length}`);
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("review")
  .description("Generate a code review summary vs a base branch")
  .option("--base <branch>", "Base branch to compare against", "main")
  .option("--md", "Output as Markdown")
  .action((opts: { base?: string; md?: boolean }) => {
    try {
      const graph = loadGraphFromCwd();
      const result = generateReview(graph, process.cwd(), opts.base ?? "main");

      if (opts.md) {
        console.log(`## Code Review`);
        console.log(``);
        console.log(`${result.summary}`);
        console.log(``);
        if (result.findings.length > 0) {
          console.log(`### Findings`);
          for (const f of result.findings) {
            const icon = f.type === "orphan" ? "💀" : f.type === "boundary" ? "🚫" : "📦";
            console.log(`- ${icon} \`${f.type}\`: ${f.detail}`);
          }
        }
        return;
      }

      console.log(result.summary);
      if (result.findings.length > 0) {
        console.log("");
        console.log("Findings:");
        for (const f of result.findings) {
          console.log(`  [${f.type}] ${f.detail}`);
        }
      }
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("add-opencode-plugin")
  .description("Configure opencode to use tsgraph (updates opencode.json, creates .opencode/agents/tsgraph.json)")
  .action(() => {
    try {
      const result = addOpencodePlugin(process.cwd());
      if (result.errors.length > 0) {
        for (const err of result.errors) {
          console.error("Error:", err);
        }
      }
      if (result.opencodeJsonUpdated) console.log("✓ Updated opencode.json with tsgraph MCP server");
      if (result.agentCreated) console.log("✓ Created .opencode/agents/tsgraph.json");
      if (result.errors.length === 0) console.log("Done.");
    } catch (err) {
      handleError(err);
    }
  });

program
  .command("mcp")
  .description("Start the MCP stdio server for AI agent integration")
  .option("--root <path>", "Project root directory (defaults to cwd)")
  .action(async (opts: { root?: string }) => {
    try {
      const rootDir = opts.root ? path.resolve(opts.root) : process.cwd();
      await startMcpServer(rootDir);
    } catch (err) {
      handleError(err);
    }
  });

program.parse(process.argv);
