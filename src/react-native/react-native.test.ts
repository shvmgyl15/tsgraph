import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { scanFiles } from "../scanner/index.js";
import { makeGraph, makeFileNode } from "../graph/types.js";
import { extractExpoRouter } from "./navigation.js";
import { extractExpoConfig } from "./expoConfig.js";
import { extractRNComponents } from "./components.js";
import { extractPlatformSpecific } from "./platform.js";

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

describe("extractPlatformSpecific", () => {
  it("tags ios symbols with platform: ios", () => {
    const dir = createTempDir();
    writeFile(dir, "Button.ios.tsx", "export function Button() { return null; }");
    writeFile(dir, "Button.android.tsx", "export function Button() { return null; }");
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76" } }));

    const { files } = scanFiles(dir);
    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "Button", packageName: "test", file: "Button.ios.tsx", line: 1, endLine: 1, isExported: true },
        { id: "s2", kind: "function", name: "Button", packageName: "test", file: "Button.android.tsx", line: 1, endLine: 1, isExported: true },
      ],
    });
    const result = extractPlatformSpecific(graph, files);
    const iosSym = result.symbols.find((s) => s.file === "Button.ios.tsx");
    const androidSym = result.symbols.find((s) => s.file === "Button.android.tsx");
    expect(iosSym?.platform).toBe("ios");
    expect(androidSym?.platform).toBe("android");

    fs.rmSync(dir, { recursive: true });
  });

  it("adds platformVariants to base file", () => {
    const dir = createTempDir();
    writeFile(dir, "Button.tsx", "export function Button() { return null; }");
    writeFile(dir, "Button.ios.tsx", "export function Button() { return null; }");
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76" } }));

    const { files } = scanFiles(dir);
    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "Button", packageName: "test", file: "Button.tsx", line: 1, endLine: 1, isExported: true },
      ],
    });
    const result = extractPlatformSpecific(graph, files);
    const baseSym = result.symbols.find((s) => s.file === "Button.tsx");
    expect(baseSym?.platform).toBe("all");
    expect(baseSym?.platformVariants?.ios).toBe("Button.ios.tsx");

    fs.rmSync(dir, { recursive: true });
  });

  it("synthesizes base symbol when only variants exist", () => {
    const dir = createTempDir();
    writeFile(dir, "Card.ios.tsx", "export function Card() { return null; }");
    writeFile(dir, "Card.android.tsx", "export function Card() { return null; }");
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76" } }));

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, symbols: [] });
    const result = extractPlatformSpecific(graph, files);
    const baseSym = result.symbols.find((s) => s.synthetic === true);
    expect(baseSym).toBeTruthy();
    expect(baseSym?.platformVariants?.ios).toBe("Card.ios.tsx");
    expect(baseSym?.platformVariants?.android).toBe("Card.android.tsx");

    fs.rmSync(dir, { recursive: true });
  });

  it("ignores non-platform files", () => {
    const dir = createTempDir();
    writeFile(dir, "Styles.tsx", "export const styles = {};");

    const { files } = scanFiles(dir);
    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "const", name: "styles", packageName: "test", file: "Styles.tsx", line: 1, endLine: 1, isExported: true },
      ],
    });
    const result = extractPlatformSpecific(graph, files);
    const sym = result.symbols.find((s) => s.file === "Styles.tsx");
    expect(sym).toBeTruthy();
    expect(sym?.platformVariants).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractReactNavigation", () => {
  it("detects Stack navigator and extracts screens", async () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76", "@react-navigation/native": "^7", "@react-navigation/native-stack": "^7" } }));
    writeFile(dir, "App.tsx", `
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import HomeScreen from "./screens/Home";
import ProfileScreen from "./screens/Profile";

const Stack = createNativeStackNavigator();

export default function App() {
  return (
    <NavigationContainer>
      <Stack.Navigator>
        <Stack.Screen name="Home" component={HomeScreen} />
        <Stack.Screen name="Profile" component={ProfileScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}`);
    writeFile(dir, "screens/Home.tsx", "export default function HomeScreen() {}");
    writeFile(dir, "screens/Profile.tsx", "export default function ProfileScreen() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "HomeScreen", packageName: "test", file: "screens/Home.tsx", line: 1, endLine: 1, isExported: true },
        { id: "s2", kind: "function", name: "ProfileScreen", packageName: "test", file: "screens/Profile.tsx", line: 1, endLine: 1, isExported: true },
      ],
    });

    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "App.tsx"));
    project.addSourceFileAtPath(path.join(dir, "screens/Home.tsx"));
    project.addSourceFileAtPath(path.join(dir, "screens/Profile.tsx"));

    const mod = await import("./navigation.js");
    const result = mod.extractReactNavigation(graph, dir, files, project);

    expect(result.navigationTree).toBeTruthy();
    expect(result.navigationTree!.length).toBeGreaterThanOrEqual(1);
    const stack = result.navigationTree!.find((n) => n.type === "react-navigation");
    expect(stack).toBeTruthy();
    expect(stack!.children).toHaveLength(2);
    const routeNames = stack!.children.map((c) => c.routeName);
    expect(routeNames).toContain("Home");
    expect(routeNames).toContain("Profile");

    fs.rmSync(dir, { recursive: true });
  });

  it("resolves component prop from require()", async () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76", "@react-navigation/native": "^7" } }));
    writeFile(dir, "App.tsx", `
import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Stack = createNativeStackNavigator();
export default function App() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Settings" component={require("./screens/Settings").default} />
    </Stack.Navigator>
  );
}`);
    writeFile(dir, "screens/Settings.tsx", "export default function SettingsScreen() {}");

    const { files } = scanFiles(dir);
    const graph = makeGraph({ root: dir, symbols: [] });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "App.tsx"));

    const mod = await import("./navigation.js");
    const result = mod.extractReactNavigation(graph, dir, files, project);

    expect(result.navigationTree).toBeTruthy();
    const settings = result.navigationTree![0].children[0];
    expect(settings.routeName).toBe("Settings");
    expect(settings.componentFile).toBeTruthy();

    fs.rmSync(dir, { recursive: true });
  });

  it("handles inline arrow function component", async () => {
    const dir = createTempDir();
    writeFile(dir, "package.json", JSON.stringify({ name: "test", dependencies: { "react-native": "0.76" } }));
    writeFile(dir, "App.tsx", `
import { createNativeStackNavigator } from "@react-navigation/native-stack";
const Stack = createNativeStackNavigator();
function Detail() { return null; }
export default function App() {
  return (
    <Stack.Navigator>
      <Stack.Screen name="Detail" component={() => <Detail />} />
    </Stack.Navigator>
  );
}`);

    const { files } = scanFiles(dir);
    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "Detail", packageName: "test", file: "App.tsx", line: 3, endLine: 3, isExported: false },
      ],
    });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "App.tsx"));

    const mod = await import("./navigation.js");
    const result = mod.extractReactNavigation(graph, dir, files, project);

    expect(result.navigationTree).toBeTruthy();
    const detail = result.navigationTree![0].children[0];
    expect(detail.routeName).toBe("Detail");

    fs.rmSync(dir, { recursive: true });
  });

  it("returns undefined when no navigator factories found", async () => {
    const dir = createTempDir();
    writeFile(dir, "no-nav.tsx", "export const x = 1;");
    const graph = makeGraph({ root: dir });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "no-nav.tsx"));

    const mod = await import("./navigation.js");
    const result = mod.extractReactNavigation(graph, dir, [], project);
    expect(result.navigationTree).toBeUndefined();

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractRNStyleUsages", () => {
  it("counts StyleSheet.create calls per symbol", async () => {
    const dir = createTempDir();
    writeFile(dir, "styles.tsx", `
import { StyleSheet } from "react-native";
export function useStyles() {
  return StyleSheet.create({ container: { flex: 1 } });
}
export function useOtherStyles() {
  return StyleSheet.create({ wrapper: { padding: 8 } });
}`);

    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "useStyles", packageName: "test", file: "styles.tsx", line: 3, endLine: 5, isExported: true },
        { id: "s2", kind: "function", name: "useOtherStyles", packageName: "test", file: "styles.tsx", line: 6, endLine: 8, isExported: true },
      ],
    });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "styles.tsx"));

    const mod = await import("./apis.js");
    const result = mod.extractRNStyleUsages(graph, project);

    const s1 = result.symbols.find((s) => s.name === "useStyles");
    const s2 = result.symbols.find((s) => s.name === "useOtherStyles");
    expect(s1?.rnStyleSheets).toBe(1);
    expect(s2?.rnStyleSheets).toBe(1);

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractNativeModuleRefs", () => {
  it("detects NativeModules, TurboModuleRegistry, requireNativeComponent", async () => {
    const dir = createTempDir();
    writeFile(dir, "native.tsx", `
import { NativeModules, requireNativeComponent } from "react-native";
import { TurboModuleRegistry } from "react-native";
export function useCamera() {
  const Camera = NativeModules.CameraModule;
}
export function useFaceDetector() {
  const FaceDetector = TurboModuleRegistry.get("FaceDetector");
}
const MyNativeView = requireNativeComponent("MyNativeView");
`);

    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "useCamera", packageName: "test", file: "native.tsx", line: 4, endLine: 6, isExported: true },
        { id: "s2", kind: "function", name: "useFaceDetector", packageName: "test", file: "native.tsx", line: 7, endLine: 9, isExported: true },
      ],
    });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "native.tsx"));

    const mod = await import("./apis.js");
    const result = mod.extractNativeModuleRefs(graph, project);

    expect(result.rnNativeModuleRefs).toBeTruthy();
    const legacy = result.rnNativeModuleRefs!.find((r) => r.kind === "legacy");
    const turbo = result.rnNativeModuleRefs!.find((r) => r.kind === "turbo");
    const native = result.rnNativeModuleRefs!.find((r) => r.kind === "native-component");
    expect(legacy?.moduleName).toBe("CameraModule");
    expect(turbo?.moduleName).toBe("FaceDetector");
    expect(native?.moduleName).toBe("MyNativeView");

    fs.rmSync(dir, { recursive: true });
  });
});

