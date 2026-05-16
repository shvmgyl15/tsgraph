#!/usr/bin/env node

import path from "node:path";
import fs from "node:fs";
import { Command } from "commander";
import { scanFiles } from "../scanner/index.js";
import { parseProject } from "../parser/index.js";
import { serialize } from "../graph/types.js";
import { generateReport } from "../report/index.js";

const program = new Command();

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

program.parse(process.argv);
