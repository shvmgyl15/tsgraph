import { describe, it, expect } from "vitest";
import {
  makeGraph,
  makeSymbolNode,
  makeFileNode,
  makeCallEdge,
  makeImportEdge,
  makePackageNode,
} from "../graph/types.js";
import { generatePlan, generateReview } from "./index.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";

function createGitRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-plan-"));
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

describe("generatePlan", () => {
  it("returns summary for given files and symbols", () => {
    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/util.ts", packageName: "app" }),
        makeFileNode({ path: "src/index.ts", packageName: "app" }),
      ],
      symbols: [
        makeSymbolNode({
          id: "src/util.ts::helper",
          name: "helper",
          kind: "function",
          file: "src/util.ts",
          packageName: "app",
          line: 1,
          endLine: 5,
          isExported: true,
        }),
        makeSymbolNode({
          id: "src/index.ts::main",
          name: "main",
          kind: "function",
          file: "src/index.ts",
          packageName: "app",
          line: 10,
          endLine: 15,
          isExported: true,
        }),
      ],
      calls: [
        makeCallEdge({
          callerSymbolId: "src/index.ts::main",
          callerName: "main",
          calleeRaw: "helper",
          file: "src/index.ts",
          line: 11,
        }),
      ],
      imports: [],
    });

    const result = generatePlan(graph, ["src/util.ts"], []);
    expect(result.changes.files).toContain("src/util.ts");
    expect(result.affectedFiles).toContain("src/util.ts");
    expect(result.affectedFiles).toContain("src/index.ts");
    expect(result.summary).toContain("1 symbol(s) changed");
  });

  it("handles explicit symbols", () => {
    const graph = makeGraph({
      files: [makeFileNode({ path: "src/lib.ts", packageName: "app" })],
      symbols: [
        makeSymbolNode({
          id: "src/lib.ts::foo",
          name: "foo",
          kind: "function",
          file: "src/lib.ts",
          packageName: "app",
          line: 1,
          endLine: 3,
          isExported: true,
        }),
      ],
      calls: [],
      imports: [],
    });

    const result = generatePlan(graph, [], ["foo"]);
    expect(result.changes.symbols).toContain("foo");
    expect(result.summary).toContain("1 symbol(s) changed");
  });
});

describe("generateReview", () => {
  it("returns empty result if not a git repo", () => {
    const graph = makeGraph({ files: [], symbols: [], imports: [] });
    const result = generateReview(graph, "/tmp/nonexistent");
    expect(result.totalChanges).toBe(0);
    expect(result.summary).toContain("Not a git repository");
  });

  it("finds findings for changed files", () => {
    const dir = createGitRepo();
    writeFile(dir, "src/index.ts", 'export const x = 1;\n');
    execSync("git add . && git commit -m 'initial'", { cwd: dir, stdio: "pipe" });
    writeFile(dir, "src/new.ts", 'export const y = 2;\n');
    execSync("git add . && git commit -m 'add new'", { cwd: dir, stdio: "pipe" });

    const graph = makeGraph({
      files: [
        makeFileNode({ path: "src/index.ts", packageName: "app" }),
        makeFileNode({ path: "src/new.ts", packageName: "app" }),
      ],
      symbols: [
        makeSymbolNode({
          id: "src/index.ts::x",
          name: "x",
          kind: "const",
          file: "src/index.ts",
          packageName: "app",
          line: 1,
          endLine: 1,
          isExported: true,
        }),
        makeSymbolNode({
          id: "src/new.ts::y",
          name: "y",
          kind: "const",
          file: "src/new.ts",
          packageName: "app",
          line: 1,
          endLine: 1,
          isExported: true,
        }),
      ],
      calls: [],
      imports: [],
    });

    const result = generateReview(graph, dir, "HEAD~1");
    expect(result.totalChanges).toBeGreaterThanOrEqual(1);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const orphan = result.findings.find((f) => f.type === "orphan");
    expect(orphan).toBeTruthy();
    expect(orphan!.detail).toContain("y");

    const changedExport = result.findings.find(
      (f) => f.type === "changed_export",
    );
    expect(changedExport).toBeTruthy();
    fs.rmSync(dir, { recursive: true });
  });
});
