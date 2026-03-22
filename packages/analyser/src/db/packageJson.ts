import assert from "assert";
import fs from "fs";
import path from "path";

export type PackageJsonData = {
  name: string;
  version: string;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export class PackageJson {
  private dataCache: Map<string, PackageJsonData | null>;
  private isDepCache: Map<string, Set<string>>;
  public rootDir: string;

  constructor(dir: string, initialData?: Record<string, unknown>) {
    this.rootDir = path.resolve(dir);
    this.dataCache = new Map();
    this.isDepCache = new Map();
    
    if (initialData) {
      this.dataCache.set(this.rootDir, initialData as PackageJsonData);
    } else {
      this.loadPackageJson(this.rootDir);
    }
  }

  public get rawData(): Record<string, unknown> {
    const rootData = this.dataCache.get(this.rootDir);
    // Provide a fallback so it doesn't break initialization when passing to worker
    return (rootData || { dependencies: {}, devDependencies: {} }) as unknown as Record<string, unknown>;
  }

  private loadPackageJson(dir: string): PackageJsonData | null {
    if (this.dataCache.has(dir)) {
      return this.dataCache.get(dir)!;
    }

    const configPath = path.join(dir, "package.json");
    if (fs.existsSync(configPath)) {
      try {
        const json = fs.readFileSync(configPath, "utf-8");
        const data = JSON.parse(json) as PackageJsonData;
        this.dataCache.set(dir, data);
        return data;
      } catch (e) {
        console.error("package.json parse failed for", configPath, e);
      }
    }

    this.dataCache.set(dir, null);
    return null;
  }

  public getPackageForFile(filePath: string): { dir: string; data: PackageJsonData } | null {
    let currentDir = filePath;
    // Check if path is a file, avoid issues with .ext
    if (!fs.existsSync(currentDir) || fs.statSync(currentDir).isFile()) {
      currentDir = path.dirname(currentDir);
    }

    while (currentDir.startsWith(this.rootDir) || currentDir === this.rootDir) {
      const data = this.loadPackageJson(currentDir);
      if (data) {
        return { dir: currentDir, data };
      }
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) break;
      currentDir = parentDir;
    }
    return null;
  }

  public getPackageIdForFile(filePath: string): string | null {
    const pkg = this.getPackageForFile(filePath);
    if (!pkg) return null;
    const { name, version } = pkg.data;
    if (name && version) return `${name}@${version}`;
    return pkg.dir; // fallback to path
  }

  public getAllLoadedPackages() {
    return Array.from(this.dataCache.entries())
      .filter(([_, data]) => data !== null) as [string, PackageJsonData][];
  }

  public isDependency(name: string, filePath?: string): boolean {
    const cacheKey = filePath ? `${filePath}:${name}` : `${this.rootDir}:${name}`;
    let isDepSet = this.isDepCache.get(cacheKey);
    if (!isDepSet) {
      isDepSet = new Set();
      this.isDepCache.set(cacheKey, isDepSet);
    }

    if (isDepSet.has(name)) {
      return true;
    }

    const pkg = filePath ? this.getPackageForFile(filePath) : this.getPackageForFile(this.rootDir);
    const data = pkg?.data || { dependencies: {}, devDependencies: {} };

    const nameParts = name.split("/");
    if (nameParts.length === 1) {
      if (
        (data.dependencies && typeof data.dependencies === 'object' && name in data.dependencies) ||
        (data.devDependencies && typeof data.devDependencies === 'object' && name in data.devDependencies)
      ) {
        isDepSet.add(name);
        return true;
      }
      return false;
    }

    for (let i = 0; i < nameParts.length; i++) {
      const n = nameParts.slice(0, i + 1).join("/");
      if (
        (data.dependencies && typeof data.dependencies === 'object' && n in data.dependencies) ||
        (data.devDependencies && typeof data.devDependencies === 'object' && n in data.devDependencies)
      ) {
        isDepSet.add(name);
        return true;
      }
    }

    return false;
  }
}
