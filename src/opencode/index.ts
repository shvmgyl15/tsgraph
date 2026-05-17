import fs from "node:fs";
import path from "node:path";

const MCP_SERVER_CONFIG = {
  command: "npx",
  args: ["@shvmgyl15/tsgraph", "mcp"],
};

const AGENT_CONFIG = {
  name: "tsgraph",
  description: "Query the tsgraph codebase index for symbols, imports, dependencies, and analysis",
  tools: [
    "tsgraph_callers",
    "tsgraph_callees",
    "tsgraph_node",
    "tsgraph_source",
    "tsgraph_query",
    "tsgraph_imports",
    "tsgraph_public",
    "tsgraph_focus",
    "tsgraph_context",
    "tsgraph_complexity",
    "tsgraph_hotspot",
    "tsgraph_coupling",
    "tsgraph_deps",
    "tsgraph_impact",
    "tsgraph_path",
    "tsgraph_orphans",
    "tsgraph_trace",
    "tsgraph_boundaries",
    "tsgraph_changes",
    "tsgraph_stale",
    "tsgraph_plan",
    "tsgraph_review",
  ],
};

export interface AddPluginResult {
  opencodeJsonUpdated: boolean;
  agentCreated: boolean;
  errors: string[];
}

export function addOpencodePlugin(rootDir: string): AddPluginResult {
  const errors: string[] = [];
  let opencodeJsonUpdated = false;
  let agentCreated = false;

  const opencodeJsonPath = path.join(rootDir, "opencode.json");

  try {
    let config: Record<string, unknown>;
    if (fs.existsSync(opencodeJsonPath)) {
      const raw = fs.readFileSync(opencodeJsonPath, "utf-8");
      config = JSON.parse(raw);
    } else {
      config = {};
    }

    config["mcpServers"] = {
      ...((config["mcpServers"] as Record<string, unknown>) || {}),
      tsgraph: MCP_SERVER_CONFIG,
    };

    fs.writeFileSync(opencodeJsonPath, JSON.stringify(config, null, 2) + "\n");
    opencodeJsonUpdated = true;
  } catch (e) {
    errors.push(`Failed to update opencode.json: ${String(e)}`);
  }

  try {
    const agentsDir = path.join(rootDir, ".opencode", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    const agentPath = path.join(agentsDir, "tsgraph.json");
    fs.writeFileSync(agentPath, JSON.stringify(AGENT_CONFIG, null, 2) + "\n");
    agentCreated = true;
  } catch (e) {
    errors.push(`Failed to create tsgraph agent: ${String(e)}`);
  }

  return { opencodeJsonUpdated, agentCreated, errors };
}
