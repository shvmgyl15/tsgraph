import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  makeGraph,
  makeSymbolNode,
  makeCallEdge,
  makeImportEdge,
  makePackageNode,
  makeFileNode,
  serialize,
} from "../graph/types.js";
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
} from "./index.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

const baseSymbols = [
  makeSymbolNode({
    id: "src/main.ts::serve",
    name: "serve",
    kind: "function",
    file: "src/main.ts",
    line: 10,
    endLine: 20,
    packageName: "app",
    isExported: true,
  }),
  makeSymbolNode({
    id: "src/main.ts::greet",
    name: "greet",
    kind: "function",
    file: "src/main.ts",
    line: 22,
    endLine: 25,
    packageName: "app",
    isExported: true,
  }),
  makeSymbolNode({
    id: "src/main.ts::log",
    name: "log",
    kind: "function",
    file: "src/main.ts",
    line: 27,
    endLine: 29,
    packageName: "app",
    isExported: false,
  }),
  makeSymbolNode({
    id: "src/utils.ts::helper",
    name: "helper",
    kind: "function",
    file: "src/utils.ts",
    line: 5,
    endLine: 7,
    packageName: "app",
    isExported: false,
  }),
];

const baseCalls = [
  makeCallEdge({
    callerSymbolId: "src/main.ts::serve",
    callerName: "serve",
    calleeRaw: "greet",
    file: "src/main.ts",
    line: 12,
  }),
  makeCallEdge({
    callerSymbolId: "src/main.ts::serve",
    callerName: "serve",
    calleeRaw: "log",
    file: "src/main.ts",
    line: 14,
  }),
  makeCallEdge({
    callerSymbolId: "src/main.ts::greet",
    callerName: "greet",
    calleeRaw: "log",
    file: "src/main.ts",
    line: 23,
  }),
];

const baseImports = [
  makeImportEdge({
    fromFile: "src/main.ts",
    fromPackage: "app",
    importPath: "react",
    alias: "React",
    isDefault: true,
  }),
  makeImportEdge({
    fromFile: "src/main.ts",
    fromPackage: "app",
    importPath: "react",
    alias: "useState",
    isDefault: false,
  }),
  makeImportEdge({
    fromFile: "src/utils.ts",
    fromPackage: "app",
    importPath: "lodash",
    alias: "_",
    isDefault: true,
  }),
];

function buildTestGraph() {
  return makeGraph({
    root: "/test",
    packages: [
      makePackageNode({ name: "app" }),
      makePackageNode({ name: "lib" }),
    ],
    files: [
      makeFileNode({ path: "src/main.ts", packageName: "app" }),
      makeFileNode({ path: "src/utils.ts", packageName: "app" }),
    ],
    symbols: baseSymbols,
    calls: baseCalls,
    imports: baseImports,
  });
}

describe("loadGraph", () => {
  it("round-trips from serialized file", () => {
    const dir = createTempDir();
    const graphPath = path.join(dir, "graph.json");
    const original = buildTestGraph();
    fs.writeFileSync(graphPath, serialize(original), "utf-8");

    const loaded = loadGraph(graphPath);
    expect(loaded.version).toBe(original.version);
    expect(loaded.symbols).toHaveLength(original.symbols.length);
    expect(loaded.calls).toHaveLength(original.calls.length);
    fs.rmSync(dir, { recursive: true });
  });

  it("throws on missing file", () => {
    expect(() => loadGraph("/nonexistent/graph.json")).toThrow();
  });
});

describe("findCallers", () => {
  it("finds callers of a referenced symbol", () => {
    const graph = buildTestGraph();
    const results = findCallers(graph, "greet");
    expect(results).toHaveLength(1);
    expect(results[0].callerSymbol.name).toBe("serve");
    expect(results[0].edges).toHaveLength(1);
  });

  it("finds multiple callers of a symbol", () => {
    const graph = buildTestGraph();
    const results = findCallers(graph, "log");
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.callerSymbol.name).sort();
    expect(names).toEqual(["greet", "serve"]);
  });

  it("returns empty for unreferenced symbol", () => {
    const graph = buildTestGraph();
    const results = findCallers(graph, "helper");
    expect(results).toHaveLength(0);
  });

  it("returns empty for unknown symbol", () => {
    const graph = buildTestGraph();
    const results = findCallers(graph, "nonexistent");
    expect(results).toHaveLength(0);
  });
});