describe("extractRNAPIs", () => {
  it("detects Dimensions, Linking, AsyncStorage, Reanimated hooks", async () => {
    const dir = createTempDir();
    writeFile(dir, "hooks.tsx", `
import { Dimensions, Linking } from "react-native";
export function useWindowInfo() {
  const { width } = Dimensions.get("window");
  return width;
}
export function handleDeepLink(url: string) {
  Linking.openURL(url);
}
export function useAnimation() {
  const progress = useSharedValue(0);
  const animatedStyle = useAnimatedStyle(() => ({}));
  return animatedStyle;
}
`);

    const graph = makeGraph({
      root: dir,
      symbols: [
        { id: "s1", kind: "function", name: "useWindowInfo", packageName: "test", file: "hooks.tsx", line: 3, endLine: 6, isExported: true },
        { id: "s2", kind: "function", name: "handleDeepLink", packageName: "test", file: "hooks.tsx", line: 7, endLine: 9, isExported: true },
        { id: "s3", kind: "function", name: "useAnimation", packageName: "test", file: "hooks.tsx", line: 10, endLine: 14, isExported: true },
      ],
    });
    const { Project } = await import("ts-morph");
    const project = new Project({ compilerOptions: { allowJs: true, noEmit: true } });
    project.addSourceFileAtPath(path.join(dir, "hooks.tsx"));

    const mod = await import("./apis.js");
    const result = mod.extractRNAPIs(graph, project);

    expect(result.rnAPIUsages).toBeTruthy();
    const dims = result.rnAPIUsages!.find((u) => u.apis.includes("Dimensions"));
    const linking = result.rnAPIUsages!.find((u) => u.apis.includes("Linking"));
    const reanimated = result.rnAPIUsages!.find((u) => u.reanimatedHooks && u.reanimatedHooks.length > 0);
    expect(dims?.symbolName).toBe("useWindowInfo");
    expect(linking?.symbolName).toBe("handleDeepLink");
    expect(reanimated?.symbolName).toBe("useAnimation");

    fs.rmSync(dir, { recursive: true });
  });
});
