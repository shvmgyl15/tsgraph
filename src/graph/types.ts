export const GRAPH_VERSION = "1";

export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type_alias"
  | "enum"
  | "var"
  | "const";

export type ConcurrencyKind =
  | "promise_all"
  | "promise_settled"
  | "set_timeout"
  | "set_interval"
  | "abort_signal"
  | "async_function";

export interface StructField {
  name: string;
  type: string;
  tag?: string;
}

export interface SymbolNode {
  id: string;
  kind: SymbolKind;
  name: string;
  receiver?: string;
  packageName: string;
  file: string;
  line: number;
  endLine: number;
  doc?: string;
  signature?: string;
  methodSignature?: string;
  interfaceMethods?: Record<string, string>;
  structFields?: StructField[];
  embeddedTypes?: string[];
  arity?: number;
  isExported: boolean;
  isClientComponent?: boolean;
  isServerComponent?: boolean;
}

export interface PackageNode {
  id: string;
  name: string;
  importPathBestEffort: string;
  dir: string;
  files: string[];
}

export interface FileNode {
  id: string;
  path: string;
  packageName: string;
  lines: number;
  generated: boolean;
}

export interface CallEdge {
  callerSymbolId: string;
  callerName: string;
  calleeRaw: string;
  file: string;
  line: number;
}

export interface ImportEdge {
  fromFile: string;
  fromPackage: string;
  importPath: string;
  alias?: string;
  isDefault: boolean;
}

export interface Dependency {
  module: string;
  version: string;
}

export interface HTTPRoute {
  method: string;
  path: string;
  handler: string;
  file: string;
  line: number;
}

export interface EnvRead {
  key: string;
  accessor: string;
  file: string;
  line: number;
  functionName?: string;
}

export interface ConcurrencyNode {
  kind: ConcurrencyKind;
  functionName: string;
  file: string;
  line: number;
  detail?: string;
}

export interface TestEdge {
  testFunc: string;
  target: string;
  file: string;
  line: number;
}

export interface ImplementsEdge {
  interface: string;
  concrete: string;
}

export interface MutationEdge {
  field: string;
  functionName: string;
  file: string;
  line: number;
}

export interface ErrorEdge {
  message: string;
  functionName: string;
  file: string;
  line: number;
}

export interface AppRouterNode {
  path: string;
  dir: string;
  files: {
    page?: string;
    layout?: string;
    loading?: string;
    error?: string;
    notFound?: string;
    route?: string;
    template?: string;
    default?: string;
  };
  children: AppRouterNode[];
}

export interface Graph {
  version: string;
  generatedAt: string;
  root: string;
  packages: PackageNode[];
  files: FileNode[];
  symbols: SymbolNode[];
  imports: ImportEdge[];
  calls: CallEdge[];
  envReads: EnvRead[];
  dependencies: Dependency[];
  routes: HTTPRoute[];
  concurrency: ConcurrencyNode[];
  testEdges: TestEdge[];
  implements: ImplementsEdge[];
  mutations: MutationEdge[];
  errors: ErrorEdge[];
  appRouter?: AppRouterNode;
}
