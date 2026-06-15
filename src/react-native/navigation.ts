import path from "node:path";
import { Project, Node } from "ts-morph";
import type { Graph, NavigationNode } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const IGNORED_BASES = new Set(["_layout", "_app", "_error", "_not-found", "_loading"]);

function ignoredFile(fileName: string): boolean {
  const base = path.basename(fileName, path.extname(fileName));
  return IGNORED_BASES.has(base);
}

function isRouteGroup(segment: string): boolean {
  return segment.startsWith("(") && segment.endsWith(")");
}

function toParam(base: string): string {
  if (base.startsWith("[")) {
    const inner = base.slice(1, -1);
    return inner.startsWith("...") ? `*${inner.slice(3)}` : `:${inner}`;
  }
  return base;
}

function visibleSegments(dirs: string[], base: string): string[] {
  const segs = dirs.filter((d) => !isRouteGroup(d)).map((d) => toParam(d));
  if (base !== "index") segs.push(toParam(base));
  return segs;
}

interface RouteFile {
  file: string;
  dirs: string[];
  base: string;
}

function buildExpoRouterTree(files: ScannedFile[]): NavigationNode[] | undefined {
  const routes: RouteFile[] = [];

  for (const sf of files) {
    const rel = sf.relativePath;
    if (!rel.startsWith("app/") && !rel.startsWith("app\\")) continue;
    const afterApp = rel.replace(/^app[/\\]/, "");
    const fileName = path.basename(afterApp);
    if (ignoredFile(fileName)) continue;

    const dir = path.dirname(afterApp);
    const dirs = dir === "." ? [] : dir.split("/");
    const base = path.basename(fileName, path.extname(fileName));
    routes.push({ file: rel, dirs, base });
  }

  if (routes.length === 0) return undefined;

  // Build a path trie from the route files.
  interface TrieNode {
    name: string;
    children: Map<string, TrieNode>;
    file?: string;
  }

  const root: TrieNode = { name: "", children: new Map() };

  for (const r of routes) {
    let node = root;
    for (const d of r.dirs) {
      if (!node.children.has(d)) {
        node.children.set(d, { name: d, children: new Map() });
      }
      node = node.children.get(d)!;
    }
    if (!node.children.has(r.base)) {
      node.children.set(r.base, { name: r.base, children: new Map() });
    }
    node.children.get(r.base)!.file = r.file;
  }

  // Check if a trie node represents a dir with an index file (has a "page")
  function hasPage(node: TrieNode): boolean {
    const idx = node.children.get("index");
    return !!(idx && idx.file);
  }

  function trieToNav(
    trieNode: TrieNode,
    parentDirs: string[],
  ): NavigationNode | undefined {
    const isGroup = parentDirs.length > 0 && isRouteGroup(parentDirs[parentDirs.length - 1]);

    const segs = visibleSegments(parentDirs, "index");
    const node: NavigationNode = {
      type: "expo-router",
      routeName: segs.join("/") || "index",
      path: "/" + segs.join("/"),
      children: [],
    };

    // Set componentFile from index route if present
    const indexChild = trieNode.children.get("index");
    if (indexChild && indexChild.file) {
      node.componentFile = indexChild.file;
    }

    // For route groups: index file is also a child screen
    if (isGroup && indexChild && indexChild.file) {
      const ik = visibleSegments(parentDirs, "index");
      node.children!.push({
        type: "expo-router",
        routeName: ik.join("/") || "index",
        path: "/" + ik.join("/"),
        componentFile: indexChild.file,
        children: [],
      });
    }

    // Categorize children
    const groupChildren: [string, TrieNode][] = [];
    const dirChildren: [string, TrieNode][] = [];
    const leafChildren: [string, TrieNode][] = [];

    for (const [name, child] of trieNode.children) {
      if (name === "index") continue;

      if (isRouteGroup(name)) {
        groupChildren.push([name, child]);
      } else if (child.children.size > 0) {
        dirChildren.push([name, child]);
      } else {
        leafChildren.push([name, child]);
      }
    }

    // Route groups
    for (const [name, child] of groupChildren) {
      const childDirs = [...parentDirs, name];
      const groupNode = trieToNav(child, childDirs);
      if (groupNode) {
        node.children!.push(groupNode);
      }
    }

    // Regular directories: only create a child node if they have an index page
    // Otherwise, flatten their leaf children into this level
    for (const [name, child] of dirChildren) {
      const childDirs = [...parentDirs, name];

      if (hasPage(child)) {
        const childNode = trieToNav(child, childDirs);
        if (childNode) {
          node.children!.push(childNode);
        }
      } else {
        // No index page: flatten leaf children to this level
        // We need to recursively collect all leaf files
        function collectFlattened(tn: TrieNode, dirPrefix: string[]): NavigationNode[] {
          const result: NavigationNode[] = [];
          for (const [cn, cv] of tn.children) {
            if (cn === "index") continue;
            if (isRouteGroup(cn)) continue;
            if (cv.children.size > 0) {
              result.push(...collectFlattened(cv, [...dirPrefix, cn]));
            } else {
              const segs = visibleSegments([...dirPrefix], cn);
              result.push({
                type: "expo-router",
                routeName: segs.join("/") || cn,
                path: "/" + segs.join("/"),
                componentFile: cv.file,
                children: [],
              });
            }
          }
          return result;
        }

        const flatChildren = collectFlattened(child, [...parentDirs, name]);
        for (const fc of flatChildren) {
          node.children!.push(fc);
        }
      }
    }

    // File leaves
    for (const [name, child] of leafChildren) {
      const segs = visibleSegments(parentDirs, name);
      node.children!.push({
        type: "expo-router",
        routeName: segs.join("/") || name,
        path: "/" + segs.join("/"),
        componentFile: child.file,
        children: [],
      });
    }

    return node;
  }

  const treeRoot = trieToNav(root, []);
  return treeRoot ? [treeRoot] : undefined;
}

