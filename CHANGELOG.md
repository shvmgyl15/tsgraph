# Changelog

## 0.3.0 — 2026-05-18

### Added
- Call extraction from const arrow functions (React components, hooks) — fixes the dominant pattern in React/Next.js codebases
- `new` expression call extraction — class instantiation via `new` is now recorded as a call edge
- `trace` command now searches within const arrow function bodies (was previously limited to function/method declarations)

### Fixed
- P0: Call graph was missing ~98% of calls in React codebases (const arrow functions were completely skipped)
- P1: `new ClassName()` was not captured as a call edge, affecting class-based service/utility patterns
- P2: Low calls/symbol ratio resolved (fixing P0+P1 increases call density 3-5x in React projects)

## 0.2.0 — 2026-05-17

### Added
- CLI commands: `impact`, `path`, `orphans`, `trace` (were MCP-only, now available as `tsgraph` commands)
- Regex support in `query` — tries regex first, falls back to substring matching (`query ".+"` now enumerates all symbols)
- Incremental builds — file mtime tracking skips full re-index when nothing changed (`--force` to override)
- `--root` flag on `mcp` command — run the MCP server against any project without wrapper scripts
- package.json dependency hint in `imports` — when a package yields no imports but exists in dependencies, shows a hint

### Fixed
- `opencode` test failures (`@shvmgyl15/tsgraph` package name mismatch)

### Changed
- `build` command no longer re-indexes if files are unchanged (use `--force` for full rebuild)
