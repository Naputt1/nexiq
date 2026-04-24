import fs from "node:fs";
import path from "node:path";

import yaml from "js-yaml";

export interface WorkspacePackageInfo {
  name: string;
  path: string;
  packageJsonPath: string;
  version?: string | undefined;
}

type PnpmWorkspace = {
  packages?: string[];
};

type WorkspacePackageJson = {
  name?: string;
  version?: string;
  workspaces?: string[] | { packages?: string[] };
};

export function getWorkspacePatterns(rootDir: string): string[] {
  const pnpmWorkspace = path.join(rootDir, "pnpm-workspace.yaml");
  const packageJsonPath = path.join(rootDir, "package.json");

  if (fs.existsSync(pnpmWorkspace)) {
    try {
      const doc = yaml.load(fs.readFileSync(pnpmWorkspace, "utf-8")) as
        | PnpmWorkspace
        | undefined;
      if (doc?.packages && Array.isArray(doc.packages)) {
        return doc.packages;
      }
    } catch (error) {
      console.error("Error reading pnpm-workspace.yaml", error);
    }
  }

  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(packageJsonPath, "utf-8"),
      ) as WorkspacePackageJson;
      if (Array.isArray(pkg.workspaces)) {
        return pkg.workspaces;
      }
      if (
        pkg.workspaces &&
        !Array.isArray(pkg.workspaces) &&
        Array.isArray(pkg.workspaces.packages)
      ) {
        return pkg.workspaces.packages;
      }
    } catch {
      // ignore invalid root package.json for workspace discovery
    }
  }

  return [];
}

export async function discoverWorkspacePackages(
  rootDir: string,
): Promise<WorkspacePackageInfo[]> {
  const workspacePatterns = getWorkspacePatterns(rootDir);

  const packageJsonFiles: string[] = [];

  // Always include the root package.json if it exists
  const rootPackageJson = path.join(rootDir, "package.json");
  if (fs.existsSync(rootPackageJson)) {
    packageJsonFiles.push(rootPackageJson);
  }

  function walk(dir: string, currentDepth: number) {
    if (currentDepth > 4) return;
    let files: string[];
    try {
      files = fs.readdirSync(dir);
    } catch {
      return;
    }

    for (const file of files) {
      if (file === "node_modules" || file.startsWith(".")) {
        continue;
      }
      const fullPath = path.join(dir, file);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath, currentDepth + 1);
      } else if (stat.isFile() && file === "package.json") {
        // Avoid adding root again if we already added it above
        if (fullPath !== rootPackageJson) {
          packageJsonFiles.push(fullPath);
        }
      }
    }
  }

  walk(rootDir, 0);

  const regexPatterns = workspacePatterns.map((pattern) => {
    let target = pattern;
    if (target === ".") {
      target = "package.json";
    } else {
      target = pattern.endsWith("/")
        ? `${pattern}package.json`
        : `${pattern}/package.json`;
    }

    const regexStr = target
      .replace(/\./g, "\\.")
      .replace(/\*\*/g, ".*")
      .replace(/\*/g, "[^/]+");
    return new RegExp(`^${regexStr}$`);
  });

  const entries = packageJsonFiles.filter((file) => {
    const posixFile = file.replace(/\\/g, "/");
    const rootPosix = rootDir.replace(/\\/g, "/");

    let relPath = posixFile;
    if (posixFile.startsWith(rootPosix)) {
      relPath = posixFile.slice(rootPosix.length);
      if (relPath.startsWith("/")) {
        relPath = relPath.slice(1);
      }
    }

    const matches = regexPatterns.some((rx) => rx.test(relPath));
    return matches;
  });

  const packages: WorkspacePackageInfo[] = [];
  for (const entry of entries) {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(entry, "utf-8"),
      ) as WorkspacePackageJson;
      const packageInfo: WorkspacePackageInfo = {
        name: pkg.name || path.basename(path.dirname(entry)),
        path: path.dirname(entry),
        packageJsonPath: entry,
      };
      if (pkg.version) {
        packageInfo.version = pkg.version;
      }
      packages.push(packageInfo);
    } catch {
      console.error(`Failed to parse package.json at ${entry}`);
    }
  }

  return packages;
}
