import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFiles } from "../scanner/index.js";
import { makeGraph, makeFileNode } from "../graph/types.js";
import { extractExpoRouter } from "./navigation.js";
import { extractExpoConfig } from "./expoConfig.js";
import { extractRNComponents } from "./components.js";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "tsgraph-rn-test-"));
}

function writeFile(dir: string, relativePath: string, content: string) {
  const fullPath = path.join(dir, relativePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content, "utf-8");
}

describe("extractExpoRouter", () => {
  it("builds tree with app/ directory", () => {
    const dir = createTempDir();
    writeFile(dir, "app/index.tsx", "export default function Home() {}");
    writeFile(dir, "app/_layout.tsx", "export default function RootLayout() {}");
    writeFile(dir, "app/settings/index.tsx", "export default function Settings() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractExpoRouter(graph, files);

    expect(result.navigationTree).toBeTruthy();
    expect(result.navigationTree).toHaveLength(1);
    expect(result.navigationTree![0].routeName).toBe("index");
    expect(result.navigationTree![0].path).toBe("/");
    expect(result.navigationTree![0].componentFile).toMatch(/app\/index\.tsx$/);
    expect(result.navigationTree![0].children).toHaveLength(1);
    expect(result.navigationTree![0].children[0].routeName).toBe("settings");
    expect(result.navigationTree![0].children[0].path).toBe("/settings");

    fs.rmSync(dir, { recursive: true });
  });

  it("handles route groups (tabs)", () => {
    const dir = createTempDir();
    writeFile(dir, "app/_layout.tsx", "export default function Root() {}");
    writeFile(dir, "app/(tabs)/index.tsx", "export default function Home() {}");
    writeFile(dir, "app/(tabs)/profile.tsx", "export default function Profile() {}");
    writeFile(dir, "app/(auth)/login.tsx", "export default function Login() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractExpoRouter(graph, files);

    expect(result.navigationTree).toBeTruthy();
    expect(result.navigationTree![0].children).toHaveLength(2);

    const tabs = result.navigationTree![0].children.find((c) =>
      c.children && c.children.some((cc) => cc.routeName === "profile"),
    )!;
    expect(tabs).toBeTruthy();
    expect(tabs.type).toBe("expo-router");
    expect(tabs.path).toBe("/");
    expect(tabs.children).toHaveLength(2);
    expect(tabs.children.map((c) => c.routeName)).toContain("index");
    expect(tabs.children.map((c) => c.routeName)).toContain("profile");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns undefined when no app/ directory", () => {
    const dir = createTempDir();
    writeFile(dir, "src/index.ts", "const x = 1;");
    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractExpoRouter(graph, files);
    expect(result.navigationTree).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });

  it("handles dynamic route segments", () => {
    const dir = createTempDir();
    writeFile(dir, "app/_layout.tsx", "export default function Root() {}");
    writeFile(dir, "app/blog/[slug].tsx", "export default function Post() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractExpoRouter(graph, files);

    expect(result.navigationTree).toBeTruthy();
    expect(result.navigationTree![0].children).toHaveLength(1);
    const slug = result.navigationTree![0].children[0];
    expect(slug.routeName).toBe("blog/:slug");
    expect(slug.path).toBe("/blog/:slug");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractRNComponents", () => {
  it("detects RN components from react-native imports", () => {
    const dir = createTempDir();
    writeFile(dir, "screen.tsx", `
import { View, Text, FlatList, TouchableOpacity } from "react-native";
export default function MyScreen() {
  return (
    <View>
      <Text>Hello</Text>
      <FlatList data={[]} renderItem={() => null} />
      <TouchableOpacity onPress={() => {}} />
    </View>
  );
}`);
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76" } }));

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractRNComponents(graph, files);

    expect(result.rnComponents).toBeTruthy();
    expect(result.rnComponents!.length).toBeGreaterThanOrEqual(4);
    const kinds = result.rnComponents!.map((c) => c.kind);
    expect(kinds).toContain("view");
    expect(kinds).toContain("text");
    expect(kinds).toContain("flatlist");
    expect(kinds).toContain("touchable");

    fs.rmSync(dir, { recursive: true });
  });

  it("ignores non-RN components with same name", () => {
    const dir = createTempDir();
    writeFile(dir, "component.tsx", `
import { View } from "../local";
export default function MyComp() {
  return <View />;
}`);
    writeFile(dir, "package.json", JSON.stringify({ name: "test" }));

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, files: files.map((f) => makeFileNode({ path: f.relativePath })) });
    const result = extractRNComponents(graph, files);

    expect(result.rnComponents).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });

  it("returns undefined when no react-native imports", () => {
    const dir = createTempDir();
    writeFile(dir, "empty.tsx", "const x = 1;");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir });
    const result = extractRNComponents(graph, files);
    expect(result.rnComponents).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractExpoConfig", () => {
  it("parses app.json", () => {
    const dir = createTempDir();
    writeFile(dir, "app.json", JSON.stringify({
      expo: {
        scheme: "myapp",
        ios: { bundleIdentifier: "com.example.app" },
        android: { package: "com.example.app" },
        plugins: ["expo-router", ["expo-camera", { photos: true }]],
      },
    }));

    const graph = makeGraph({ root: dir });
    const result = extractExpoConfig(graph, dir);

    expect(result.expoConfig).toBeTruthy();
    expect(result.expoConfig!.scheme).toBe("myapp");
    expect(result.expoConfig!.bundleId).toBe("com.example.app");
    expect(result.expoConfig!.plugins).toContain("expo-router");
    expect(result.expoConfig!.plugins).toContain("expo-camera");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns undefined when no app.json", () => {
    const dir = createTempDir();
    const graph = makeGraph({ root: dir });
    const result = extractExpoConfig(graph, dir);
    expect(result.expoConfig).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });
});

describe("non-RN project short-circuit", () => {
  it("returns graph unmodified when no RN deps", async () => {
    const graph = makeGraph({ root: "/tmp" });
    const deps = { next: "^14" };
    const mod = await import("./index.js");
    const result = mod.extractReactNative(graph, "/tmp", [], deps);
    expect(result).toBe(graph);
  });
});
