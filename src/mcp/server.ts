import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod/v4";
import type { Graph } from "../graph/types.js";
import { deserialize } from "../graph/types.js";
import { findCallers, findCallees, findNode, querySymbols, findImports, findPublic, context } from "../search/index.js";
import { impact, findPath, findOrphans, trace } from "../traversal/index.js";
import { analyzeComplexity, findHotspots, analyzeCoupling } from "../analysis/index.js";

function loadGraph(rootDir: string): Graph {
  const graphPath = path.join(rootDir, ".tsgraph", "graph.json");
  const raw = fs.readFileSync(graphPath, "utf-8");
  return deserialize(raw);
}

function text(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

function error(msg: string) {
  return { content: [{ type: "text" as const, text: msg }], isError: true as const };
}

function withGraph<T>(rootDir: string, fn: (graph: Graph) => T): T {
  try {
    const graph = loadGraph(rootDir);
    return fn(graph);
  } catch (err) {
    throw new Error(`Failed to load graph: ${(err as Error).message}`);
  }
}

export async function startMcpServer(rootDir: string): Promise<void> {
  const server = new McpServer({
    name: "tsgraph",
    version: "0.1.0",
  });

  server.resource(
    "graph.json",
    `file://${path.join(rootDir, ".tsgraph", "graph.json")}`,
    { mimeType: "application/json" },
    async (uri) => ({
      contents: [{
        uri: uri.href,
        mimeType: "application/json",
        text: fs.readFileSync(new URL(uri.href), "utf-8"),
      }],
    }),
  );

  server.registerTool("callers", {
    description: "Find which functions call a given symbol",
    inputSchema: z.object({ symbol: z.string() }),
  }, async ({ symbol }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findCallers(g, symbol)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("callees", {
    description: "Find which functions a given symbol calls",
    inputSchema: z.object({ symbol: z.string() }),
  }, async ({ symbol }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findCallees(g, symbol)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("node", {
    description: "Get detailed information about a symbol",
    inputSchema: z.object({ symbol: z.string() }),
  }, async ({ symbol }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findNode(g, symbol)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("query", {
    description: "Search for symbols matching a pattern",
    inputSchema: z.object({ pattern: z.string() }),
  }, async ({ pattern }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => querySymbols(g, pattern)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("context", {
    description: "Bundle node, source, callers, and callees for a symbol",
    inputSchema: z.object({ symbol: z.string() }),
  }, async ({ symbol }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => context(g, symbol)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("imports", {
    description: "Find all files importing a specific package path",
    inputSchema: z.object({ path: z.string() }),
  }, async ({ path: importPath }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findImports(g, importPath)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("public", {
    description: "List exported symbols, optionally scoped to a package",
    inputSchema: z.object({ package: z.string().optional() }),
  }, async ({ package: pkg }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findPublic(g, pkg)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("impact", {
    description: "Show downstream blast radius (callers recursively)",
    inputSchema: z.object({ symbol: z.string(), depth: z.number().optional() }),
  }, async ({ symbol, depth }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => impact(g, symbol, depth)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("path", {
    description: "Find shortest call path between two symbols",
    inputSchema: z.object({ from: z.string(), to: z.string(), depth: z.number().optional() }),
  }, async ({ from, to, depth }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findPath(g, from, to, depth)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("orphans", {
    description: "Find dead code — symbols with no callers or tests",
    inputSchema: z.object({}),
  }, async () => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findOrphans(g)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("trace", {
    description: "Find a string literal across symbols and trace callers upstream",
    inputSchema: z.object({ string: z.string(), depth: z.number().optional() }),
  }, async ({ string: searchStr, depth }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => trace(g, searchStr, depth)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("complexity", {
    description: "Show cyclomatic complexity for functions and methods",
    inputSchema: z.object({ file: z.string().optional(), sort: z.boolean().optional(), min: z.number().optional() }),
  }, async ({ file, sort, min }) => {
    try {
      const graph = loadGraph(rootDir);
      let results = analyzeComplexity(graph, file);
      if (min) results = results.filter((r) => r.complexity >= min);
      if (sort) results.sort((a, b) => b.complexity - a.complexity);
      return text(JSON.stringify(results, null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("hotspot", {
    description: "Rank files by complexity × size (hotness score)",
    inputSchema: z.object({ top: z.number().optional() }),
  }, async ({ top }) => {
    try {
      return text(JSON.stringify(withGraph(rootDir, (g) => findHotspots(g, top)), null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  server.registerTool("coupling", {
    description: "Show package coupling based on import edges",
    inputSchema: z.object({ package: z.string().optional() }),
  }, async ({ package: pkg }) => {
    try {
      const graph = loadGraph(rootDir);
      let results = analyzeCoupling(graph);
      if (pkg) results = results.filter((r) => r.packageName === pkg);
      return text(JSON.stringify(results, null, 2));
    } catch (err) {
      return error((err as Error).message);
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
