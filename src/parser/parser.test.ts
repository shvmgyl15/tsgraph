import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFiles } from "../scanner/index.js";
import { parseProject } from "./index.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("parseProject", () => {
  it("extracts functions from a TypeScript file", () => {
    const dir = createTempDir();
    writeFile(dir, "index.ts", `
export function greet(name: string): string {
  return "Hello " + name;
}

function helper() {
  return 42;
}
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.symbols).toHaveLength(2);

    const greet = graph.symbols.find((s) => s.name === "greet");
    expect(greet).toBeTruthy();
    expect(greet!.kind).toBe("function");
    expect(greet!.isExported).toBe(true);
    expect(greet!.file).toBe("index.ts");

    const helper = graph.symbols.find((s) => s.name === "helper");
    expect(helper).toBeTruthy();
    expect(helper!.kind).toBe("function");
    expect(helper!.isExported).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });

  it("extracts classes with methods", () => {
    const dir = createTempDir();
    writeFile(dir, "user.ts", `
export class User {
  name: string;

  constructor(name: string) {
    this.name = name;
  }

  greet(): string {
    return "Hi " + this.name;
  }
}
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const cls = graph.symbols.find((s) => s.name === "User");
    expect(cls).toBeTruthy();
    expect(cls!.kind).toBe("class");
    expect(cls!.isExported).toBe(true);

    const greet = graph.symbols.find((s) => s.name === "greet");
    expect(greet).toBeTruthy();
    expect(greet!.kind).toBe("method");
    expect(greet!.receiver).toBe("User");

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts interfaces and type aliases", () => {
    const dir = createTempDir();
    writeFile(dir, "types.ts", `
export interface Props {
  name: string;
  age?: number;
}

export type Status = "active" | "inactive";

type Internal = number;
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.symbols).toHaveLength(3);

    const props = graph.symbols.find((s) => s.name === "Props");
    expect(props).toBeTruthy();
    expect(props!.kind).toBe("interface");
    expect(props!.isExported).toBe(true);

    const status = graph.symbols.find((s) => s.name === "Status");
    expect(status).toBeTruthy();
    expect(status!.kind).toBe("type_alias");
    expect(status!.isExported).toBe(true);

    const internal = graph.symbols.find((s) => s.name === "Internal");
    expect(internal).toBeTruthy();
    expect(internal!.kind).toBe("type_alias");
    expect(internal!.isExported).toBe(false);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts enums", () => {
    const dir = createTempDir();
    writeFile(dir, "enums.ts", `
export enum Color {
  Red,
  Green,
  Blue,
}
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const color = graph.symbols.find((s) => s.name === "Color");
    expect(color).toBeTruthy();
    expect(color!.kind).toBe("enum");
    expect(color!.isExported).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts const and var declarations", () => {
    const dir = createTempDir();
    writeFile(dir, "vars.ts", `
export const MAX = 100;
const TIMEOUT = 5000;
var name = "test";
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const max = graph.symbols.find((s) => s.name === "MAX");
    expect(max).toBeTruthy();
    expect(max!.kind).toBe("const");
    expect(max!.isExported).toBe(true);

    const timeout = graph.symbols.find((s) => s.name === "TIMEOUT");
    expect(timeout).toBeTruthy();
    expect(timeout!.kind).toBe("const");
    expect(timeout!.isExported).toBe(false);

    const n = graph.symbols.find((s) => s.name === "name");
    expect(n).toBeTruthy();
    expect(n!.kind).toBe("var");

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts call expressions within function bodies", () => {
    const dir = createTempDir();
    writeFile(dir, "lib.ts", `
export function log(msg: string) {
  console.log(msg);
}

export function process() {
  log("starting");
  Math.random();
}
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    // process calls log and Math.random
    const processCalls = graph.calls.filter((c) => c.callerName === "process");
    expect(processCalls.length).toBeGreaterThanOrEqual(2);
    expect(processCalls.some((c) => c.calleeRaw === "log")).toBe(true);
    expect(processCalls.some((c) => c.calleeRaw === "Math.random")).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts call expressions within const arrow functions", () => {
    const dir = createTempDir();
    writeFile(dir, "component.tsx", `
const MyComponent = () => {
  const router = useRouter();
  const [state, setState] = useState(false);
  return <div />;
};

const useCustomHook = () => {
  const data = fetchData();
  return data;
};
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const myCompCalls = graph.calls.filter((c) => c.callerName === "MyComponent");
    expect(myCompCalls.length).toBeGreaterThanOrEqual(2);
    expect(myCompCalls.some((c) => c.calleeRaw === "useRouter")).toBe(true);
    expect(myCompCalls.some((c) => c.calleeRaw === "useState")).toBe(true);

    const hookCalls = graph.calls.filter((c) => c.callerName === "useCustomHook");
    expect(hookCalls.some((c) => c.calleeRaw === "fetchData")).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts new expression calls within function bodies", () => {
    const dir = createTempDir();
    writeFile(dir, "service.ts", `
function createService() {
  return new CommonServiceMethod(console);
}

export function start() {
  const svc = new Service("config");
  svc.run();
}
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const createCalls = graph.calls.filter((c) => c.callerName === "createService");
    expect(createCalls.some((c) => c.calleeRaw === "CommonServiceMethod")).toBe(true);

    const startCalls = graph.calls.filter((c) => c.callerName === "start");
    expect(startCalls.some((c) => c.calleeRaw === "Service")).toBe(true);
    expect(startCalls.some((c) => c.calleeRaw === "svc.run")).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts new expression calls within const arrow functions", () => {
    const dir = createTempDir();
    writeFile(dir, "hooks.ts", `
const useService = () => {
  const svc = new AnalyticsService();
  return svc.track();
};
`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    const hookCalls = graph.calls.filter((c) => c.callerName === "useService");
    expect(hookCalls.some((c) => c.calleeRaw === "AnalyticsService")).toBe(true);
    expect(hookCalls.some((c) => c.calleeRaw === "svc.track")).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("extracts imports", () => {
    const dir = createTempDir();
    writeFile(dir, "main.ts", `
import React, { useState } from "react";
import { z } from "zod";
import fs from "node:fs";
`);
    writeFile(dir, "package.json", JSON.stringify({
      name: "test-project",
      dependencies: { react: "^18", zod: "^3" },
    }));

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.imports.length).toBeGreaterThanOrEqual(3);

    const reactDefault = graph.imports.find(
      (i) => i.importPath === "react" && i.alias === "React",
    );
    expect(reactDefault).toBeTruthy();
    expect(reactDefault!.isDefault).toBe(true);

    const useState = graph.imports.find(
      (i) => i.importPath === "react" && i.alias === "useState",
    );
    expect(useState).toBeTruthy();
    expect(useState!.isDefault).toBe(false);

    const zodImport = graph.imports.find(
      (i) => i.importPath === "zod" && i.alias === "z",
    );
    expect(zodImport).toBeTruthy();

    fs.rmSync(dir, { recursive: true });
  });

  it("reads dependencies from package.json", () => {
    const dir = createTempDir();
    writeFile(dir, "index.ts", `export const x = 1;`);
    writeFile(dir, "package.json", JSON.stringify({
      name: "my-app",
      dependencies: { react: "^18" },
      devDependencies: { vitest: "^1" },
    }));

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.dependencies).toHaveLength(2);
    expect(graph.dependencies.some((d) => d.module === "react")).toBe(true);
    expect(graph.dependencies.some((d) => d.module === "vitest")).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("creates file nodes for all scanned files", () => {
    const dir = createTempDir();
    writeFile(dir, "src/index.ts", "");
    writeFile(dir, "src/util.ts", "");
    writeFile(dir, "data.json", "{}");
    writeFile(dir, "style.css", "body{}");

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.files).toHaveLength(4);
    const paths = graph.files.map((f) => f.path).sort();
    expect(paths).toContain("data.json");
    expect(paths).toContain("style.css");
    expect(paths).toContain("src/index.ts");
    expect(paths).toContain("src/util.ts");

    fs.rmSync(dir, { recursive: true });
  });

  it("handles empty project with no .ts files", () => {
    const dir = createTempDir();
    writeFile(dir, "README.md", "# Hello");

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.symbols).toHaveLength(0);
    expect(graph.calls).toHaveLength(0);
    expect(graph.imports).toHaveLength(0);
    expect(graph.files).toHaveLength(1);
    expect(graph.packages).toHaveLength(1);

    fs.rmSync(dir, { recursive: true });
  });
});
