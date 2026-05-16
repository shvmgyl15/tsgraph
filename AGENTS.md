# tsgraph — Project DNA

## Vision
A fast, local-only CLI tool that indexes Next.js / React / TypeScript codebases using AST
parsing into a queryable graph.json for AI coding agents. Equivalent to gograph but for TS.
Output is Markdown + JSON. No network calls, no telemetry, no SaaS backend.

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

### Multi-Agent Awareness
- When another agent may be working in parallel, check TODOS.md `[.]` items to
  avoid modifying the same files. Do NOT assume build failures are your fault.
- When delegating sub-tasks via the `task` tool, be explicit about which files
  the sub-agent can safely modify and which phase they belong to.

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
