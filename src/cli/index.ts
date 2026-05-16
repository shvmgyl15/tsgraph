#!/usr/bin/env node

import { Command } from "commander";

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
  .action(() => {
    throw new Error("not implemented");
  });

program.parse(process.argv);
