import fs from "node:fs";
import path from "node:path";
import type { Graph, SymbolNode } from "../graph/types.js";

interface DecisionPattern {
  regex: RegExp;
  label: string;
}

const DECISION_PATTERNS: DecisionPattern[] = [
  { regex: /\bif\s*\(/g, label: "if" },
  { regex: /\belse\s+if\s*\(/g, label: "elseif" },
  { regex: /\bfor\s*\(/g, label: "for" },
  { regex: /\bwhile\s*\(/g, label: "while" },
  { regex: /\bdo\s*\{/g, label: "do" },
  { regex: /\bcatch\s*\(/g, label: "catch" },
  { regex: /\bcase\s+/g, label: "case" },
  { regex: /\|\|/g, label: "or" },
  { regex: /&&/g, label: "and" },
];

function stripComments(code: string): string {
  return code
    .replace(/\/\/.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
}

function stripStrings(code: string): string {
  const inString = (s: string) => {
    let result = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === '"' || s[i] === "'" || s[i] === "`") {
        const quote = s[i];
        i++;
        while (i < s.length && s[i] !== quote) {
          if (s[i] === "\\") i++;
          i++;
        }
      } else {
        result += s[i];
      }
      i++;
    }
    return result;
  };
  return inString(code);
}

export function cyclomaticComplexity(sourceCode: string): number {
  const cleaned = stripStrings(stripComments(sourceCode));
  let decisions = 0;

  for (const dp of DECISION_PATTERNS) {
    const matches = cleaned.match(dp.regex);
    if (matches) decisions += matches.length;
  }

  const elseIfCount = (cleaned.match(/\belse\s+if\s*\(/g) || []).length;
  decisions -= elseIfCount;

  const ternaryMatches = cleaned.match(/\?/g);
  if (ternaryMatches) {
    for (const m of ternaryMatches) {
      const idx = cleaned.indexOf(m);
      const before = cleaned[idx - 1];
      if (before !== "?" && before !== "!" && before !== "=") {
        decisions++;
      }
    }
  }

  return Math.max(1, 1 + decisions);
}

export interface ComplexityResult {
  symbol: SymbolNode;
  complexity: number;
}

export function analyzeComplexity(
  graph: Graph,
  fileFilter?: string,
): ComplexityResult[] {
  const results: ComplexityResult[] = [];
  const root = graph.root;

  for (const sym of graph.symbols) {
    if (fileFilter && !sym.file.includes(fileFilter)) continue;
    if (sym.kind !== "function" && sym.kind !== "method") continue;

    const filePath = path.join(root, sym.file);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const lines = content.split("\n");
      const start = Math.max(0, sym.line - 1);
      const end = Math.min(lines.length, sym.endLine);
      const snippet = lines.slice(start, end).join("\n");
      const complexity = cyclomaticComplexity(snippet);
      results.push({ symbol: sym, complexity });
    } catch {
      continue;
    }
  }

  return results;
}