export function extractExpoRouter(
  graph: Graph,
  scanned: ScannedFile[],
): Graph {
  const tree = buildExpoRouterTree(scanned);
  if (!tree) return graph;
  return { ...graph, navigationTree: tree };
}

// React Navigation
const NAVIGATOR_FACTORIES = new Set([
  "createNativeStackNavigator",
  "createBottomTabNavigator",
  "createDrawerNavigator",
  "createMaterialTopTabNavigator",
]);

interface NavigatorBinding {
  tag: string;        // e.g. "Stack", "Tab"
  factory: string;    // e.g. "createNativeStackNavigator"
  file: string;
}

function detectNavigators(project: Project): NavigatorBinding[] {
  const bindings: NavigatorBinding[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    for (const vs of sourceFile.getVariableStatements()) {
      for (const decl of vs.getDeclarations()) {
        const initializer = decl.getInitializer();
        if (!initializer) continue;

        if (Node.isCallExpression(initializer)) {
          const exprText = initializer.getExpression().getText();
          if (NAVIGATOR_FACTORIES.has(exprText)) {
            const name = decl.getName();
            if (name) {
              bindings.push({
                tag: name,
                factory: exprText,
                file: path.relative(project.getRootDirectories()[0]?.getPath() ?? "", sourceFile.getFilePath()),
              });
            }
          }
        }
      }
    }
  }

  return bindings;
}

interface ScreenInfo {
  routeName: string;
  componentRef?: string;
  componentFile?: string;
  componentResolution?: "resolved" | "inline-unresolved";
  options?: Record<string, unknown>;
  file: string;
  line: number;
}

function getJSXTagName(node: Node): string | undefined {
  const children = node.getChildren();
  // Tag name is typically the second child (after LessThanToken)
  for (const child of children) {
    const kn = child.getKindName();
    if (kn === "Identifier" || kn === "PropertyAccessExpression") {
      return child.getText();
    }
  }
  return undefined;
}

