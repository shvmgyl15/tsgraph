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
} from "../graph/types.js";
import { cyclomaticComplexity, analyzeComplexity } from "./complexity.js";
import { findHotspots } from "./hotspot.js";
import { analyzeCoupling, dependencyTree } from "./coupling.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

describe("cyclomaticComplexity", () => {
  it("returns 1 for a function with no branches", () => {
    const code = `function greet() { return "hello"; }`;
    expect(cyclomaticComplexity(code)).toBe(1);
  });

  it("counts if statements", () => {
    const code = `function f() {
      if (a) return 1;
      if (b) return 2;
    }`;
    expect(cyclomaticComplexity(code)).toBe(3);
  });

  it("counts if-else as single branch point", () => {
    const code = `function f() {
      if (a) { return 1; }
      else { return 2; }
    }`;
    expect(cyclomaticComplexity(code)).toBe(2);
  });

  it("counts else-if as additional branch", () => {
    const code = `function f() {
      if (a) { return 1; }
      else if (b) { return 2; }
      else { return 3; }
    }`;
    expect(cyclomaticComplexity(code)).toBe(3);
  });

  it("counts for loops", () => {
    const code = `function f() {
      for (let i = 0; i < 10; i++) {}
    }`;
    expect(cyclomaticComplexity(code)).toBe(2);
  });

  it("counts while loops", () => {
    const code = `function f() {
      while (true) { break; }
    }`;
    expect(cyclomaticComplexity(code)).toBe(2);
  });

  it("counts case labels", () => {
    const code = `function f(x: number) {
      switch (x) {
        case 1: return "a";
        case 2: return "b";
        case 3: return "c";
      }
    }`;
    expect(cyclomaticComplexity(code)).toBe(4);
  });

  it("counts catch clauses", () => {
    const code = `function f() {
      try { doStuff(); }
      catch (e) { handle(); }
    }`;
    expect(cyclomaticComplexity(code)).toBe(2);
  });

  it("counts ternary operators", () => {
    const code = `function f() {
      return a ? b : c;
    }`;
    expect(cyclomaticComplexity(code)).toBe(2);
  });

  it("counts logical && and ||", () => {
    const code = `function f() {
      if (a && b || c) return 1;
    }`;
    expect(cyclomaticComplexity(code)).toBe(4);
  });

  it("avoids counting string literals", () => {
    const code = `function f() {
      const s = "if (true) { for(;;) {} }";
      return s;
    }`;
    expect(cyclomaticComplexity(code)).toBe(1);
  });

  it("ignores comments", () => {
    const code = `function f() {
      // if (true) { return 1; }
      /* for(;;) {} */
      return 0;
    }`;
    expect(cyclomaticComplexity(code)).toBe(1);
  });
});

