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

let _nextId = 0;
function nextId(): string {
  return `gen_${++_nextId}`;
}

export function makeStructField(overrides?: Partial<StructField>): StructField {
  return { name: "", type: "", ...overrides };
}

export function makeSymbolNode(overrides?: Partial<SymbolNode>): SymbolNode {
  return {
    id: nextId(),
    kind: "function",
    name: "",
    packageName: "",
    file: "",
    line: 0,
    endLine: 0,
    isExported: false,
    ...overrides,
  };
}

export function makePackageNode(overrides?: Partial<PackageNode>): PackageNode {
  return {
    id: nextId(),
    name: "",
    importPathBestEffort: "",
    dir: "",
    files: [],
    ...overrides,
  };
}

export function makeFileNode(overrides?: Partial<FileNode>): FileNode {
  return {
    id: nextId(),
    path: "",
    packageName: "",
    lines: 0,
    generated: false,
    ...overrides,
  };
}

export function makeCallEdge(overrides?: Partial<CallEdge>): CallEdge {
  return {
    callerSymbolId: "",
    callerName: "",
    calleeRaw: "",
    file: "",
    line: 0,
    ...overrides,
  };
}

export function makeImportEdge(overrides?: Partial<ImportEdge>): ImportEdge {
  return {
    fromFile: "",
    fromPackage: "",
    importPath: "",
    isDefault: false,
    ...overrides,
  };
}

export function makeDependency(overrides?: Partial<Dependency>): Dependency {
  return { module: "", version: "", ...overrides };
}

export function makeHTTPRoute(overrides?: Partial<HTTPRoute>): HTTPRoute {
  return { method: "", path: "", handler: "", file: "", line: 0, ...overrides };
}

export function makeEnvRead(overrides?: Partial<EnvRead>): EnvRead {
  return { key: "", accessor: "", file: "", line: 0, ...overrides };
}

export function makeConcurrencyNode(overrides?: Partial<ConcurrencyNode>): ConcurrencyNode {
  return {
    kind: "async_function",
    functionName: "",
    file: "",
    line: 0,
    ...overrides,
  };
}

export function makeTestEdge(overrides?: Partial<TestEdge>): TestEdge {
  return { testFunc: "", target: "", file: "", line: 0, ...overrides };
}

export function makeImplementsEdge(overrides?: Partial<ImplementsEdge>): ImplementsEdge {
  return { interface: "", concrete: "", ...overrides };
}

export function makeMutationEdge(overrides?: Partial<MutationEdge>): MutationEdge {
  return { field: "", functionName: "", file: "", line: 0, ...overrides };
}

export function makeErrorEdge(overrides?: Partial<ErrorEdge>): ErrorEdge {
  return { message: "", functionName: "", file: "", line: 0, ...overrides };
}

export function makeAppRouterNode(overrides?: Partial<AppRouterNode>): AppRouterNode {
  return {
    path: "",
    dir: "",
    files: {},
    children: [],
    ...overrides,
  };
}

export function makeGraph(overrides?: Partial<Graph>): Graph {
  return {
    version: GRAPH_VERSION,
    generatedAt: new Date().toISOString(),
    root: "",
    packages: [],
    files: [],
    symbols: [],
    imports: [],
    calls: [],
    envReads: [],
    dependencies: [],
    routes: [],
    concurrency: [],
    testEdges: [],
    implements: [],
    mutations: [],
    errors: [],
    ...overrides,
  };
}

const ARRAY_KEYS: (keyof Graph)[] = [
  "packages", "files", "symbols", "imports", "calls",
  "envReads", "dependencies", "routes", "concurrency",
  "testEdges", "implements", "mutations", "errors",
];

function isGraph(value: unknown): value is Graph {
  if (value === null || value === undefined) return false;
  if (typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  if (typeof obj.version !== "string") return false;
  if (typeof obj.generatedAt !== "string") return false;
  if (typeof obj.root !== "string") return false;
  for (const key of ARRAY_KEYS) {
    if (!Array.isArray(obj[key])) return false;
  }
  return true;
}

export function serialize(graph: Graph): string {
  if (graph.version !== GRAPH_VERSION) {
    throw new Error(
      `Graph version mismatch: expected ${GRAPH_VERSION}, got ${graph.version}`,
    );
  }
  return JSON.stringify(graph, null, 2);
}

export function deserialize(json: string): Graph {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`Invalid JSON: ${(e as Error).message}`);
  }
  if (!isGraph(parsed)) {
    throw new Error(
      "Invalid graph structure: missing or invalid required fields",
    );
  }
  if (parsed.version !== GRAPH_VERSION) {
    throw new Error(
      `Graph version mismatch: expected ${GRAPH_VERSION}, got ${parsed.version}`,
    );
  }
  return parsed;
}
