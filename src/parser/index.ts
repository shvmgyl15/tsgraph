import path from "node:path";
import fs from "node:fs";
import {
  Project,
  Node,
  SyntaxKind,
  type SourceFile,
} from "ts-morph";
import type {
  Graph,
  SymbolNode,
  CallEdge,
  ImportEdge,
  Dependency,
  FileNode,
  PackageNode,
} from "../graph/types.js";
import { GRAPH_VERSION } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

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
      if (Node.isCallExpression(node)) {
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
        if (Node.isCallExpression(node)) {
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

function readDependencies(rootDir: string): Dependency[] {
  const pkgPath = path.join(rootDir, "package.json");
  try {
    const raw = fs.readFileSync(pkgPath, "utf-8");
    const pkg = JSON.parse(raw);
    const deps: Dependency[] = [];
    const allDeps: Record<string, string> = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    for (const [module, version] of Object.entries(allDeps)) {
      deps.push({ module, version: String(version) });
    }
    return deps;
  } catch {
    return [];
  }
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

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = path.relative(rootDir, sourceFile.getFilePath());
    const symbols = extractSymbols(sourceFile, relPath, pkgName);
    const calls = extractCalls(sourceFile, relPath);
    const imports = extractImports(sourceFile, relPath, pkgName);

    allSymbols.push(...symbols);
    allCalls.push(...calls);
    allImports.push(...imports);
  }

  const dependencies = readDependencies(rootDir);

  return {
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
  };
}
