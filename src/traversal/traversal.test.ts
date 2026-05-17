import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  makeGraph,
  makeSymbolNode,
  makeCallEdge,
  makeTestEdge,
  makeFileNode,
} from "../graph/types.js";
import { impact, findPath, findOrphans, trace } from "./traversal.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

describe("impact", () => {
  it("finds direct callers", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "c", name: "c", kind: "function", file: "c.ts", line: 1, endLine: 1 }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "a", file: "b.ts", line: 1 }),
        makeCallEdge({ callerSymbolId: "c", callerName: "c", calleeRaw: "a", file: "c.ts", line: 1 }),
      ],
    });

    const results = impact(graph, "a");
    expect(results).toHaveLength(2);
    const names = results.map((r) => r.symbol.name).sort();
    expect(names).toEqual(["b", "c"]);
    expect(results.every((r) => r.depth === 1)).toBe(true);
  });

  it("traverses multiple levels", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "c", name: "c", kind: "function", file: "c.ts", line: 1, endLine: 1 }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "a", file: "b.ts", line: 1 }),
        makeCallEdge({ callerSymbolId: "c", callerName: "c", calleeRaw: "b", file: "c.ts", line: 1 }),
      ],
    });

    const results = impact(graph, "a");
    expect(results).toHaveLength(2);
    const b = results.find((r) => r.symbol.name === "b");
    const c = results.find((r) => r.symbol.name === "c");
    expect(b).toBeTruthy();
    expect(c).toBeTruthy();
    expect(b!.depth).toBe(1);
    expect(c!.depth).toBe(2);
  });

  it("respects max depth", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "c", name: "c", kind: "function", file: "c.ts", line: 1, endLine: 1 }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "a", file: "b.ts", line: 1 }),
        makeCallEdge({ callerSymbolId: "c", callerName: "c", calleeRaw: "b", file: "c.ts", line: 1 }),
      ],
    });

    const results = impact(graph, "a", 1);
    expect(results).toHaveLength(1);
    expect(results[0].symbol.name).toBe("b");
  });

  it("returns empty for symbol with no callers", () => {
    const graph = makeGraph({
      symbols: [makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 })],
    });
    const results = impact(graph, "a");
    expect(results).toHaveLength(0);
  });

  it("returns empty for unknown symbol", () => {
    const graph = makeGraph();
    const results = impact(graph, "noop");
    expect(results).toHaveLength(0);
  });
});

describe("findPath", () => {
  it("finds a direct path between two symbols", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
      ],
      calls: [makeCallEdge({ callerSymbolId: "a", callerName: "a", calleeRaw: "b", file: "a.ts", line: 1 })],
    });

    const p = findPath(graph, "a", "b");
    expect(p).toBeTruthy();
    expect(p!.map((n) => n.name)).toEqual(["a", "b"]);
  });

  it("finds a multi-hop path", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "c", name: "c", kind: "function", file: "c.ts", line: 1, endLine: 1 }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "a", callerName: "a", calleeRaw: "b", file: "a.ts", line: 1 }),
        makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "c", file: "b.ts", line: 1 }),
      ],
    });

    const p = findPath(graph, "a", "c");
    expect(p).toBeTruthy();
    expect(p!.map((n) => n.name)).toEqual(["a", "b", "c"]);
  });

  it("returns self-path when from === to", () => {
    const graph = makeGraph({
      symbols: [makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 })],
    });
    const p = findPath(graph, "a", "a");
    expect(p).toBeTruthy();
    expect(p!.map((n) => n.name)).toEqual(["a"]);
  });

  it("returns undefined when no path exists", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", file: "a.ts", line: 1, endLine: 1 }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", file: "b.ts", line: 1, endLine: 1 }),
      ],
    });
    const p = findPath(graph, "a", "b");
    expect(p).toBeUndefined();
  });

  it("returns undefined for unknown symbols", () => {
    const graph = makeGraph();
    expect(findPath(graph, "a", "b")).toBeUndefined();
    expect(findPath(graph, "a", "a")).toBeUndefined();
  });
});

