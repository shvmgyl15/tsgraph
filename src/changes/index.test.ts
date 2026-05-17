import { describe, it, expect } from "vitest";
import {
  makeGraph,
  makeFileNode,
  makeSymbolNode,
  makeImportEdge,
} from "../graph/types.js";
import { getChanges, getStale } from "./index.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

function createGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-changes-"));
  execSync("git init", { cwd: dir, stdio: "pipe" });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: "pipe" });
  execSync('git config user.name "Test"', { cwd: dir, stdio: "pipe" });
  return dir;
}

function writeFile(root: string, relPath: string, content: string) {
  const fullPath = path.join(root, relPath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("getChanges", () => {
  it("returns empty result if not a git repo", () => {
    const graph = makeGraph({ files: [], symbols: [], imports: [] });
    const result = getChanges(graph, "/tmp/nonexistent");
    expect(result.totalFiles).toBe(0);
    expect(result.totalSymbols).toBe(0);
  });

  it("finds changed files with symbols from a git diff", () => {
    const dir = createGitRepo();
    writeFile(dir, "src/index.ts", 'export const x = 1;\n');
    execSync("git add . && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
    writeFile(dir, "src/lib/util.ts", 'export const util = 2;\n');
    execSync("git add . && git commit -m 'add util'", { cwd: dir, stdio: "pipe" });

    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/index.ts", packageName: "app" }),
        makeFileNode({ path: "src/lib/util.ts", packageName: "app" }),
      ],
      symbols: [
        makeSymbolNode({
          name: "x",
          kind: "const",
          file: "src/index.ts",
          packageName: "app",
          line: 1,
          endLine: 1,
          isExported: true,
        }),
        makeSymbolNode({
          name: "util",
          kind: "const",
          file: "src/lib/util.ts",
          packageName: "app",
          line: 1,
          endLine: 1,
          isExported: true,
        }),
      ],
      imports: [],
    });

    const result = getChanges(graph, dir, "HEAD~1");
    expect(result.totalFiles).toBeGreaterThanOrEqual(1);
    expect(result.totalSymbols).toBeGreaterThanOrEqual(1);
    const utilFile = result.files.find((f) => f.path === "src/lib/util.ts");
    expect(utilFile).toBeTruthy();
    fs.rmSync(dir, { recursive: true });
  });
});

describe("getStale", () => {
  it("returns empty result if not a git repo", () => {
    const graph = makeGraph({ files: [], symbols: [], imports: [] });
    const result = getStale(graph, "/tmp/nonexistent");
    expect(result.totalFiles).toBe(0);
  });

  it("returns files without recent commits", () => {
    const dir = createGitRepo();
    writeFile(dir, "src/old.ts", 'export const old = 1;\n');
    execSync("git add . && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });

    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/old.ts", packageName: "app" }),
      ],
      symbols: [
        makeSymbolNode({
          name: "old",
          kind: "const",
          file: "src/old.ts",
          packageName: "app",
          line: 1,
          endLine: 1,
          isExported: true,
        }),
      ],
      imports: [],
    });

    const result = getStale(graph, dir, 0);
    expect(result.totalFiles).toBe(0);
    fs.rmSync(dir, { recursive: true });
  });
});