describe("findCallees", () => {
  it("finds callees of a function", () => {
    const graph = buildTestGraph();
    const results = findCallees(graph, "serve");
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.calleeRaw).sort();
    expect(names).toEqual(["greet", "log"]);
  });

  it("finds callees with multiple call sites", () => {
    const graph = buildTestGraph();
    const results = findCallees(graph, "greet");
    expect(results).toHaveLength(1);
    expect(results[0].calleeRaw).toBe("log");
    expect(results[0].edges).toHaveLength(1);
  });

  it("returns empty for leaf function", () => {
    const graph = buildTestGraph();
    const results = findCallees(graph, "log");
    expect(results).toHaveLength(0);
  });

  it("returns empty for unknown symbol", () => {
    const graph = buildTestGraph();
    const results = findCallees(graph, "noop");
    expect(results).toHaveLength(0);
  });
});

describe("findNode", () => {
  it("finds a symbol by exact name", () => {
    const graph = buildTestGraph();
    const n = findNode(graph, "serve");
    expect(n).toBeTruthy();
    expect(n!.kind).toBe("function");
    expect(n!.file).toBe("src/main.ts");
  });

  it("returns undefined for missing symbol", () => {
    const graph = buildTestGraph();
    const n = findNode(graph, "noop");
    expect(n).toBeUndefined();
  });

  it("returns first match when names collide", () => {
    const graph = buildTestGraph();
    // Two symbols with same name in different files
    graph.symbols.push(
      makeSymbolNode({
        id: "src/other.ts::serve",
        name: "serve",
        file: "src/other.ts",
      }),
    );
    const n = findNode(graph, "serve");
    expect(n).toBeTruthy();
    expect(n!.file).toBe("src/main.ts"); // first in array
  });
});

describe("readSource", () => {
  it("extracts the correct line range from a file", () => {
    const dir = createTempDir();
    const root = dir;
    const filePath = path.join(root, "src/main.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, [
      "line 1",
      "line 2",
      "line 3",
      "line 4",
      "line 5",
    ].join("\n"), "utf-8");

    const graph = makeGraph({
      root,
      files: [makeFileNode({ path: "src/main.ts" })],
      symbols: [
        makeSymbolNode({
          id: "src/main.ts::foo",
          name: "foo",
          file: "src/main.ts",
          line: 2,
          endLine: 4,
        }),
      ],
    });

    const sym = graph.symbols[0];
    const src = readSource(graph, sym);
    expect(src).toContain("line 2");
    expect(src).toContain("line 3");
    expect(src).toContain("line 4");
    expect(src).not.toContain("line 1");
    expect(src).not.toContain("line 5");

    // should include line numbers
    expect(src).toMatch(/^2  /m);
    expect(src).toMatch(/^3  /m);
    expect(src).toMatch(/^4  /m);

    fs.rmSync(dir, { recursive: true });
  });

  it("throws on missing file", () => {
    const graph = makeGraph({
      root: "/nonexistent",
      symbols: [
        makeSymbolNode({ name: "foo", file: "foo.ts", line: 1, endLine: 3 }),
      ],
    });
    expect(() => readSource(graph, graph.symbols[0])).toThrow();
  });
});

describe("querySymbols", () => {
  it("matches symbol name case-insensitively", () => {
    const graph = buildTestGraph();
    const results = querySymbols(graph, "GREET");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("greet");
  });

  it("matches file path", () => {
    const graph = buildTestGraph();
    const results = querySymbols(graph, "utils");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("helper");
  });

  it("matches package name", () => {
    const graph = buildTestGraph();
    const results = querySymbols(graph, "app");
    // all 4 symbols are in package "app"
    expect(results.length).toBeGreaterThanOrEqual(4);
  });

  it("returns all symbols for empty pattern", () => {
    const graph = buildTestGraph();
    const results = querySymbols(graph, "");
    expect(results).toHaveLength(graph.symbols.length);
  });

  it("returns empty for no match", () => {
    const graph = buildTestGraph();
    const results = querySymbols(graph, "zzznone");
    expect(results).toHaveLength(0);
  });
});

describe("findImports", () => {
  it("matches import path substring", () => {
    const graph = buildTestGraph();
    const results = findImports(graph, "react");
    expect(results).toHaveLength(2);
  });

  it("returns empty for no match", () => {
    const graph = buildTestGraph();
    const results = findImports(graph, "noop");
    expect(results).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const graph = buildTestGraph();
    const results = findImports(graph, "LODASH");
    expect(results).toHaveLength(1);
    expect(results[0].importPath).toBe("lodash");
  });
});

