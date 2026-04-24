import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { discoverWorkspacePackages } from "./workspace.ts";

function createTempDir(prefix: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(filePath: string, data: unknown) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

describe("workspace discovery", () => {
  it("should discover the root package when '.' is in workspace patterns", async () => {
    const rootDir = createTempDir("nexiq-workspace-test-");
    
    writeJson(path.join(rootDir, "package.json"), {
      name: "root-package",
      version: "1.0.0",
    });
    
    fs.writeFileSync(
      path.join(rootDir, "pnpm-workspace.yaml"),
      "packages:\n  - '.'\n  - 'packages/*'\n"
    );

    writeJson(path.join(rootDir, "packages", "pkg-a", "package.json"), {
      name: "pkg-a",
      version: "1.0.0",
    });

    const packages = await discoverWorkspacePackages(rootDir);
    
    expect(packages).toHaveLength(2);
    
    const rootPkg = packages.find(p => p.name === "root-package");
    const subPkg = packages.find(p => p.name === "pkg-a");
    
    expect(rootPkg).toBeDefined();
    expect(rootPkg?.path).toBe(rootDir);
    
    expect(subPkg).toBeDefined();
    expect(subPkg?.path).toBe(path.join(rootDir, "packages", "pkg-a"));
  });

  it("should handle typical monorepo structure", async () => {
    const rootDir = createTempDir("nexiq-workspace-test-typical-");
    
    writeJson(path.join(rootDir, "package.json"), {
      name: "monorepo-root",
    });
    
    fs.writeFileSync(
      path.join(rootDir, "pnpm-workspace.yaml"),
      "packages:\n  - 'packages/*'\n"
    );

    writeJson(path.join(rootDir, "packages", "pkg-a", "package.json"), {
      name: "pkg-a",
    });

    const packages = await discoverWorkspacePackages(rootDir);
    
    expect(packages).toHaveLength(1);
    expect(packages[0]?.name).toBe("pkg-a");
  });
});
