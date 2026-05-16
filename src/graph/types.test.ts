import { describe, it, expect } from "vitest";
import {
  GRAPH_VERSION,
  makeGraph,
  makePackageNode,
  makeFileNode,
  makeSymbolNode,
  makeCallEdge,
  makeImportEdge,
  makeDependency,
  makeHTTPRoute,
  makeEnvRead,
  makeConcurrencyNode,
  makeTestEdge,
  makeImplementsEdge,
  makeMutationEdge,
  makeErrorEdge,
  makeAppRouterNode,
  makeStructField,
  serialize,
  deserialize,
} from "./types.js";

describe("GRAPH_VERSION", () => {
  it("is 1", () => {
    expect(GRAPH_VERSION).toBe("1");
  });
});

describe("factory functions", () => {
  describe("makeGraph", () => {
    it("returns a graph with defaults", () => {
      const g = makeGraph();
      expect(g.version).toBe(GRAPH_VERSION);
      expect(g.generatedAt).toBeTruthy();
      expect(g.root).toBe("");
      expect(g.packages).toEqual([]);
      expect(g.files).toEqual([]);
      expect(g.symbols).toEqual([]);
      expect(g.imports).toEqual([]);
      expect(g.calls).toEqual([]);
      expect(g.envReads).toEqual([]);
      expect(g.dependencies).toEqual([]);
      expect(g.routes).toEqual([]);
      expect(g.concurrency).toEqual([]);
      expect(g.testEdges).toEqual([]);
      expect(g.implements).toEqual([]);
      expect(g.mutations).toEqual([]);
      expect(g.errors).toEqual([]);
      expect(g.appRouter).toBeUndefined();
    });

    it("merges overrides", () => {
      const g = makeGraph({ root: "/project", version: "2" });
      expect(g.root).toBe("/project");
      expect(g.version).toBe("2");
    });

    it("generates an ISO timestamp", () => {
      const g = makeGraph();
      expect(() => new Date(g.generatedAt)).not.toThrow();
      expect(new Date(g.generatedAt).toISOString()).toBe(g.generatedAt);
    });
  });

  describe("makePackageNode", () => {
    it("returns a package node with defaults", () => {
      const p = makePackageNode();
      expect(p.id).toBeTruthy();
      expect(p.name).toBe("");
      expect(p.importPathBestEffort).toBe("");
      expect(p.dir).toBe("");
      expect(p.files).toEqual([]);
    });

    it("merges overrides", () => {
      const p = makePackageNode({ name: "utils", dir: "./utils" });
      expect(p.name).toBe("utils");
      expect(p.dir).toBe("./utils");
      expect(p.files).toEqual([]);
    });
  });

  describe("makeFileNode", () => {
    it("returns a file node with defaults", () => {
      const f = makeFileNode();
      expect(f.id).toBeTruthy();
      expect(f.path).toBe("");
      expect(f.packageName).toBe("");
      expect(f.lines).toBe(0);
      expect(f.generated).toBe(false);
    });

    it("merges overrides", () => {
      const f = makeFileNode({ path: "src/index.ts", generated: true, lines: 42 });
      expect(f.path).toBe("src/index.ts");
      expect(f.generated).toBe(true);
      expect(f.lines).toBe(42);
    });
  });

  describe("makeSymbolNode", () => {
    it("returns a symbol node with defaults", () => {
      const s = makeSymbolNode();
      expect(s.id).toBeTruthy();
      expect(s.kind).toBe("function");
      expect(s.name).toBe("");
      expect(s.packageName).toBe("");
      expect(s.file).toBe("");
      expect(s.line).toBe(0);
      expect(s.endLine).toBe(0);
      expect(s.isExported).toBe(false);
    });

    it("merges overrides", () => {
      const s = makeSymbolNode({ name: "Foo", kind: "class", isExported: true, line: 10, endLine: 30 });
      expect(s.name).toBe("Foo");
      expect(s.kind).toBe("class");
      expect(s.isExported).toBe(true);
      expect(s.line).toBe(10);
      expect(s.endLine).toBe(30);
    });

    it("preserves optional fields", () => {
      const s = makeSymbolNode({
        doc: "does foo",
        signature: "Foo() => void",
        structFields: [{ name: "bar", type: "string" }],
        embeddedTypes: ["Mixin"],
        arity: 2,
        isClientComponent: true,
        isServerComponent: false,
      });
      expect(s.doc).toBe("does foo");
      expect(s.signature).toBe("Foo() => void");
      expect(s.structFields).toHaveLength(1);
      expect(s.structFields![0].name).toBe("bar");
      expect(s.embeddedTypes).toEqual(["Mixin"]);
      expect(s.arity).toBe(2);
      expect(s.isClientComponent).toBe(true);
      expect(s.isServerComponent).toBe(false);
    });
  });

  describe("makeCallEdge", () => {
    it("returns defaults", () => {
      const e = makeCallEdge();
      expect(e.callerSymbolId).toBe("");
      expect(e.callerName).toBe("");
      expect(e.calleeRaw).toBe("");
      expect(e.file).toBe("");
      expect(e.line).toBe(0);
    });
  });

  describe("makeImportEdge", () => {
    it("returns defaults", () => {
      const e = makeImportEdge();
      expect(e.fromFile).toBe("");
      expect(e.fromPackage).toBe("");
      expect(e.importPath).toBe("");
      expect(e.isDefault).toBe(false);
    });

    it("sets isDefault", () => {
      const e = makeImportEdge({ isDefault: true });
      expect(e.isDefault).toBe(true);
    });
  });

  describe("makeDependency", () => {
    it("returns defaults", () => {
      const d = makeDependency();
      expect(d.module).toBe("");
      expect(d.version).toBe("");
    });
  });

  describe("makeHTTPRoute", () => {
    it("returns defaults", () => {
      const r = makeHTTPRoute();
      expect(r.method).toBe("");
      expect(r.path).toBe("");
      expect(r.handler).toBe("");
      expect(r.file).toBe("");
      expect(r.line).toBe(0);
    });
  });

  describe("makeEnvRead", () => {
    it("returns defaults", () => {
      const e = makeEnvRead();
      expect(e.key).toBe("");
      expect(e.accessor).toBe("");
      expect(e.file).toBe("");
      expect(e.line).toBe(0);
    });
  });

  describe("makeConcurrencyNode", () => {
    it("returns defaults", () => {
      const c = makeConcurrencyNode();
      expect(c.kind).toBe("async_function");
      expect(c.functionName).toBe("");
      expect(c.file).toBe("");
      expect(c.line).toBe(0);
    });
  });

  describe("makeTestEdge", () => {
    it("returns defaults", () => {
      const t = makeTestEdge();
      expect(t.testFunc).toBe("");
      expect(t.target).toBe("");
      expect(t.file).toBe("");
      expect(t.line).toBe(0);
    });
  });

  describe("makeImplementsEdge", () => {
    it("returns defaults", () => {
      const e = makeImplementsEdge();
      expect(e.interface).toBe("");
      expect(e.concrete).toBe("");
    });
  });

  describe("makeMutationEdge", () => {
    it("returns defaults", () => {
      const m = makeMutationEdge();
      expect(m.field).toBe("");
      expect(m.functionName).toBe("");
      expect(m.file).toBe("");
      expect(m.line).toBe(0);
    });
  });

  describe("makeErrorEdge", () => {
    it("returns defaults", () => {
      const e = makeErrorEdge();
      expect(e.message).toBe("");
      expect(e.functionName).toBe("");
      expect(e.file).toBe("");
      expect(e.line).toBe(0);
    });
  });

  describe("makeAppRouterNode", () => {
    it("returns defaults", () => {
      const n = makeAppRouterNode();
      expect(n.path).toBe("");
      expect(n.dir).toBe("");
      expect(n.files).toEqual({});
      expect(n.children).toEqual([]);
    });

    it("supports nested children", () => {
      const child = makeAppRouterNode({ path: "/child" });
      const parent = makeAppRouterNode({ path: "/", children: [child] });
      expect(parent.children).toHaveLength(1);
      expect(parent.children[0].path).toBe("/child");
    });
  });

  describe("makeStructField", () => {
    it("returns defaults", () => {
      const f = makeStructField();
      expect(f.name).toBe("");
      expect(f.type).toBe("");
    });

    it("merges overrides", () => {
      const f = makeStructField({ name: "id", type: "string", tag: "json:\"id\"" });
      expect(f.name).toBe("id");
      expect(f.type).toBe("string");
      expect(f.tag).toBe("json:\"id\"");
    });
  });
});