describe("findPublic", () => {
  it("returns only exported symbols", () => {
    const graph = buildTestGraph();
    const results = findPublic(graph);
    expect(results).toHaveLength(2);
    expect(results.every((s) => s.isExported)).toBe(true);
    const names = results.map((s) => s.name).sort();
    expect(names).toEqual(["greet", "serve"]);
  });

  it("scopes to a package when specified", () => {
    const graph = buildTestGraph();
    // Add an exported symbol in package "lib"
    graph.symbols.push(
      makeSymbolNode({
        id: "lib/helper.ts::run",
        name: "run",
        kind: "function",
        packageName: "lib",
        isExported: true,
      }),
    );
    const results = findPublic(graph, "lib");
    expect(results).toHaveLength(1);
    expect(results[0].name).toBe("run");
  });

  it("returns empty when no exported symbols in package", () => {
    const graph = buildTestGraph();
    const results = findPublic(graph, "missing-pkg");
    expect(results).toHaveLength(0);
  });
});

describe("focusPackage", () => {
  it("returns package assets", () => {
    const graph = buildTestGraph();
    const result = focusPackage(graph, "app");
    expect(result).toBeTruthy();
    expect(result!.pkg.name).toBe("app");
    expect(result!.files).toHaveLength(2);
    expect(result!.symbols).toHaveLength(4);
    expect(result!.imports).toHaveLength(3);
  });

  it("returns undefined for missing package", () => {
    const graph = buildTestGraph();
    const result = focusPackage(graph, "no-pkg");
    expect(result).toBeUndefined();
  });
});

describe("context", () => {
  it("bundles node, source, callers, and callees", () => {
    const dir = createTempDir();
    const root = dir;
    const filePath = path.join(root, "src/main.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const fileLines = [
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "function serve() {",
      "  greet();",
      "  log();",
      "}",
      "",
      "",
      "function greet() {",
      "  log();",
      "}",
    ];
    fs.writeFileSync(filePath, fileLines.join("\n"), "utf-8");

    const graph = makeGraph({
      root,
      packages: [makePackageNode({ name: "app" })],
      files: [makeFileNode({ path: "src/main.ts", packageName: "app" })],
      symbols: [
        makeSymbolNode({
          id: "src/main.ts::serve",
          name: "serve",
          kind: "function",
          file: "src/main.ts",
          line: 10,
          endLine: 13,
          packageName: "app",
          isExported: true,
        }),
        makeSymbolNode({
          id: "src/main.ts::greet",
          name: "greet",
          kind: "function",
          file: "src/main.ts",
          line: 16,
          endLine: 18,
          packageName: "app",
          isExported: true,
        }),
      ],
      calls: [
        makeCallEdge({
          callerSymbolId: "src/main.ts::serve",
          callerName: "serve",
          calleeRaw: "greet",
          file: "src/main.ts",
          line: 11,
        }),
        makeCallEdge({
          callerSymbolId: "src/main.ts::serve",
          callerName: "serve",
          calleeRaw: "log",
          file: "src/main.ts",
          line: 12,
        }),
      ],
    });

    const ctx = context(graph, "serve");
    expect(ctx.node).toBeTruthy();
    expect(ctx.node!.name).toBe("serve");
    expect(ctx.source).toBeTruthy();
    expect(ctx.source).toContain("greet");
    expect(ctx.callers).toHaveLength(0);
    expect(ctx.callees).toHaveLength(2);

    fs.rmSync(dir, { recursive: true });
  });

  it("returns empty source when file is missing", () => {
    const graph = buildTestGraph();
    const ctx = context(graph, "serve");
    expect(ctx.node).toBeTruthy();
    expect(ctx.source).toBeUndefined();
    expect(ctx.callers).toHaveLength(0);
    expect(ctx.callees).toHaveLength(2);
  });

  it("returns partial result for missing symbol", () => {
    const graph = buildTestGraph();
    const ctx = context(graph, "noop");
    expect(ctx.node).toBeUndefined();
    expect(ctx.source).toBeUndefined();
    expect(ctx.callers).toHaveLength(0);
    expect(ctx.callees).toHaveLength(0);
  });
});