describe("analyzeComplexity", () => {
  it("returns complexity for all functions in a project", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "src/lib.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        "export function simple() { return 1; }",
        "export function complex() {",
        "  if (a) { for(;;) {} }",
        "  return 0;",
        "}",
      ].join("\n"),
      "utf-8",
    );

    const graph = makeGraph({
      root: dir,
      files: [makeFileNode({ path: "src/lib.ts", lines: 5 })],
      symbols: [
        makeSymbolNode({
          id: "simple",
          name: "simple",
          kind: "function",
          file: "src/lib.ts",
          line: 1,
          endLine: 1,
          packageName: "app",
          isExported: true,
        }),
        makeSymbolNode({
          id: "complex",
          name: "complex",
          kind: "function",
          file: "src/lib.ts",
          line: 2,
          endLine: 5,
          packageName: "app",
          isExported: true,
        }),
      ],
    });

    const results = analyzeComplexity(graph);
    expect(results).toHaveLength(2);
    const simple = results.find((r) => r.symbol.name === "simple");
    const complex = results.find((r) => r.symbol.name === "complex");
    expect(simple!.complexity).toBe(1);
    expect(complex!.complexity).toBeGreaterThanOrEqual(2);

    fs.rmSync(dir, { recursive: true });
  });

  it("filters by file when specified", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "src/a.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "export function foo() {}", "utf-8");

    const graph = makeGraph({
      root: dir,
      symbols: [
        makeSymbolNode({
          id: "foo",
          name: "foo",
          kind: "function",
          file: "src/a.ts",
          line: 1,
          endLine: 1,
        }),
        makeSymbolNode({
          id: "bar",
          name: "bar",
          kind: "function",
          file: "src/b.ts",
          line: 1,
          endLine: 1,
        }),
      ],
    });

    const results = analyzeComplexity(graph, "a.ts");
    expect(results).toHaveLength(1);
    expect(results[0].symbol.name).toBe("foo");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("findHotspots", () => {
  it("returns top hotspots sorted by score", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "src/hot.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        "export function a() {",
        "  if (x) { for(;;) {} }",
        "  if (y) { while(z) {} }",
        "  return 0;",
        "}",
        "export function b() { return 1; }",
      ].join("\n"),
      "utf-8",
    );

    const graph = makeGraph({
      root: dir,
      files: [makeFileNode({ path: "src/hot.ts", lines: 6 })],
      symbols: [
        makeSymbolNode({
          id: "a",
          name: "a",
          kind: "function",
          file: "src/hot.ts",
          line: 1,
          endLine: 5,
          packageName: "app",
        }),
        makeSymbolNode({
          id: "b",
          name: "b",
          kind: "function",
          file: "src/hot.ts",
          line: 6,
          endLine: 6,
          packageName: "app",
        }),
      ],
    });

    const hotspots = findHotspots(graph, 5);
    expect(hotspots.length).toBeGreaterThanOrEqual(1);
    expect(hotspots[0].file).toBe("src/hot.ts");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("analyzeCoupling", () => {
  it("finds packages importing from other modules", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/orders.ts", packageName: "orders" }),
        makeFileNode({ path: "src/payment.ts", packageName: "payment" }),
        makeFileNode({ path: "src/notify.ts", packageName: "notify" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/orders.ts",
          fromPackage: "orders",
          importPath: "payment",
          alias: "payment",
          isDefault: true,
        }),
        makeImportEdge({
          fromFile: "src/orders.ts",
          fromPackage: "orders",
          importPath: "notify",
          alias: "notify",
          isDefault: true,
        }),
        makeImportEdge({
          fromFile: "src/orders.ts",
          fromPackage: "orders",
          importPath: "payment",
          alias: "processPayment",
          isDefault: false,
        }),
      ],
    });

    const results = analyzeCoupling(graph);
    expect(results).toHaveLength(2);
    const paymentCoupling = results.find((r) => r.coupledTo === "payment");
    expect(paymentCoupling).toBeTruthy();
    expect(paymentCoupling!.importCount).toBe(2);
    expect(paymentCoupling!.packageName).toBe("orders");
  });
});

describe("dependencyTree", () => {
  it("builds a tree from call edges", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({
          id: "src/main.ts::serve",
          name: "serve",
          kind: "function",
          file: "src/main.ts",
          line: 1,
          endLine: 5,
          packageName: "app",
        }),
        makeSymbolNode({
          id: "src/main.ts::greet",
          name: "greet",
          kind: "function",
          file: "src/main.ts",
          line: 6,
          endLine: 8,
          packageName: "app",
        }),
        makeSymbolNode({
          id: "src/main.ts::log",
          name: "log",
          kind: "function",
          file: "src/main.ts",
          line: 9,
          endLine: 11,
          packageName: "app",
        }),
      ],
      calls: [
        makeCallEdge({
          callerSymbolId: "src/main.ts::serve",
          callerName: "serve",
          calleeRaw: "greet",
          file: "src/main.ts",
          line: 3,
        }),
        makeCallEdge({
          callerSymbolId: "src/main.ts::serve",
          callerName: "serve",
          calleeRaw: "log",
          file: "src/main.ts",
          line: 4,
        }),
      ],
    });

    const tree = dependencyTree(graph, "serve");
    expect(tree).toBeTruthy();
    expect(tree!.name).toBe("serve");
    expect(tree!.children).toHaveLength(2);
    const childNames = tree!.children.map((c) => c.name).sort();
    expect(childNames).toEqual(["greet", "log"]);
  });

  it("returns undefined for unknown symbol", () => {
    const graph = makeGraph();
    const tree = dependencyTree(graph, "noop");
    expect(tree).toBeUndefined();
  });

  it("respects max depth", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({
          id: "a",
          name: "a",
          kind: "function",
          file: "a.ts",
          line: 1,
          endLine: 1,
          packageName: "app",
        }),
        makeSymbolNode({
          id: "b",
          name: "b",
          kind: "function",
          file: "b.ts",
          line: 1,
          endLine: 1,
          packageName: "app",
        }),
        makeSymbolNode({
          id: "c",
          name: "c",
          kind: "function",
          file: "c.ts",
          line: 1,
          endLine: 1,
          packageName: "app",
        }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "a", callerName: "a", calleeRaw: "b", file: "a.ts", line: 1 }),
        makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "c", file: "b.ts", line: 1 }),
      ],
    });

    const tree = dependencyTree(graph, "a", 1);
    expect(tree!.children).toHaveLength(1);
    expect(tree!.children[0].children).toHaveLength(0);
  });
});