describe("findOrphans", () => {
  it("skips unexported symbols that are called", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "a", name: "a", kind: "function", isExported: false }),
        makeSymbolNode({ id: "b", name: "b", kind: "function", isExported: true }),
      ],
      calls: [makeCallEdge({ callerSymbolId: "b", callerName: "b", calleeRaw: "a", file: "b.ts", line: 1 })],
    });

    const orphans = findOrphans(graph);
    const deadNames = orphans.map((o) => o.symbol.name);
    expect(deadNames).not.toContain("a"); // "a" is called by "b"
  });

  it("flags unexported symbols with no callers", () => {
    const graph = makeGraph({
      symbols: [
        makeSymbolNode({ id: "dead", name: "dead", kind: "function", isExported: false }),
        makeSymbolNode({ id: "alive", name: "alive", kind: "function", isExported: false }),
      ],
      calls: [makeCallEdge({ callerSymbolId: "alive", callerName: "alive", calleeRaw: "nonexistent", file: "x.ts", line: 1 })],
    });

    const orphans = findOrphans(graph);
    expect(orphans.some((o) => o.symbol.name === "dead")).toBe(true);
  });

  it("flags exported symbols with no callers or tests", () => {
    const graph = makeGraph({
      symbols: [makeSymbolNode({ id: "unused", name: "unused", kind: "function", isExported: true })],
    });

    const orphans = findOrphans(graph);
    expect(orphans).toHaveLength(1);
    expect(orphans[0].symbol.name).toBe("unused");
  });

  it("excludes symbols referenced in tests", () => {
    const graph = makeGraph({
      symbols: [makeSymbolNode({ id: "tested", name: "tested", kind: "function", isExported: false })],
      testEdges: [makeTestEdge({ testFunc: "test.ts", target: "tested", file: "test.ts", line: 1 })],
    });

    const orphans = findOrphans(graph);
    expect(orphans).toHaveLength(0);
  });
});

describe("trace", () => {
  it("finds string matches in symbol bodies and their callers", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "src/lib.ts");
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      [
        'function doStuff() {',
        '  throw new Error("boom");',
        '}',
        'function caller() {',
        '  doStuff();',
        '}',
      ].join("\n"),
      "utf-8",
    );

    const graph = makeGraph({
      root: dir,
      symbols: [
        makeSymbolNode({ id: "doStuff", name: "doStuff", kind: "function", file: "src/lib.ts", line: 1, endLine: 3 }),
        makeSymbolNode({ id: "caller", name: "caller", kind: "function", file: "src/lib.ts", line: 4, endLine: 6 }),
      ],
      calls: [
        makeCallEdge({ callerSymbolId: "caller", callerName: "caller", calleeRaw: "doStuff", file: "src/lib.ts", line: 5 }),
      ],
    });

    const results = trace(graph, "boom");
    expect(results).toHaveLength(1);
    expect(results[0].match.symbol.name).toBe("doStuff");
    expect(results[0].match.contextLine).toContain("boom");
    expect(results[0].callers).toHaveLength(1);
    expect(results[0].callers[0].symbol.name).toBe("caller");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns empty for no match", () => {
    const graph = makeGraph({
      symbols: [makeSymbolNode({ id: "foo", name: "foo", kind: "function", file: "x.ts", line: 1, endLine: 1 })],
    });
    const results = trace(graph, "nonexistent");
    expect(results).toHaveLength(0);
  });

  it("is case-insensitive", () => {
    const dir = createTempDir();
    const filePath = path.join(dir, "x.ts");
    fs.writeFileSync(filePath, 'function foo() { return "HELLO"; }', "utf-8");

    const graph = makeGraph({
      root: dir,
      symbols: [makeSymbolNode({ id: "foo", name: "foo", kind: "function", file: "x.ts", line: 1, endLine: 1 })],
    });

    const results = trace(graph, "hello");
    expect(results).toHaveLength(1);

    fs.rmSync(dir, { recursive: true });
  });
});
