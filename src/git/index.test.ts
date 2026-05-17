import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execSync } from "node:child_process";
import {
  isGitRepo,
  getCurrentBranch,
  getDiffFiles,
  getStaleFiles,
  getCommitHistory,
} from "./index.js";

let tmpDir: string;

function run(cmd: string) {
  execSync(cmd, { cwd: tmpDir, stdio: "pipe" });
}

function writeFile(relativePath: string, content: string) {
  const fullPath = path.join(tmpDir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-git-test-"));
  run("git init");
  run('git config user.email "test@test.com"');
  run('git config user.name "Test"');
  writeFile(".gitkeep", "");
  run("git add . && git commit -m 'initial'");
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true });
});

describe("isGitRepo", () => {
  it("returns true inside a git repo", () => {
    expect(isGitRepo(tmpDir)).toBe(true);
  });

  it("returns false outside a git repo", () => {
    const nonRepo = fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-non-git-"));
    expect(isGitRepo(nonRepo)).toBe(false);
    fs.rmSync(nonRepo, { recursive: true });
  });
});

describe("getCurrentBranch", () => {
  it("returns current branch name", () => {
    const branch = getCurrentBranch(tmpDir);
    expect(branch).toBeTruthy();
  });
});

describe("getDiffFiles", () => {
  it("returns changed files vs base branch", () => {
    writeFile("file1.ts", "content");
    run("git add . && git commit -m 'initial'");
    run("git checkout -b feature");
    writeFile("file2.ts", "content");
    run("git add . && git commit -m 'add file2'");
    writeFile("file3.ts", "content");
    run("git add . && git commit -m 'add file3'");
    const results = getDiffFiles(tmpDir, "main");
    expect(results.length).toBeGreaterThanOrEqual(2);
    const paths = results.map((r) => r.path);
    expect(paths).toContain("file2.ts");
    expect(paths).toContain("file3.ts");
    run("git checkout main");
  });
});

describe("getCommitHistory", () => {
  it("returns recent commit history", () => {
    const history = getCommitHistory(tmpDir, 5);
    expect(history.length).toBeGreaterThan(0);
    expect(history[0]).toHaveProperty("hash");
    expect(history[0]).toHaveProperty("message");
  });
});

describe("getStaleFiles", () => {
  it("does not return recently committed files", () => {
    writeFile("fresh.ts", "fresh content");
    run("git add . && git commit -m 'add fresh'");
    const stale = getStaleFiles(tmpDir, 0);
    expect(stale).not.toContain("fresh.ts");
  });
});
