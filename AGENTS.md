# tsgraph — Project DNA

## Vision
A fast, local-only CLI tool that indexes Next.js / React / TypeScript codebases using AST
parsing into a queryable graph.json for AI coding agents. Equivalent to gograph but for TS.
Output is Markdown + JSON. No network calls, no telemetry, no SaaS backend.

## Design Philosophy (Go → TS Adaptation)
tsgraph is inspired by gograph (Go) but adapted for TypeScript/React/Next.js — NOT a blind copy.
Key language-driven differences:
- **Export model**: TS `export` keyword maps to `isExported`; class methods are always considered exported (default `public`)
- **No goroutines/channels** — replaced by async/promise/setTimeout concurrency
- **No struct tags** — TS has no native equivalent
- **Router detection** is Next.js App Router / Pages Router, not Gin/mux
- **React components** tracked via `isClientComponent` / `isServerComponent`
- **Interface satisfaction** is structural in TS — `ImplementsEdge` may be dropped if unused
- Go-specific concepts (structs with fields+tests, `MutationEdge`, `StructField.tags`) are present but may be removed if they don't earn their keep for TS

## Tech Stack
- Runtime: Node.js + tsx (dev) / tsc (build)
- AST: ts-morph (wraps TypeScript compiler API)
- CLI: commander
- MCP: @modelcontextprotocol/sdk
- Testing: vitest
- Linting: none (tsc strict mode is sufficient)

## Agent Rules

### Task Management
- READ TODOS.md at session start to know what's done and what's next
- UPDATE TODOS.md when you start/finish a task (`[.]` in-progress, `[x]` done)
- Work in phase order unless a task has no blockers

### Orchestration
- This is a single-orchestrator project. When a task has multiple independent
  sub-tasks, delegate via the `task` tool (`subagent_type: general`) rather
  than doing them sequentially.
- For each delegated sub-task, specify:
  1. Exact files the sub-agent may modify
  2. Which phase from TODOS.md it belongs to
  3. What to return (never let sub-agents commit or merge)
- After all sub-tasks complete, run `npm run build && npm test` and fix
  any issues directly. Do NOT re-delegate broken builds.

### Quality
- Run `npm run build` (tsc) AND `npm test` (vitest) after every task completion
- Fix all type errors and test failures before marking `[x]`
- If build is already broken when you start, note it in TODOS.md and fix it first

### Research
- Use webfetch when unsure about an API — check ts-morph docs, Next.js docs,
  or reference gograph's Go source at https://github.com/ozgurcd/gograph
- DO NOT guess API signatures

### Code Style
- No comments in source files unless logic is non-obvious
- Named exports only (no default exports)
- Strict TypeScript everywhere, avoid `any`
- Follow patterns from adjacent files in the codebase
- No emojis in source code or commit messages

### Communication
- Be concise. Use TODOS.md for status, respond with only what's needed.
- If stuck, explain the blocker clearly rather than overthinking.
