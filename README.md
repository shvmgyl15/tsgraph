# tsgraph-mcp

A fast, local-only CLI tool that indexes TypeScript/React/Next.js codebases using AST parsing into a queryable graph.json for AI coding agents.

No network calls, no telemetry, no SaaS backend.

## Install

```bash
npm install -g tsgraph-mcp

# Or use directly via npx:
npx tsgraph-mcp build .
```

## Quick Start

```bash
# Index your project
cd my-project
tsgraph-mcp build .

# Query the graph
tsgraph-mcp query "getUser"          # search symbols
tsgraph-mcp callers "getUser"        # who calls getUser
tsgraph-mcp callees "getUser"        # what getUser calls
tsgraph-mcp node "getUser"           # symbol details
tsgraph-mcp source "getUser"         # symbol source code

# Analysis
tsgraph-mcp hotspots                 # files needing refactoring
tsgraph-mcp complexity --sort        # cyclomatic complexity
tsgraph-mcp orphans                  # dead code detection
tsgraph-mcp coupling                 # package dependency coupling

# Traversal
tsgraph-mcp impact "getUser"         # downstream blast radius
tsgraph-mcp path "foo" "bar"         # shortest call path
tsgraph-mcp trace "error msg"        # trace string literal upstream
```

## All Commands

| Command | Description |
|---------|-------------|
| `build <root>` | Index project into `.tsgraph/graph.json` + `GRAPH_REPORT.md` |
| `callers <symbol>` | Show callers of a symbol |
| `callees <symbol>` | Show callees of a symbol |
| `node <symbol>` | Show symbol details |
| `source <symbol>` | Extract source code for a symbol |
| `query <pattern>` | Search symbols by pattern |
| `imports <path>` | Find files importing a package path |
| `public [package]` | List exported symbols |
| `focus <package>` | Show all assets for a package |
| `context <symbol>` | Bundle node + source + callers + callees |
| `complexity [file]` | Cyclomatic complexity analysis |
| `hotspot` | Rank files by complexity × size |
| `coupling` | Package coupling analysis |
| `deps <symbol>` | Call dependency tree |
| `impact <symbol>` | Downstream blast radius (BFS) |
| `path <from> <to>` | Shortest call path (BFS) |
| `orphans` | Dead code detection |
| `trace <string>` | String literal trace upstream |
| `boundaries` | Architecture enforcement via `.tsgraph/boundaries.json` |
| `changes [--base]` | Git-aware changed files and symbols |
| `stale [--days]` | Files not modified recently |
| `plan <files...>` | Change planning with blast radius |
| `review [--base]` | Code review summary |
| `add-opencode-plugin` | Configure opencode MCP + agent |
| `mcp` | Start MCP stdio server |

## Next.js Support

tsgraph-mcp automatically detects Next.js project structure:

- **App Router**: `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `route.ts`
- **Pages Router**: `pages/` directory structure
- **Client/Server**: `'use client'` / `'use server'` directives
- **React Hooks**: detects hooks usage for client component inference
- **API Routes**: extracts route handlers from `route.ts` files

## Architecture Boundaries

Define layer rules in `.tsgraph/boundaries.json`:

```json
{
  "layers": [
    { "name": "ui", "path": "src/components", "dependsOn": ["shared"] },
    { "name": "shared", "path": "src/shared", "dependsOn": ["lib"] },
    { "name": "lib", "path": "src/lib", "dependsOn": [] }
  ]
}
```

```bash
tsgraph-mcp boundaries
```

## AI Agent Integration

### opencode

```bash
tsgraph-mcp add-opencode-plugin
```
Updates `opencode.json` with the tsgraph MCP server and creates `.opencode/agents/tsgraph.json`.

### Claude / Any MCP Client

```bash
tsgraph-mcp mcp
```
Starts an MCP stdio server exposing all query/search commands as tools. Configure your MCP client to launch `tsgraph-mcp mcp` as a subprocess.

## Development

```bash
git clone https://github.com/shvmgyl15/tsgraph.git
cd tsgraph
npm install
npm run build
npm test
```

## License

MIT
