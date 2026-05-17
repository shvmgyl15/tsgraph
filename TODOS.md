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
- [x] Write query command tests

## Phase 5: Next.js / React Extractors
- [x] App Router tree detection (page/layout/loading/error/route files)
- [x] Pages Router detection
- [x] 'use client' / 'use server' + hooks analysis
- [x] Route extraction from API / route handlers
- [x] Write extractor tests

## Phase 6: Analysis Commands
- [ ] complexity (cyclomatic)
- [ ] hotspot / coupling / deps
- [ ] Write analysis tests

## Phase 7: Graph Traversal
- [ ] impact (BFS downstream blast radius)
- [ ] path (BFS shortest path between symbols)
- [ ] orphans (dead code detection)
- [ ] trace / errorflow (reverse BFS from string literal)
- [ ] Write traversal tests

## Phase 8: MCP Server
- [ ] MCP stdio server wrapping all query tools
- [ ] Tool definition for each search/query command
- [ ] MCP integration test

## Phase 9: Advanced Features
- [ ] boundaries (architecture enforcement via .tsgraph/boundaries.json)
- [ ] changes / stale (git-aware incremental analysis)
- [ ] plan / review (change planning reports)
- [ ] add-claude-plugin (auto-configure Claude Desktop / Code)
- [ ] GRAPH_REPORT.md generation
