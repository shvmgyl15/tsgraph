import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import {
  makeGraph,
  makeImportEdge,
  makeFileNode,
  makePackageNode,
} from "../graph/types.js";
import {
  loadBoundariesConfig,
  checkBoundaries,
} from "./index.js";
import type { BoundariesConfig, LayerConfig } from "./index.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-boundaries-"));
}

function makeConfig(layers: LayerConfig[]): BoundariesConfig {
  return { layers };
}

const uiLayer: LayerConfig = {
  name: "ui",
  path: "src/components",
  dependsOn: ["shared"],
};

const sharedLayer: LayerConfig = {
  name: "shared",
  path: "src/shared",
  dependsOn: ["lib"],
};

const libLayer: LayerConfig = {
  name: "lib",
  path: "src/lib",
  dependsOn: [],
};

const defaultConfig = makeConfig([uiLayer, sharedLayer, libLayer]);

describe("loadBoundariesConfig", () => {
  it("reads and parses valid config", () => {
    const dir = createTempDir();
    const configDir = path.join(dir, ".tsgraph");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "boundaries.json"),
      JSON.stringify(defaultConfig),
      "utf-8",
    );
    const loaded = loadBoundariesConfig(dir);
    expect(loaded).not.toBeNull();
    expect(loaded!.layers).toHaveLength(3);
    expect(loaded!.layers[0].name).toBe("ui");
    expect(loaded!.layers[0].dependsOn).toEqual(["shared"]);
    fs.rmSync(dir, { recursive: true });
  });

  it("returns null when file does not exist", () => {
    const dir = createTempDir();
    const loaded = loadBoundariesConfig(dir);
    expect(loaded).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it("returns null for invalid JSON", () => {
    const dir = createTempDir();
    const configDir = path.join(dir, ".tsgraph");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "boundaries.json"),
      "not json",
      "utf-8",
    );
    const loaded = loadBoundariesConfig(dir);
    expect(loaded).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });

  it("returns null for invalid schema", () => {
    const dir = createTempDir();
    const configDir = path.join(dir, ".tsgraph");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "boundaries.json"),
      JSON.stringify({ layers: [{ name: "ui" }] }),
      "utf-8",
    );
    const loaded = loadBoundariesConfig(dir);
    expect(loaded).toBeNull();
    fs.rmSync(dir, { recursive: true });
  });
});

describe("checkBoundaries", () => {
  it("allows legal import within same layer", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Button.tsx", packageName: "app" }),
        makeFileNode({ path: "src/components/Panel.tsx", packageName: "app" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Button.tsx",
          fromPackage: "app",
          importPath: "./Panel",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("allows legal import to a depended-on layer", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/shared/helper.ts", packageName: "shared" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../shared/helper",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("flags violation for import to a non-depended layer", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/lib/util.ts", packageName: "lib" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../lib/util",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(1);
    expect(result.allowed).toBe(0);
    expect(result.violations[0].fromLayer).toBe("ui");
    expect(result.violations[0].toLayer).toBe("lib");
    expect(result.violations[0].fromFile).toBe("src/components/Page.tsx");
    expect(result.violations[0].toFile).toBe("src/lib/util.ts");
    expect(result.violations[0].toPackage).toBe("lib");
    expect(result.violations[0].rule).toBe("ui → lib not allowed");
  });

  it("allows legal import through transitive dependency chain", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/shared/util.ts", packageName: "shared" }),
        makeFileNode({ path: "src/lib/helper.ts", packageName: "lib" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/shared/util.ts",
          fromPackage: "shared",
          importPath: "../lib/helper",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("treats bare module imports as allowed (unresolved)", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "react",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("treats imports to files outside known layers as allowed", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/generated/api.ts", packageName: "api" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../generated/api",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("treats files outside any layer as allowed", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/generated/api.ts", packageName: "api" }),
        makeFileNode({ path: "src/lib/util.ts", packageName: "lib" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/generated/api.ts",
          fromPackage: "api",
          importPath: "../lib/util",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("handles mixed allowed and violating imports", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/shared/helper.ts", packageName: "shared" }),
        makeFileNode({ path: "src/lib/util.ts", packageName: "lib" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../shared/helper",
        }),
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../lib/util",
        }),
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "react",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(1);
    expect(result.allowed).toBe(2);
    expect(result.violations[0].toLayer).toBe("lib");
  });

  it("resolves imports with .tsx extension", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/shared/helper.tsx", packageName: "shared" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../shared/helper",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("resolves imports with index.ts pattern", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/shared/index.ts", packageName: "shared" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../shared",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(0);
    expect(result.allowed).toBe(1);
  });

  it("populates toPackage from graph file nodes", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/components/Page.tsx", packageName: "app" }),
        makeFileNode({ path: "src/lib/util.ts", packageName: "lib-pkg" }),
      ],
      imports: [
        makeImportEdge({
          fromFile: "src/components/Page.tsx",
          fromPackage: "app",
          importPath: "../lib/util",
        }),
      ],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0].toPackage).toBe("lib-pkg");
  });

  it("returns config in result", () => {
    const graph = makeGraph({
      files: [],
      imports: [],
    });
    const result = checkBoundaries(graph, defaultConfig);
    expect(result.config).toBe(defaultConfig);
    expect(result.config.layers).toHaveLength(3);
  });
});
