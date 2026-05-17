# Changelog

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
