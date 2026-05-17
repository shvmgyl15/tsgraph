import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFiles } from "../scanner/index.js";
import { parseProject } from "../parser/index.js";
import { extractAppRouter } from "./router.js";
import { extractPagesRouter } from "./pages.js";
import { classifyReactComponents } from "./react.js";
import { extractAPIRoutes } from "./routes.js";
import { makeGraph, makeFileNode } from "../graph/types.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-test-"));
}

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("extractAppRouter", () => {
  it("builds tree with page, layout, loading", () => {
    const dir = createTempDir();
    writeFile(dir, "app/page.tsx", "export default function Home() {}");
    writeFile(dir, "app/layout.tsx", "export default function RootLayout() {}");
    writeFile(dir, "app/loading.tsx", "export default function Loading() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractAppRouter(graph, files);

    expect(result.appRouter).toBeTruthy();
    expect(result.appRouter!.path).toBe("/");
    expect(result.appRouter!.files.page).toMatch(/app\/page\.tsx$/);
    expect(result.appRouter!.files.layout).toMatch(/app\/layout\.tsx$/);
    expect(result.appRouter!.files.loading).toMatch(/app\/loading\.tsx$/);
    expect(result.appRouter!.files.error).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });

  it("detects nested route segments", () => {
    const dir = createTempDir();
    writeFile(dir, "app/layout.tsx", "export default function Root() {}");
    writeFile(dir, "app/dashboard/page.tsx", "export default function Dashboard() {}");
    writeFile(dir, "app/dashboard/layout.tsx", "export default function DashLayout() {}");
    writeFile(dir, "app/dashboard/settings/page.tsx", "export default function Settings() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractAppRouter(graph, files);

    expect(result.appRouter).toBeTruthy();
    expect(result.appRouter!.children).toHaveLength(1);
    expect(result.appRouter!.children[0].path).toBe("/dashboard");
    expect(result.appRouter!.children[0].files.page).toMatch(/dashboard\/page\.tsx$/);
    expect(result.appRouter!.children[0].children).toHaveLength(1);
    expect(result.appRouter!.children[0].children[0].path).toBe("/dashboard/settings");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns undefined when no app directory", () => {
    const dir = createTempDir();
    writeFile(dir, "src/index.ts", "const x = 1;");
    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractAppRouter(graph, files);
    expect(result.appRouter).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractPagesRouter", () => {
  it("detects index and nested pages", () => {
    const dir = createTempDir();
    writeFile(dir, "pages/index.tsx", "export default function Home() {}");
    writeFile(dir, "pages/about.tsx", "export default function About() {}");
    writeFile(dir, "pages/blog/[slug].tsx", "export default function Post() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractPagesRouter(graph, files);

    expect(result.routes).toHaveLength(3);
    const paths = result.routes.map((r) => r.path).sort();
    expect(paths).toEqual(["/", "/about", "/blog/:slug"]);
    expect(result.routes[0].method).toBe("GET");

    fs.rmSync(dir, { recursive: true });
  });

  it("ignores non-page files", () => {
    const dir = createTempDir();
    writeFile(dir, "pages/api/users.ts", "export default function handler() {}");
    writeFile(dir, "pages/_app.tsx", "export default function App() {}");
    writeFile(dir, "pages/_document.tsx", "");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractPagesRouter(graph, files);

    const paths = result.routes.map((r) => r.path);
    expect(paths).toContain("/api/users");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("classifyReactComponents", () => {
  it("sets isClientComponent from 'use client' directive", () => {
    const dir = createTempDir();
    writeFile(dir, "component.tsx", `"use client";
export function Button() { return null; }`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);
    const button = graph.symbols.find((s) => s.name === "Button");
    expect(button).toBeTruthy();
    expect(button!.isClientComponent).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("sets isServerComponent from 'use server' directive", () => {
    const dir = createTempDir();
    writeFile(dir, "action.ts", `"use server";
export async function submit() { return null; }`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);
    const submit = graph.symbols.find((s) => s.name === "submit");
    expect(submit).toBeTruthy();
    expect(submit!.isServerComponent).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });

  it("detects hooks in tsx functions", () => {
    const dir = createTempDir();
    writeFile(dir, "counter.tsx", `
import { useState } from "react";
export function Counter() {
  const [count, setCount] = useState(0);
  return null;
}`);

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);
    const counter = graph.symbols.find((s) => s.name === "Counter");
    expect(counter).toBeTruthy();
    expect(counter!.isClientComponent).toBe(true);

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractAPIRoutes", () => {
  it("extracts HTTP methods from route.ts", () => {
    const dir = createTempDir();
    writeFile(dir, "app/api/users/route.ts", `
export async function GET() { return Response.json({}); }
export async function POST(req: Request) { return Response.json({}); }
`);

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractAPIRoutes(graph, files, dir);

    const routes = result.routes.sort((a, b) => a.method.localeCompare(b.method));
    expect(routes).toHaveLength(2);
    expect(routes[0].method).toBe("GET");
    expect(routes[0].path).toBe("/api/users");
    expect(routes[1].method).toBe("POST");
    expect(routes[1].path).toBe("/api/users");

    fs.rmSync(dir, { recursive: true });
  });

  it("handles dynamic route params", () => {
    const dir = createTempDir();
    writeFile(dir, "app/api/items/[id]/route.ts", `
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return Response.json({});
}
`);

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractAPIRoutes(graph, files, dir);

    expect(result.routes).toHaveLength(1);
    expect(result.routes[0].path).toBe("/api/items/:id");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("end-to-end: parseProject with Next.js", () => {
  it("produces appRouter and routes from a Next.js project", () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "my-app", dependencies: { "next": "^14" } }));
    writeFile(dir, "app/layout.tsx", "export default function Root({ children }: { children: React.ReactNode }) { return null; }");
    writeFile(dir, "app/page.tsx", `"use client";
import { useState } from "react";
export default function Home() {
  const [count, setCount] = useState(0);
  return null;
}`);
    writeFile(dir, "app/api/hello/route.ts", "export async function GET() { return Response.json({}); }");
    writeFile(dir, "pages/about.tsx", "export default function About() { return null; }");

    const { files } = scanFiles(dir);
    const graph = parseProject(dir, files);

    expect(graph.appRouter).toBeTruthy();
    expect(graph.appRouter!.files.layout).toBeTruthy();
    expect(graph.appRouter!.files.page).toBeTruthy();

    const home = graph.symbols.find((s) => s.name === "Home");
    expect(home).toBeTruthy();
    expect(home!.isClientComponent).toBe(true);

    const routePaths = graph.routes.map((r) => r.path);
    expect(routePaths).toContain("/api/hello");
    expect(routePaths).toContain("/about");

    fs.rmSync(dir, { recursive: true });
  });
});
