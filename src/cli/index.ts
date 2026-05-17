#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { scanFiles } from "../scanner/index.js";
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

program
  .command("build")
  .description("Generate .tsgraph/graph.json and GRAPH_REPORT.md")
  .argument("<root>", "root directory of the project")
  .option("--precise", "use type-checked enrichment (slower)")
  .action((root: string) => {
    const rootDir = path.resolve(root);

    const { files, errors } = scanFiles(rootDir);
    for (const err of errors) {
      console.error("scan warning:", err.message);
    }

    const graph = parseProject(rootDir, files);

    const outDir = path.join(rootDir, ".tsgraph");
    fs.mkdirSync(outDir, { recursive: true });

    const graphPath = path.join(outDir, "graph.json");
    fs.writeFileSync(graphPath, serialize(graph), "utf-8");

    const reportPath = path.join(outDir, "GRAPH_REPORT.md");
    fs.writeFileSync(reportPath, generateReport(graph), "utf-8");

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

program.parse(process.argv);
