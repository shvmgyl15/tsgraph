import path from "node:path";
import fs from "node:fs";
import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
  type CallExpression,
} from "ts-morph";
import type {
  Graph,
  SymbolNode,
  CallEdge,
  ImportEdge,
  Dependency,
  FileNode,
  PackageNode,
  HttpCallEdge,
} from "../graph/types.js";
import { GRAPH_VERSION } from "../graph/types.js";
import { loadEventConfig } from "../config.js";
import type { ScannedFile } from "../scanner/index.js";
import { extractNextJs } from "../nextjs/index.js";
import { extractReactNative } from "../react-native/index.js";
import { enrichSymbolsWithEvents } from "../extractors/events.js";

function symbolId(file: string, name: string): string {
  return `${file}::${name}`;
}

function countLines(filePath: string): number {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return content.split("\n").length;
  } catch {
    return 0;
  }
}

function extractFileNodes(
  rootDir: string,
  scanned: ScannedFile[],
  pkg: string,
): FileNode[] {
  return scanned.map((sf) => ({
    id: sf.relativePath,
    path: sf.relativePath,
    packageName: pkg,
    lines: countLines(sf.path),
    generated: sf.isGenerated,
  }));
}

function extractSymbols(
  sourceFile: SourceFile,
  filePath: string,
  pkgName: string,
): SymbolNode[] {
  const symbols: SymbolNode[] = [];

  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (!name) continue;
    symbols.push({
      id: symbolId(filePath, name),
      kind: "function",
      name,
      packageName: pkgName,
      file: filePath,
      line: func.getStartLineNumber(),
      endLine: func.getEndLineNumber(),
      isExported: func.isExported(),
      arity: func.getParameters().length,
    });
  }

  for (const cls of sourceFile.getClasses()) {
    const name = cls.getName();
    if (!name) continue;
    symbols.push({
      id: symbolId(filePath, name),
      kind: "class",
      name,
      packageName: pkgName,
      file: filePath,
      line: cls.getStartLineNumber(),
      endLine: cls.getEndLineNumber(),
      isExported: cls.isExported(),
    });

    for (const method of cls.getMethods()) {
      const mName = method.getName();
      if (!mName) continue;
      symbols.push({
        id: symbolId(filePath, `${name}.${mName}`),
        kind: "method",
        name: mName,
        receiver: name,
        packageName: pkgName,
        file: filePath,
        line: method.getStartLineNumber(),
        endLine: method.getEndLineNumber(),
        isExported: true,
        arity: method.getParameters().length,
      });
    }
  }

  for (const iface of sourceFile.getInterfaces()) {
    const name = iface.getName();
    symbols.push({
      id: symbolId(filePath, name),
      kind: "interface",
      name,
      packageName: pkgName,
      file: filePath,
      line: iface.getStartLineNumber(),
      endLine: iface.getEndLineNumber(),
      isExported: iface.isExported(),
    });
  }

  for (const alias of sourceFile.getTypeAliases()) {
    const name = alias.getName();
    symbols.push({
      id: symbolId(filePath, name),
      kind: "type_alias",
      name,
      packageName: pkgName,
      file: filePath,
      line: alias.getStartLineNumber(),
      endLine: alias.getEndLineNumber(),
      isExported: alias.isExported(),
    });
  }

  for (const enm of sourceFile.getEnums()) {
    const name = enm.getName();
    symbols.push({
      id: symbolId(filePath, name),
      kind: "enum",
      name,
      packageName: pkgName,
      file: filePath,
      line: enm.getStartLineNumber(),
      endLine: enm.getEndLineNumber(),
      isExported: enm.isExported(),
    });
  }

  for (const vs of sourceFile.getVariableStatements()) {
    const isExported = vs.isExported();
    const isConst =
      vs
        .getDeclarationList()
        .getFirstChildByKind(SyntaxKind.ConstKeyword) !== undefined;
    const varKind = isConst ? "const" : "var";
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      symbols.push({
        id: symbolId(filePath, name),
        kind: varKind,
        name,
        packageName: pkgName,
        file: filePath,
        line: decl.getStartLineNumber(),
        endLine: decl.getEndLineNumber(),
        isExported,
      });
    }
  }

  return symbols;
}

