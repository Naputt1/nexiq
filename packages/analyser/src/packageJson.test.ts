import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { PackageJson } from "./db/packageJson.ts";
import fs from "fs";
import path from "path";
import os from "os";

describe("PackageJson Upward Search", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should find package.json in the root directory", () => {
    const pkgData = { name: "test-pkg", version: "1.0.0", dependencies: {}, devDependencies: {} };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkgData));

    const packageJson = new PackageJson(tmpDir);
    expect(packageJson.rawData.name).toBe("test-pkg");
    expect(packageJson.rawData.version).toBe("1.0.0");
  });

  it("should find package.json in a parent directory", () => {
    const pkgData = { name: "parent-pkg", version: "2.0.0", dependencies: {}, devDependencies: {} };
    fs.writeFileSync(path.join(tmpDir, "package.json"), JSON.stringify(pkgData));

    const subDir = path.join(tmpDir, "src", "nested");
    fs.mkdirSync(subDir, { recursive: true });

    const packageJson = new PackageJson(subDir);
    expect(packageJson.rawData.name).toBe("parent-pkg");
    expect(packageJson.rawData.version).toBe("2.0.0");
  });

  it("should return fallback data if no package.json is found anywhere up the tree", () => {
    const packageJson = new PackageJson(tmpDir);
    expect(packageJson.rawData.name).toBeUndefined();
    expect(packageJson.rawData.dependencies).toEqual({});
  });
});
