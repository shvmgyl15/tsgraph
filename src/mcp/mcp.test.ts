import { describe, it, expect, afterEach } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { spawn, type ChildProcess } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const cliEntry = path.join(projectRoot, "src/cli/index.ts");

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

let server: ChildProcess | null = null;
let requestId = 0;
let stderrBuf = "";

function sendRequest(proc: ChildProcess, method: string, params?: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = ++requestId;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? {} }) + "\n";

    const responses: string[] = [];

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      responses.push(text);
      const full = responses.join("");
      const lines = full.split("\n").filter(Boolean);
      // Keep incomplete last chunk
      if (!full.endsWith("\n")) {
        responses.length = 0;
        responses.push(lines.pop() ?? "");
      }
      for (const line of lines) {
        try {
          const resp = JSON.parse(line);
          if (resp.id === id) {
            proc.stdout?.off("data", onData);
            resolve(resp);
          }
        } catch {
          // partial or notification, keep waiting
        }
      }
    };

    const onStderr = (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf-8");
    };

    proc.stdout?.on("data", onData);
    proc.stderr?.on("data", onStderr);
    proc.stdin?.write(msg);

    setTimeout(() => {
      proc.stdout?.off("data", onData);
      reject(new Error(`Timeout. stderr: ${stderrBuf.slice(-500)}`));
    }, 10000);
  });
}

async function mcpHandshake(proc: ChildProcess): Promise<void> {
  const initResp = await sendRequest(proc, "initialize", {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "tsgraph-test", version: "1.0.0" },
  }) as Record<string, unknown>;
  expect((initResp as { result?: Record<string, unknown> }).result?.protocolVersion).toBeTruthy();
  // Send initialized notification
  proc.stdin?.write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n");
}

describe("MCP server", () => {
  afterEach(() => {
    if (server && !server.killed) {
      server.kill();
      server = null;
    }
  });

  it("lists all registered tools", async () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "test" }));
    writeFile(dir, "index.ts", "export function foo() { return 1; }");
    fs.mkdirSync(path.join(dir, ".tsgraph"), { recursive: true });

    // Build graph first
    const { scanFiles } = await import("../scanner/index.js");
    const { parseProject } = await import("../parser/index.js");
    const { serialize } = await import("../graph/types.js");
    const scanned = scanFiles(dir);
    const graph = parseProject(dir, scanned.files);
    fs.writeFileSync(path.join(dir, ".tsgraph", "graph.json"), serialize(graph), "utf-8");

    server = spawn("npx", ["tsx", cliEntry, "mcp"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    await new Promise((r) => setTimeout(r, 500));

    await mcpHandshake(server);

    const resp = await sendRequest(server, "tools/list") as Record<string, unknown>;
    expect(resp).toBeTruthy();
    expect((resp as { result?: { tools?: unknown[] } }).result?.tools).toBeTruthy();
    const tools = (resp as { result: { tools: { name: string }[] } }).result.tools;
    const toolNames = tools.map((t) => t.name).sort();
    expect(toolNames).toContain("callers");
    expect(toolNames).toContain("callees");
    expect(toolNames).toContain("node");
    expect(toolNames).toContain("query");
    expect(toolNames).toContain("context");
    expect(toolNames).toContain("imports");
    expect(toolNames).toContain("public");
    expect(toolNames).toContain("impact");
    expect(toolNames).toContain("path");
    expect(toolNames).toContain("orphans");
    expect(toolNames).toContain("trace");
    expect(toolNames).toContain("complexity");
    expect(toolNames).toContain("hotspot");
    expect(toolNames).toContain("coupling");
    expect(toolNames).toHaveLength(14);

    server.kill();
    fs.rmSync(dir, { recursive: true });
  }, 30000);

  it("calls orphans tool and returns results", async () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "test" }));
    writeFile(dir, "index.ts", "export function foo() { return 1; }");
    fs.mkdirSync(path.join(dir, ".tsgraph"), { recursive: true });

    const { scanFiles } = await import("../scanner/index.js");
    const { parseProject } = await import("../parser/index.js");
    const { serialize } = await import("../graph/types.js");
    const scanned = scanFiles(dir);
    const graph = parseProject(dir, scanned.files);
    fs.writeFileSync(path.join(dir, ".tsgraph", "graph.json"), serialize(graph), "utf-8");

    server = spawn("npx", ["tsx", cliEntry, "mcp"], {
      cwd: dir,
      stdio: ["pipe", "pipe", "pipe"],
    });

    await new Promise((r) => setTimeout(r, 500));

    await mcpHandshake(server);

    const resp = await sendRequest(server, "tools/call", {
      name: "orphans",
      arguments: {},
    }) as Record<string, unknown>;

    expect(resp).toBeTruthy();
    const result = (resp as { result?: { content?: { text?: string }[] } }).result;
    expect(result).toBeTruthy();
    const textContent = result?.content?.[0]?.text;
    expect(textContent).toBeTruthy();
    const parsed = JSON.parse(textContent!);
    expect(Array.isArray(parsed)).toBe(true);

    server.kill();
    fs.rmSync(dir, { recursive: true });
  }, 30000);
});
