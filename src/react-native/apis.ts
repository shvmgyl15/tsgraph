import { Project, Node } from "ts-morph";
import type { Graph, NativeModuleRef, RNAPIUsage } from "../graph/types.js";

const REANIMATED_HOOKS = new Set([
  "useSharedValue",
  "useAnimatedStyle",
  "useDerivedValue",
  "useAnimatedProps",
  "useAnimatedReaction",
  "useWorkletCallback",
  "useRunOnJS",
]);

const RN_APIS = new Set([
  "Dimensions",
  "Linking",
  "AsyncStorage",
]);

function findEnclosingSymbolName(node: Node): string | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isFunctionDeclaration(current) || Node.isFunctionExpression(current)) {
      return current.getName() ?? undefined;
    }
    if (Node.isArrowFunction(current)) {
      const parent = current.getParent();
      if (parent && Node.isVariableDeclaration(parent)) {
        return parent.getName();
      }
      return undefined;
    }
    if (Node.isMethodDeclaration(current)) {
      const name = current.getName();
      const cls = current.getParent();
      if (cls && Node.isClassDeclaration(cls) && cls.getName()) {
        return `${cls.getName()}.${name}`;
      }
      return name;
    }
    current = current.getParent();
  }
  return undefined;
}

export function extractRNStyleUsages(graph: Graph, project: Project): Graph {
  const updatedSymbols = [...graph.symbols];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = graph.root
      ? sourceFile.getFilePath().replace(graph.root, "").replace(/^[/\\]/, "")
      : sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return false;

      const exprText = node.getExpression().getText();
      if (exprText !== "StyleSheet.create") return false;

      const symName = findEnclosingSymbolName(node);
      if (!symName) return false;

      const sym = updatedSymbols.find((s) => s.name === symName && s.file === relPath);
      if (sym) {
        sym.rnStyleSheets = (sym.rnStyleSheets ?? 0) + 1;
      }

      return false;
    });
  }

  return { ...graph, symbols: updatedSymbols };
}

export function extractNativeModuleRefs(graph: Graph, project: Project): Graph {
  const refs: NativeModuleRef[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = graph.root
      ? sourceFile.getFilePath().replace(graph.root, "").replace(/^[/\\]/, "")
      : sourceFile.getFilePath();

    // TurboModuleRegistry.get<T>('ModuleName')
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return false;
      const exprText = node.getExpression().getText();

      if (exprText === "TurboModuleRegistry.get" || exprText === "TurboModuleRegistry.getEnforcing") {
        const args = node.getArguments();
        if (args.length >= 1 && Node.isStringLiteral(args[0])) {
          const symName = findEnclosingSymbolName(node) ?? "unknown";
          refs.push({
            symbolName: symName,
            file: relPath,
            moduleName: args[0].getLiteralValue(),
            kind: "turbo",
          });
        }
      }

      return false;
    });

    // requireNativeComponent('ComponentName')
    sourceFile.forEachDescendant((node) => {
      if (!Node.isCallExpression(node)) return false;
      const exprText = node.getExpression().getText();
      if (exprText !== "requireNativeComponent") return false;

      const args = node.getArguments();
      if (args.length >= 1 && Node.isStringLiteral(args[0])) {
        const symName = findEnclosingSymbolName(node) ?? "unknown";
        refs.push({
          symbolName: symName,
          file: relPath,
          moduleName: args[0].getLiteralValue(),
          kind: "native-component",
        });
      }

      return false;
    });

    // NativeModules.XXX
    sourceFile.forEachDescendant((node) => {
      if (!Node.isPropertyAccessExpression(node)) return false;
      const exprText = node.getExpression().getText();
      const name = node.getName();
      if (exprText === "NativeModules" && name) {
        const symName = findEnclosingSymbolName(node) ?? "unknown";
        // Avoid duplicates from nested traversal
        const exists = refs.some(
          (r) => r.moduleName === name && r.file === relPath && r.kind === "legacy",
        );
        if (!exists) {
          refs.push({
            symbolName: symName,
            file: relPath,
            moduleName: name,
            kind: "legacy",
          });
        }
      }
      return false;
    });
  }

  if (refs.length === 0) return graph;
  const existing = graph.rnNativeModuleRefs ?? [];
  return { ...graph, rnNativeModuleRefs: [...existing, ...refs] };
}

export function extractRNAPIs(graph: Graph, project: Project): Graph {
  const usages: RNAPIUsage[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = graph.root
      ? sourceFile.getFilePath().replace(graph.root, "").replace(/^[/\\]/, "")
      : sourceFile.getFilePath();

    let currentAPIs: string[] = [];
    let currentReanimated: string[] = [];
    let currentSymName = "";

    function flush() {
      if (currentSymName && (currentAPIs.length > 0 || currentReanimated.length > 0)) {
        usages.push({
          symbolName: currentSymName,
          file: relPath,
          apis: [...currentAPIs],
          reanimatedHooks: currentReanimated.length > 0 ? [...currentReanimated] : undefined,
        });
      }
      currentAPIs = [];
      currentReanimated = [];
    }

    sourceFile.forEachDescendant((node) => {
      // Track symbol boundaries to scope API usages
      if (
        Node.isFunctionDeclaration(node) ||
        Node.isMethodDeclaration(node) ||
        (Node.isVariableDeclaration(node) &&
          node.getInitializer() &&
          (Node.isArrowFunction(node.getInitializer()!) || Node.isFunctionExpression(node.getInitializer()!)))
      ) {
        flush();
        currentSymName =
          Node.isVariableDeclaration(node)
            ? node.getName()
            : (node as any).getName() ?? "";
      }

      // Detect Dimensions.get or useWindowDimensions
      if (Node.isCallExpression(node)) {
        const exprText = node.getExpression().getText();
        if (exprText === "Dimensions.get" || exprText === "useWindowDimensions") {
          currentAPIs.push("Dimensions");
        }
        if (exprText === "Linking.openURL" || exprText === "Linking.addEventListener" || exprText === "Linking.canOpenURL") {
          currentAPIs.push("Linking");
        }
        if (REANIMATED_HOOKS.has(exprText)) {
          currentReanimated.push(exprText);
        }
      }

      // Detect async storage usage
      if (Node.isPropertyAccessExpression(node)) {
        const exprText = node.getExpression().getText();
        const name = node.getName();
        if (exprText === "AsyncStorage" && (name === "getItem" || name === "setItem" || name === "removeItem" || name === "clear" || name === "getAllKeys")) {
          currentAPIs.push("AsyncStorage");
        }
      }

      return false;
    });

    flush();
  }

  if (usages.length === 0) return graph;
  const existing = graph.rnAPIUsages ?? [];
  return { ...graph, rnAPIUsages: [...existing, ...usages] };
}
