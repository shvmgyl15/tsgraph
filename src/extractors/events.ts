import type { SourceFile, Node, CallExpression, NewExpression, VariableDeclaration } from "ts-morph";
import { Node as TsNode, SyntaxKind } from "ts-morph";
import { loadEventConfig } from "../config.js";
import type { SymbolNode } from "../graph/types.js";

function extractURLLiteral(node: Node): string | null {
  if (TsNode.isStringLiteral(node)) {
    return node.getLiteralValue();
  }
  if (TsNode.isNoSubstitutionTemplateLiteral(node)) {
    const raw = node.getText();
    return raw.startsWith("`") ? raw.slice(1, -1) : raw;
  }
  if (TsNode.isTemplateExpression(node)) {
    const head = node.getHead().getText().replace(/^`/, "").replace(/\$\{$/, "");
    return head || null;
  }
  return null;
}

function resolveURLFromVariable(
  decl: VariableDeclaration,
): string | null {
  const initializer = decl.getInitializer();
  if (!initializer) return null;
  return extractURLLiteral(initializer);
}

function findVariableDeclarationInScope(
  name: string,
  scopeNode: Node,
): VariableDeclaration | null {
  const body = scopeNode.getFirstChildByKind(
    SyntaxKind.Block,
  ) || scopeNode;
  for (const child of body.getChildren()) {
    if (TsNode.isVariableStatement(child)) {
      for (const decl of child.getDeclarations()) {
        if (decl.getName() === name) return decl;
      }
    }
  }
  return null;
}

function extractCallExpression(
  node: CallExpression | NewExpression,
  funcName: string,
  filePath: string,
  eventConfig: Record<string, any>[],
  scopeNode: Node,
): Record<string, any> | null {
  let calleeStr: string;
  if (TsNode.isPropertyAccessExpression(node.getExpression())) {
    calleeStr = node.getExpression().getText();
  } else {
    calleeStr = node.getExpression().getText();
  }

  for (const boundary of eventConfig) {
    if (boundary.type !== "consumer") continue;
    const match = boundary.match || {};
    const cp: string | undefined = match.callee_pattern;
    const hp: string | undefined = match.hook_pattern;

    const matched = (cp && calleeStr.includes(cp)) || (hp && calleeStr.includes(hp));
    if (!matched) continue;

    const argMap = match.args || {};
    const args = node.getArguments();
    const entry: Record<string, any> = {
      boundary: boundary.name,
      symbol: funcName,
      line: node.getStartLineNumber(),
    };

    for (const [argName, spec] of Object.entries(argMap)) {
      if (typeof spec === "number") {
        const arg = args[spec as number];
        if (arg) {
          if (TsNode.isStringLiteral(arg)) {
            entry[argName] = arg.getLiteralValue();
          } else if (TsNode.isNoSubstitutionTemplateLiteral(arg)) {
            entry[argName] = arg.getText().replace(/^`|`$/g, "");
          } else if (TsNode.isIdentifier(arg)) {
            const varName = arg.getText();
            const varDecl = findVariableDeclarationInScope(varName, scopeNode);
            if (varDecl) {
              const url = resolveURLFromVariable(varDecl);
              if (url) entry[argName] = url;
            }
          }
        }
      } else if (typeof spec === "string") {
        for (const kw of node.getArguments()) {
          if (TsNode.isStringLiteral(kw)) continue;
          const kwText = kw.getText();
          if (kwText.startsWith(spec + ":") || kwText.startsWith(spec + "=")) {
            const val = kwText.slice(kwText.indexOf(":") + 1 || kwText.indexOf("=") + 1).trim();
            if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
              entry[argName] = val.slice(1, -1);
            } else if (val.startsWith("`") && val.endsWith("`")) {
              entry[argName] = val.slice(1, -1);
            } else {
              const varDecl = findVariableDeclarationInScope(val, scopeNode);
              if (varDecl) {
                const url = resolveURLFromVariable(varDecl);
                if (url) entry[argName] = url;
              }
            }
          }
        }
      }
    }

    return entry;
  }

  return null;
}

function walkScopeForEvents(
  scopeNode: Node,
  funcName: string,
  filePath: string,
  eventConfig: Record<string, any>[],
): Record<string, any>[] {
  const result: Record<string, any>[] = [];

  scopeNode.forEachDescendant((node) => {
    if (!TsNode.isCallExpression(node) && !TsNode.isNewExpression(node)) return false;
    const entry = extractCallExpression(node, funcName, filePath, eventConfig, scopeNode);
    if (entry) result.push(entry);
    return false;
  });

  return result;
}

export function enrichSymbolsWithEvents(
  symbols: SymbolNode[],
  sourceFile: SourceFile,
  filePath: string,
): SymbolNode[] {
  const eventConfig = loadEventConfig();
  if (!eventConfig.length) return symbols;

  const calleeConsumerBoundaries = eventConfig.filter(
    (b: Record<string, any>) =>
      b.type === "consumer" &&
      (b.match?.callee_pattern || b.match?.hook_pattern),
  );
  if (!calleeConsumerBoundaries.length) return symbols;

  const enriched: SymbolNode[] = [];

  for (const sym of symbols) {
    const funcScope = findScopeNode(sourceFile, sym);
    if (funcScope) {
      const consumptions = walkScopeForEvents(
        funcScope,
        sym.name,
        filePath,
        calleeConsumerBoundaries,
      );
      if (consumptions.length) {
        sym.eventConsumptions = [...(sym.eventConsumptions || []), ...consumptions];
      }
    }
    enriched.push(sym);
  }

  return enriched;
}

function findScopeNode(
  sourceFile: SourceFile,
  sym: Record<string, any>,
): Node | null {
  const name = sym.name;
  const receiver = sym.receiver;

  if (receiver) {
    const cls = sourceFile.getClass(receiver);
    if (!cls) return null;
    const method = cls.getMethod(name);
    return method || null;
  }

  const func = sourceFile.getFunction(name);
  if (func) return func;

  for (const vs of sourceFile.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      if (decl.getName() === name) {
        const initializer = decl.getInitializer();
        if (initializer && (TsNode.isArrowFunction(initializer) || TsNode.isFunctionExpression(initializer))) {
          return initializer;
        }
      }
    }
  }

  return null;
}