function extractCalls(
  sourceFile: SourceFile,
  filePath: string,
): CallEdge[] {
  const calls: CallEdge[] = [];

  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (!name) continue;
    const funcId = symbolId(filePath, name);
    func.forEachDescendant((node) => {
      if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
        const calleeRaw = node.getExpression().getText();
        calls.push({
          callerSymbolId: funcId,
          callerName: name,
          calleeRaw,
          file: filePath,
          line: node.getStartLineNumber(),
        });
      }
      return false;
    });
  }

  for (const cls of sourceFile.getClasses()) {
    const clsName = cls.getName();
    if (!clsName) continue;
    for (const method of cls.getMethods()) {
      const mName = method.getName();
      if (!mName) continue;
      const methodId = symbolId(filePath, `${clsName}.${mName}`);
      method.forEachDescendant((node) => {
        if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
          const calleeRaw = node.getExpression().getText();
          calls.push({
            callerSymbolId: methodId,
            callerName: mName,
            calleeRaw,
            file: filePath,
            line: node.getStartLineNumber(),
          });
        }
        return false;
      });
    }
  }

  for (const vs of sourceFile.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      if (!name) continue;
      const initializer = decl.getInitializer();
      if (!initializer) continue;
      if (!Node.isArrowFunction(initializer) && !Node.isFunctionExpression(initializer)) continue;
      const declId = symbolId(filePath, name);
      initializer.forEachDescendant((node) => {
        if (Node.isCallExpression(node) || Node.isNewExpression(node)) {
          const calleeRaw = node.getExpression().getText();
          calls.push({
            callerSymbolId: declId,
            callerName: name,
            calleeRaw,
            file: filePath,
            line: node.getStartLineNumber(),
          });
        }
        return false;
      });
    }
  }

  return calls;
}

function extractImports(
  sourceFile: SourceFile,
  filePath: string,
  pkgName: string,
): ImportEdge[] {
  const imports: ImportEdge[] = [];

  for (const imp of sourceFile.getImportDeclarations()) {
    const importPath = imp.getModuleSpecifierValue();

    const defaultImport = imp.getDefaultImport();
    if (defaultImport) {
      imports.push({
        fromFile: filePath,
        fromPackage: pkgName,
        importPath,
        alias: defaultImport.getText(),
        isDefault: true,
      });
    }

    for (const named of imp.getNamedImports()) {
      imports.push({
        fromFile: filePath,
        fromPackage: pkgName,
        importPath,
        alias: named.getName(),
        isDefault: false,
      });
    }
  }

  return imports;
}

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

function extractMethodFromOptions(node: Node): string | null {
  if (!Node.isObjectLiteralExpression(node)) return null;
  const methodProp = node.getProperty("method");
  if (!methodProp) return null;
  if (!Node.isPropertyAssignment(methodProp)) return null;
  const initializer = methodProp.getInitializer();
  if (!initializer || !Node.isStringLiteral(initializer)) return null;
  return initializer.getLiteralValue().toUpperCase();
}

function parsePathSegments(url: string): string[] {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    const qIndex = path.indexOf("?");
    if (qIndex !== -1) path = path.slice(0, qIndex);
  }
  return path.split("/").filter((s) => s.length > 0);
}

function extractUrlInfo(node: Node): {
  url: string;
  staticSegments: string[];
  hasDynamic: boolean;
} {
  if (Node.isStringLiteral(node)) {
    const url = node.getLiteralValue();
    return { url, staticSegments: parsePathSegments(url), hasDynamic: false };
  }
  if (Node.isNoSubstitutionTemplateLiteral(node)) {
    const raw = node.getText();
    const url = raw.startsWith("`") ? raw.slice(1, -1) : raw;
    return { url, staticSegments: parsePathSegments(url), hasDynamic: false };
  }
  if (Node.isTemplateExpression(node)) {
    const parts: string[] = [];
    const head = node.getHead();
    let headText = head.getText();
    if (headText.startsWith("`")) headText = headText.slice(1);
    if (headText.endsWith("${")) headText = headText.slice(0, -2);
    parts.push(headText);
    for (const span of node.getTemplateSpans()) {
      let litText = span.getLiteral().getText();
      if (litText.startsWith("}")) litText = litText.slice(1);
      if (litText.endsWith("${")) litText = litText.slice(0, -2);
      if (litText.endsWith("`")) litText = litText.slice(0, -1);
      parts.push(litText);
    }
    const combinedStatic = parts.join("");
    return {
      url: node.getText(),
      staticSegments: parsePathSegments(combinedStatic),
      hasDynamic: true,
    };
  }
  return {
    url: node.getText(),
    staticSegments: [],
    hasDynamic: true,
  };
}

function matchHttpCall(
  exprText: string,
  node: CallExpression,
): { method: string } | null {
  if (exprText === "fetch") {
    const args = node.getArguments();
    if (args.length >= 2) {
      const method = extractMethodFromOptions(args[1]);
      if (method) return { method };
    }
    return { method: "GET" };
  }
  const lastDot = exprText.lastIndexOf(".");
  if (lastDot === -1) return null;
  const methodName = exprText.slice(lastDot + 1);
  if (HTTP_METHODS.has(methodName)) {
    return { method: methodName.toUpperCase() };
  }
  return null;
}

