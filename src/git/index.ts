import { execSync } from "node:child_process";

export interface ChangedFile {
  path: string;
  status: "added" | "modified" | "deleted" | "renamed";
}

export interface CommitInfo {
  hash: string;
  date: string;
  message: string;
  author: string;
}

export function isGitRepo(root: string): boolean {
  try {
    execSync("git rev-parse --git-dir", { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function getCurrentBranch(root: string): string {
  return execSync("git rev-parse --abbrev-ref HEAD", {
    cwd: root,
    encoding: "utf-8",
  }).trim();
}

export function getDiffFiles(root: string, base: string = "main"): ChangedFile[] {
  const output = execSync(`git diff --name-status ${base}...HEAD`, {
    cwd: root,
    encoding: "utf-8",
  }).trim();
  if (!output) return [];
  return output.split("\n").map((line) => {
    const parts = line.split(/\s+/);
    const status = parts[0];
    let fileStatus: ChangedFile["status"];
    let filePath = parts[1] ?? "";
    if (status === "A") fileStatus = "added";
    else if (status === "D") fileStatus = "deleted";
    else if (status === "R" || status.startsWith("R")) fileStatus = "renamed";
    else fileStatus = "modified";
    if (fileStatus === "renamed" && parts[2]) filePath = parts[2];
    return { path: filePath, status: fileStatus };
  });
}

export function getStaleFiles(root: string, thresholdDays: number = 90): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - thresholdDays);
  const cutoffStr = cutoff.toISOString().split("T")[0];
  try {
    const output = execSync(
      `git log --pretty=format: --name-only --diff-filter=AM --since=${cutoffStr}`,
      { cwd: root, encoding: "utf-8" },
    ).trim();
    const recentFiles = new Set(output.split("\n").filter(Boolean));
    const allFiles = execSync("git ls-files", {
      cwd: root,
      encoding: "utf-8",
    })
      .trim()
      .split("\n")
      .filter(Boolean);
    return allFiles.filter((f) => !recentFiles.has(f));
  } catch {
    return [];
  }
}

export function getCommitHistory(root: string, count: number = 10): CommitInfo[] {
  const output = execSync(
    `git log --max-count=${count} --format="%H|%ad|%s|%an" --date=short`,
    { cwd: root, encoding: "utf-8" },
  ).trim();
  if (!output) return [];
  return output.split("\n").map((line) => {
    const [hash, date, ...msgParts] = line.split("|");
    const message = msgParts.slice(0, -1).join("|");
    const author = msgParts[msgParts.length - 1] ?? "";
    return { hash, date, message, author };
  });
}
