import fs from "node:fs";
import path from "node:path";
import type { Graph, SymbolNode } from "../graph/types.js";

const REACT_HOOKS = new Set([
  "useState", "useEffect", "useContext", "useReducer", "useCallback",
  "useMemo", "useRef", "useImperativeHandle", "useLayoutEffect",
  "useDebugValue", "useTransition", "useDeferredValue", "useId",
  "useSyncExternalStore", "useInsertionEffect", "useActionState",
  "useOptimistic",
]);

function getDirectives(filePath: string): {
  isClient: boolean;
  isServer: boolean;
} {
  try {
    const fd = fs.openSync(filePath, "r");
    const buffer = Buffer.alloc(512);
    const bytesRead = fs.readSync(fd, buffer, 0, 512, 0);
    fs.closeSync(fd);
    const head = buffer.toString("utf-8", 0, bytesRead);
    const lines = head.split("\n").slice(0, 5);
    const trimmed = lines.map((l) => l.trim().replace(/;$/, ""));
    return {
      isClient: trimmed.some((l) => l === `"use client"` || l === `'use client'`),
      isServer: trimmed.some((l) => l === `"use server"` || l === `'use server'`),
    };
  } catch {
    return { isClient: false, isServer: false };
  }
}

function checkHookUsage(
  filePath: string,
  symbols: SymbolNode[],
): SymbolNode[] {
  const updated: SymbolNode[] = [];
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const sym of symbols) {
      const lines = content.split("\n");
      const snippet = lines.slice(sym.line - 1, sym.endLine).join("\n");
      const usesHooks = [...REACT_HOOKS].some((hook) => {
        const idx = snippet.indexOf(hook);
        if (idx === -1) return false;
        const before = snippet[idx - 1];
        if (before && (before === "." || /[a-zA-Z0-9]/.test(before))) return false;
        return true;
      });
      if (usesHooks) {
        updated.push({ ...sym, isClientComponent: true });
      } else {
        updated.push(sym);
      }
    }
  } catch {
    return symbols;
  }
  return updated;
}

export function classifyReactComponents(
  graph: Graph,
  rootDir: string,
): Graph {
  const symByFile = new Map<string, SymbolNode[]>();
  for (const sym of graph.symbols) {
    const list = symByFile.get(sym.file) ?? [];
    list.push(sym);
    symByFile.set(sym.file, list);
  }

  const updatedSymbols: SymbolNode[] = [];

  for (const [fileRel, symbols] of symByFile) {
    const filePath = path.join(rootDir, fileRel);
    const { isClient, isServer } = getDirectives(filePath);

    if (isClient || isServer) {
      updatedSymbols.push(
        ...symbols.map((s) => ({
          ...s,
          isClientComponent: isClient || s.isClientComponent,
          isServerComponent: isServer || s.isServerComponent,
        })),
      );
      continue;
    }

    if (fileRel.endsWith(".tsx")) {
      const checked = checkHookUsage(filePath, symbols);
      updatedSymbols.push(...checked);
    } else {
      updatedSymbols.push(...symbols);
    }
  }

  return { ...graph, symbols: updatedSymbols };
}
