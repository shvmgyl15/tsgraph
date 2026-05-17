import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { addOpencodePlugin } from "./index.js";

let tmpDir: string;

function setup() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-opencode-"));
}

function teardown() {
  fs.rmSync(tmpDir, { recursive: true });
}

function readJson(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, "utf-8"));
}

describe("addOpencodePlugin", () => {
  it("creates opencode.json when it does not exist", () => {
    setup();
    const result = addOpencodePlugin(tmpDir);
    expect(result.opencodeJsonUpdated).toBe(true);
    expect(result.errors).toHaveLength(0);

    const configPath = path.join(tmpDir, "opencode.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const config = readJson(configPath);
    expect(config["mcpServers"]).toEqual({
      tsgraph: { command: "npx", args: ["@shvmgyl15/tsgraph", "mcp"] },
    });
    teardown();
  });

  it("updates existing opencode.json preserving other fields", () => {
    setup();
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(
      configPath,
      JSON.stringify({ existingKey: "keep-me", mcpServers: { other: { command: "other" } } }, null, 2) + "\n",
    );

    const result = addOpencodePlugin(tmpDir);
    expect(result.opencodeJsonUpdated).toBe(true);
    expect(result.errors).toHaveLength(0);

    const config = readJson(configPath);
    expect(config["existingKey"]).toBe("keep-me");
    expect((config["mcpServers"] as Record<string, unknown>)["other"]).toEqual({ command: "other" });
    expect((config["mcpServers"] as Record<string, unknown>)["tsgraph"]).toEqual({
      command: "npx",
      args: ["@shvmgyl15/tsgraph", "mcp"],
    });
    teardown();
  });

  it("creates .opencode/agents/tsgraph.json", () => {
    setup();
    const result = addOpencodePlugin(tmpDir);
    expect(result.agentCreated).toBe(true);
    expect(result.errors).toHaveLength(0);

    const agentPath = path.join(tmpDir, ".opencode", "agents", "tsgraph.json");
    expect(fs.existsSync(agentPath)).toBe(true);

    const agent = readJson(agentPath);
    expect(agent["name"]).toBe("tsgraph");
    expect(agent["description"]).toBe(
      "Query the tsgraph codebase index for symbols, imports, dependencies, and analysis",
    );
    expect(agent["tools"]).toContain("tsgraph_query");
    expect(agent["tools"]).toContain("tsgraph_plan");
    teardown();
  });

  it("handles invalid existing opencode.json gracefully", () => {
    setup();
    const configPath = path.join(tmpDir, "opencode.json");
    fs.writeFileSync(configPath, "not valid json");

    const result = addOpencodePlugin(tmpDir);
    expect(result.opencodeJsonUpdated).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("Failed to update opencode.json");
    teardown();
  });
});