describe("serialize / deserialize", () => {
  describe("serialize", () => {
    it("produces valid JSON with 2-space indentation", () => {
      const g = makeGraph();
      const json = serialize(g);
      expect(json).toBeTruthy();
      expect(json.startsWith("{")).toBe(true);
      const parsed = JSON.parse(json);
      expect(parsed.version).toBe(GRAPH_VERSION);
    });

    it("throws on version mismatch", () => {
      const g = makeGraph({ version: "999" });
      expect(() => serialize(g)).toThrow("version mismatch");
    });
  });

  describe("deserialize", () => {
    it("round-trips a graph with all fields", () => {
      const original = makeGraph({
        root: "/test",
        packages: [makePackageNode({ name: "main", dir: "." })],
        files: [makeFileNode({ path: "index.ts", packageName: "main" })],
        symbols: [makeSymbolNode({ name: "run", kind: "function", file: "index.ts", line: 1, endLine: 5 })],
        calls: [makeCallEdge({ callerSymbolId: "s1", callerName: "run", calleeRaw: "log", file: "index.ts", line: 2 })],
        imports: [makeImportEdge({ fromFile: "index.ts", importPath: "fs" })],
        dependencies: [makeDependency({ module: "react", version: "^18" })],
        routes: [makeHTTPRoute({ method: "GET", path: "/api", handler: "getHandler", file: "route.ts", line: 3 })],
        envReads: [makeEnvRead({ key: "PORT", accessor: "process.env.PORT", file: "config.ts", line: 5 })],
        concurrency: [makeConcurrencyNode({ kind: "promise_all", functionName: "fetchAll", file: "fetch.ts", line: 10 })],
        testEdges: [makeTestEdge({ testFunc: "TestRun", target: "run", file: "index_test.ts", line: 1 })],
        implements: [makeImplementsEdge({ interface: "Runner", concrete: "FastRunner" })],
        mutations: [makeMutationEdge({ field: "User.name", functionName: "rename", file: "user.ts", line: 8 })],
        errors: [makeErrorEdge({ message: "not found", functionName: "findUser", file: "user.ts", line: 12 })],
        appRouter: makeAppRouterNode({
          path: "/",
          dir: "app",
          files: { page: "page.tsx", layout: "layout.tsx" },
          children: [makeAppRouterNode({ path: "/about", dir: "about", files: { page: "page.tsx" } })],
        }),
      });

      const json = serialize(original);
      const restored = deserialize(json);

      expect(restored.version).toBe(original.version);
      expect(restored.root).toBe(original.root);
      expect(restored.packages).toHaveLength(1);
      expect(restored.files).toHaveLength(1);
      expect(restored.symbols).toHaveLength(1);
      expect(restored.calls).toHaveLength(1);
      expect(restored.imports).toHaveLength(1);
      expect(restored.dependencies).toHaveLength(1);
      expect(restored.routes).toHaveLength(1);
      expect(restored.envReads).toHaveLength(1);
      expect(restored.concurrency).toHaveLength(1);
      expect(restored.testEdges).toHaveLength(1);
      expect(restored.implements).toHaveLength(1);
      expect(restored.mutations).toHaveLength(1);
      expect(restored.errors).toHaveLength(1);
      expect(restored.appRouter).toBeTruthy();
      expect(restored.appRouter!.children).toHaveLength(1);
    });

    it("round-trips an empty graph", () => {
      const original = makeGraph({ root: "/empty" });
      const json = serialize(original);
      const restored = deserialize(json);
      expect(restored.root).toBe("/empty");
      expect(restored.packages).toEqual([]);
    });

    it("rejects malformed JSON", () => {
      expect(() => deserialize("not json")).toThrow("Invalid JSON");
    });

    it("rejects null", () => {
      expect(() => deserialize("null")).toThrow("Invalid graph structure");
    });

    it("rejects missing version", () => {
      const json = JSON.stringify({ root: "/x", generatedAt: "", packages: [], files: [], symbols: [], imports: [], calls: [], envReads: [], dependencies: [], routes: [], concurrency: [], testEdges: [], implements: [], mutations: [], errors: [] });
      expect(() => deserialize(json)).toThrow("Invalid graph structure");
    });

    it("rejects version mismatch", () => {
      const g = makeGraph({ version: "2" });
      expect(() => deserialize(serialize(g))).toThrow("version mismatch");
    });

    it("rejects missing array fields", () => {
      const json = JSON.stringify({ version: GRAPH_VERSION, generatedAt: "", root: "" });
      expect(() => deserialize(json)).toThrow("Invalid graph structure");
    });

    it("accepts extra unknown fields (forward compat)", () => {
      const g = makeGraph({ root: "/future" });
      const json = JSON.stringify({ ...JSON.parse(serialize(g)), futureField: "hello" });
      const restored = deserialize(json);
      expect(restored.root).toBe("/future");
    });
  });
});
