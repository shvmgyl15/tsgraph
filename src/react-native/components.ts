import { Project, Node } from "ts-morph";
import type { Graph, RNComponentNode, RNComponentKind } from "../graph/types.js";
import type { ScannedFile } from "../scanner/index.js";

const RN_COMPONENT_MAP: Record<string, RNComponentKind> = {
  View: "view",
  Text: "text",
  ScrollView: "scroll",
  FlatList: "flatlist",
  SectionList: "sectionlist",
  Image: "image",
  Pressable: "pressable",
  TouchableOpacity: "touchable",
  TouchableHighlight: "touchable",
  TouchableWithoutFeedback: "touchable",
  Modal: "modal",
  TextInput: "textinput",
  RefreshControl: "view",
  KeyboardAvoidingView: "view",
  SafeAreaView: "view",
  ActivityIndicator: "view",
};

function importsFromReactNative(project: Project): Set<string> {
  const imported = new Set<string>();
  for (const sf of project.getSourceFiles()) {
    for (const imp of sf.getImportDeclarations()) {
      if (imp.getModuleSpecifierValue() === "react-native") {
        for (const named of imp.getNamedImports()) {
          imported.add(named.getName());
        }
      }
    }
  }
  return imported;
}

function getTagName(node: Node): string | undefined {
  const children = node.getChildren();
  for (const child of children) {
    if (Node.isIdentifier(child)) {
      return child.getText();
    }
  }
  return undefined;
}

function getJsxAttributes(node: Node): Record<string, string> {
  const props: Record<string, string> = {};
  const children = node.getChildren();
  for (const child of children) {
    if (child.getKindName() === "JsxAttributes") {
      for (const attr of child.getChildren()) {
        if (Node.isJsxAttribute(attr)) {
          const nameNode = attr.getNameNode();
          const name = typeof nameNode === "string" ? nameNode : nameNode.getText();
          const initializer = attr.getInitializer();
          if (initializer) {
            props[name] = initializer.getText().slice(0, 120);
          } else {
            props[name] = "true";
          }
        }
      }
    }
  }
  return props;
}

export function extractRNComponents(
  graph: Graph,
  scanned: ScannedFile[],
): Graph {
  const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });

  const parsable = scanned.filter(
    (sf) => sf.kind === "tsx" || sf.kind === "jsx",
  );

  for (const sf of parsable) {
    try {
      project.addSourceFileAtPath(sf.path);
    } catch {
      // skip files that fail to parse
    }
  }

  const rnImports = importsFromReactNative(project);
  if (rnImports.size === 0) return graph;

  const components: RNComponentNode[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    const relPath = graph.root
      ? sourceFile.getFilePath().replace(graph.root, "").replace(/^[/\\]/, "")
      : sourceFile.getFilePath();

    sourceFile.forEachDescendant((node) => {
      if (!Node.isJsxSelfClosingElement(node) && !Node.isJsxOpeningElement(node)) {
        return false;
      }

      const tagName = getTagName(node);
      if (!tagName) return false;

      const kind = RN_COMPONENT_MAP[tagName];
      if (!kind) return false;
      if (!rnImports.has(tagName)) return false;

      const props = getJsxAttributes(node);

      components.push({
        name: tagName,
        kind,
        file: relPath,
        line: node.getStartLineNumber(),
        props: Object.keys(props).length > 0 ? props : undefined,
      });

      return false;
    });
  }

  return { ...graph, rnComponents: components.length > 0 ? components : undefined };
}
