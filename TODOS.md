# tsgraph — Implementation Plan

## Phase 1: Project Scaffold
- [x] Update opencode.json with AGENTS.md reference
- [x] Create AGENTS.md with project DNA
- [x] Create TODOS.md (this file)
- [x] Initialize package.json with dependencies
- [x] Configure tsconfig.json (strict, ESNext)
- [x] Setup vitest config
- [x] Create src directory structure

## Phase 2: Core Data Model
- [x] Define graph types (Graph, PackageNode, FileNode, SymbolNode, etc.)
- [x] Add JSON serialization / deserialization
- [x] Write unit tests for graph types

## Phase 3: Scanner + Parser Core
- [x] Implement file scanner (walk tree, gitignore support, file classification)
- [x] Implement symbol extractor (ts-morph: functions, classes, interfaces, types, enums, vars)
- [x] Implement call expression extractor
- [x] Implement import edge + dependency (package.json) extractor
- [x] Wire up `build` command end-to-end
- [x] Write parser/scanner unit tests

## Phase 4: Query Commands
- [x] callers / callees
- [x] node / source / query
- [x] context (bundle — node + source + callers + callees + tests)
- [x] imports / public / focus
- [x] impact / path / orphans / trace (CLI commands)
- [x] query regex support (fallback to substring)
- [x] Write query command tests

## Phase 5: Next.js / React Extractors
- [x] App Router tree detection (page/layout/loading/error/route files)
- [x] Pages Router detection
- [x] 'use client' / 'use server' + hooks analysis
- [x] Route extraction from API / route handlers
- [x] Write extractor tests

## Phase 6: Analysis Commands
- [x] complexity (cyclomatic)
- [x] hotspot / coupling / deps
- [x] Write analysis tests

## Phase 7: Graph Traversal
- [x] impact (BFS downstream blast radius)
- [x] path (BFS shortest path between symbols)
- [x] orphans (dead code detection)
- [x] trace / errorflow (reverse BFS from string literal)
- [x] Write traversal tests

## Phase 8: MCP Server
- [x] MCP stdio server wrapping all query tools
- [x] Tool definition for each search/query command
- [x] MCP integration test
- [x] `--root` flag for running MCP server against any project

## Phase 9: Advanced Features
- [x] boundaries (architecture enforcement via .tsgraph/boundaries.json)
- [x] changes / stale (git-aware incremental analysis)
- [x] plan / review (change planning reports)
- [x] add-opencode-plugin (auto-configure opencode MCP + agent)
- [x] Enhanced GRAPH_REPORT.md (hotspots, boundaries, coupling, stale)
- [x] Incremental builds (file mtime tracking, skip rebuild when unchanged)

## Phase 10: Call Extraction Fixes
- [x] P0: Const arrow function call extraction in extractCalls()
- [x] P1: `new` expression support in call extraction
- [x] P2: Low call count resolved (consequence of P0+P1)
- [x] trace() includes const kind symbols
- [x] Tests added for const arrow calls, new expressions, and combined