function extractHttpCallsInScope(
  node: Node,
  filePath: string,
  functionName: string,
): HttpCallEdge[] {
  const calls: HttpCallEdge[] = [];
  node.forEachDescendant((child) => {
    if (!Node.isCallExpression(child)) return false;
    const expr = child.getExpression();
    const exprText = expr.getText();
    const matched = matchHttpCall(exprText, child);
    if (!matched) return false;
    const args = child.getArguments();
    if (args.length === 0) return false;
    const urlInfo = extractUrlInfo(args[0]);
    calls.push({
      sourceFile: filePath,
      sourceLine: child.getStartLineNumber(),
      functionName,
      method: matched.method,
      url: urlInfo.url,
      staticSegments: urlInfo.staticSegments,
      hasDynamic: urlInfo.hasDynamic,
    });
    return false;
  });
  return calls;
}

function extractHttpCalls(
  sourceFile: SourceFile,
  filePath: string,
): HttpCallEdge[] {
  const calls: HttpCallEdge[] = [];
  for (const func of sourceFile.getFunctions()) {
    const name = func.getName();
    if (!name) continue;
    calls.push(...extractHttpCallsInScope(func, filePath, name));
  }
  for (const cls of sourceFile.getClasses()) {
    const clsName = cls.getName();
    if (!clsName) continue;
    for (const method of cls.getMethods()) {
      const mName = method.getName();
      if (!mName) continue;
      calls.push(
        ...extractHttpCallsInScope(
          method,
          filePath,
          `${clsName}.${mName}`,
        ),
      );
    }
  }
  for (const vs of sourceFile.getVariableStatements()) {
    for (const decl of vs.getDeclarations()) {
      const name = decl.getName();
      if (!name) continue;
      const initializer = decl.getInitializer();
      if (!initializer) continue;
      if (
        !Node.isArrowFunction(initializer) &&
        !Node.isFunctionExpression(initializer)
      )
        continue;
      calls.push(
        ...extractHttpCallsInScope(initializer, filePath, name),
      );
    }
  }
  return calls;
}

function readDependencyMap(rootDir: string): Record<string, string> {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    return {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
    };
  } catch {
    return {};
  }
}

function readDependencies(rootDir: string): Dependency[] {
  const allDeps = readDependencyMap(rootDir);
  return Object.entries(allDeps).map(([module, version]) => ({
    module,
    version: String(version),
  }));
}

function computePackageName(rootDir: string): string {
  try {
    const pkgPath = path.join(rootDir, "package.json");
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    return pkg.name ?? path.basename(rootDir);
  } catch {
    return path.basename(rootDir);
  }
}

export function parseProject(rootDir: string, scanned: ScannedFile[]): Graph {
  const pkgName = computePackageName(rootDir);
  const fileNodes = extractFileNodes(rootDir, scanned, pkgName);

  const rootPackage: PackageNode = {
    id: pkgName,
    name: pkgName,
    importPathBestEffort: pkgName,
    dir: rootDir,
    files: scanned.map((sf) => sf.relativePath),
  };

  const project = new Project({
    compilerOptions: {
      allowJs: true,
      noEmit: true,
    },
  });

  const parsable = scanned.filter(
    (sf) =>
      sf.kind === "ts" || sf.kind === "tsx" || sf.kind === "js" || sf.kind === "jsx",
  );

  for (const sf of parsable) {
    try {
      project.addSourceFileAtPath(sf.path);
    } catch {
      // skip files that fail to parse
    }
  }

  const allSymbols: SymbolNode[] = [];
  const allCalls: CallEdge[] = [];
  const allImports: ImportEdge[] = [];
  const allHttpCalls: HttpCallEdge[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = path.relative(rootDir, sourceFile.getFilePath());
    const symbols = extractSymbols(sourceFile, relPath, pkgName);
    const calls = extractCalls(sourceFile, relPath);
    const imports = extractImports(sourceFile, relPath, pkgName);
    const httpCalls = extractHttpCalls(sourceFile, relPath);

    allSymbols.push(...symbols);
    allCalls.push(...calls);
    allImports.push(...imports);
    allHttpCalls.push(...httpCalls);
  }

  const depMap = readDependencyMap(rootDir);
  const dependencies = readDependencies(rootDir);

  const baseGraph: Graph = {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    root: rootDir,
    packages: [rootPackage],
    files: fileNodes,
    symbols: allSymbols,
    imports: allImports,
    calls: allCalls,
    envReads: [],
    dependencies,
    routes: [],
    concurrency: [],
    testEdges: [],
    implements: [],
    mutations: [],
    errors: [],
    httpCalls: allHttpCalls,
  };

  let graph = extractNextJs(baseGraph, rootDir, scanned);
  graph = extractReactNative(graph, rootDir, scanned, depMap);

  // Enrich symbols with event boundary data (SSE subscribers, hook patterns)
  for (const sourceFile of project.getSourceFiles()) {
    const relPath = path.relative(rootDir, sourceFile.getFilePath());
    graph.symbols = enrichSymbolsWithEvents(graph.symbols, sourceFile, relPath);
  }

  return graph;
}