function extractScreens(
  tag: string,
  project: Project,
  graph: Graph,
  rootDir: string,
): ScreenInfo[] {
  const screens: ScreenInfo[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) return false;

      const tagNameFull = getJSXTagName(node);
      if (!tagNameFull) return false;
      if (tagNameFull !== `${tag}.Screen`) return false;

      let routeName = "";
      let componentRef: string | undefined;
      let options: Record<string, unknown> | undefined;

      for (const attr of node.getAttributes()) {
        if (!Node.isJsxAttribute(attr)) continue;
        const nameNode = attr.getNameNode();
        const attrName = typeof nameNode === "string" ? nameNode : nameNode.getText();
        const initializer = attr.getInitializer();

        if (attrName === "name" && initializer && Node.isStringLiteral(initializer)) {
          routeName = initializer.getLiteralValue();
        }

        if (attrName === "component" && initializer) {
          // Unwrap JsxExpression { ... }
          const resolvedInit = Node.isJsxExpression(initializer)
            ? initializer.getExpression()
            : initializer;
          if (!resolvedInit) continue;

          if (Node.isIdentifier(resolvedInit)) {
            componentRef = resolvedInit.getText();
          } else if (Node.isCallExpression(resolvedInit)) {
            const expr = resolvedInit.getExpression();
            if (Node.isIdentifier(expr) && expr.getText() === "require") {
              const args = resolvedInit.getArguments();
              if (args.length >= 1 && Node.isStringLiteral(args[0])) {
                const reqPath = args[0].getLiteralValue();
                const resolved = path.resolve(path.dirname(sourceFile.getFilePath()), reqPath);
                const relPath = path.relative(rootDir, resolved);
                const fileExt = path.extname(relPath);
                const basePath = fileExt ? relPath.slice(0, -fileExt.length) : relPath;
                componentRef = basePath;
              }
            }
          } else if (Node.isPropertyAccessExpression(resolvedInit)) {
            // require('./path').default
            const innerExpr = resolvedInit.getExpression();
            if (Node.isCallExpression(innerExpr)) {
              const callExpr = innerExpr.getExpression();
              if (Node.isIdentifier(callExpr) && callExpr.getText() === "require") {
                const args = innerExpr.getArguments();
                if (args.length >= 1 && Node.isStringLiteral(args[0])) {
                  const reqPath = args[0].getLiteralValue();
                  const resolved = path.resolve(path.dirname(sourceFile.getFilePath()), reqPath);
                  const relPath = path.relative(rootDir, resolved);
                  const fileExt = path.extname(relPath);
                  const basePath = fileExt ? relPath.slice(0, -fileExt.length) : relPath;
                  componentRef = basePath;
                }
              }
            }
          } else if (Node.isArrowFunction(resolvedInit)) {
            // Shallow: grab first JSX element name from the body
            const body = resolvedInit.getBody();
            if (body) {
              body.forEachDescendant((child) => {
                if (Node.isJsxSelfClosingElement(child) || Node.isJsxOpeningElement(child)) {
                  componentRef = getJSXTagName(child);
                  return true;
                }
                return false;
              });
            }
          }
        }

        if (attrName === "options" && initializer) {
          try {
            options = JSON.parse(initializer.getText());
          } catch {
            options = { raw: initializer.getText().slice(0, 200) };
          }
        }
      }

      if (routeName) {
        const relPath = path.relative(rootDir, sourceFile.getFilePath());
        let componentFile: string | undefined;

        if (componentRef) {
          if (componentRef.includes("/") || componentRef.includes("\\")) {
            componentFile = componentRef;
          } else {
            const sym = graph.symbols.find((s) => s.name === componentRef);
            if (sym) componentFile = sym.file;
          }
        }

        screens.push({
          routeName,
          componentRef,
          componentFile,
          componentResolution: componentRef && !componentFile ? "inline-unresolved" : "resolved",
          options,
          file: relPath,
          line: node.getStartLineNumber(),
        });
      }

      return false;
    });
  }

  return screens;
}

function buildReactNavigationTree(
  project: Project,
  graph: Graph,
  scanned: ScannedFile[],
  rootDir: string,
): NavigationNode[] | undefined {
  const navs = detectNavigators(project);
  if (navs.length === 0) return undefined;

  // Detect NavigationContainer wrapper
  let hasContainer = false;
  for (const sourceFile of project.getSourceFiles()) {
    sourceFile.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) return false;
      const tagName = getJSXTagName(node);
      if (tagName === "NavigationContainer") {
        hasContainer = true;
        return true;
      }
      return false;
    });
  }

  const nodes: NavigationNode[] = [];

  for (const nav of navs) {
    const screens = extractScreens(nav.tag, project, graph, rootDir);
    if (screens.length === 0) continue;

    const childNodes: NavigationNode[] = screens.map((s) => ({
      type: "react-navigation",
      routeName: s.routeName,
      componentFile: s.componentFile,
      componentResolution: s.componentResolution,
      options: s.options,
      children: [],
    }));

    nodes.push({
      type: "react-navigation",
      routeName: nav.tag.toLowerCase(),
      children: childNodes,
    });
  }

  return nodes.length > 0 ? nodes : undefined;
}

export function extractReactNavigation(
  graph: Graph,
  rootDir: string,
  scanned: ScannedFile[],
  project?: Project,
): Graph {
  if (!project) return graph;
  const tree = buildReactNavigationTree(project, graph, scanned, rootDir);
  if (!tree) return graph;

  const existing = graph.navigationTree ?? [];
  return { ...graph, navigationTree: [...existing, ...tree] };
}

function flattenNavigationTree(
  nodes: NavigationNode[],
  parentPath: string = "",
): Array<{ path: string; handler: string; file: string }> {
  const result: Array<{ path: string; handler: string; file: string }> = [];
  for (const node of nodes) {
    const routePath = parentPath ? `${parentPath}/${node.routeName}` : node.routeName;
    const componentFile = node.componentFile ?? "";
    if (componentFile) {
      result.push({ path: routePath, handler: node.routeName, file: componentFile });
    }
    if (node.children && node.children.length > 0) {
      result.push(...flattenNavigationTree(node.children, routePath));
    }
  }
  return result;
}

export function convertNavigationToRoutes(graph: Graph): Graph {
  if (!graph.navigationTree || graph.navigationTree.length === 0) return graph;

  const flat = flattenNavigationTree(graph.navigationTree);
  const newRoutes = flat.map((r) => ({
    method: "SCREEN",
    path: `/${r.path}`,
    handler: r.handler,
    file: r.file,
    line: 0,
    source: "mobile" as const,
  }));

  return { ...graph, routes: [...graph.routes, ...newRoutes] };
}
