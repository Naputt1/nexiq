import fs from "node:fs";
import path from "node:path";
import fg from "fast-glob";
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
  if (workspacePatterns.length === 0) {
    return [];
  }

  const entries = await fg(
    workspacePatterns.map((pattern) =>
      pattern.endsWith("/") ? `${pattern}package.json` : `${pattern}/package.json`,
    ),
    {
      cwd: rootDir,
      ignore: ["**/node_modules/**"],
      absolute: true,
    },
  );

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
      // ignore invalid package.json files
    }
  }

  return packages;
}
