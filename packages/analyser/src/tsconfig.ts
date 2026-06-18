import fs from "fs";
import path from "path";
import { globSync } from "glob";

interface TsConfigJson {
  extends?: string | string[];
  compilerOptions?: {
    allowImportingTsExtensions?: boolean;
    [key: string]: unknown;
  };
  references?: { path: string }[];
}

export class TsConfigManager {
  // Normalized directory -> allowImportingTsExtensions
  private configMap = new Map<string, boolean>();

  constructor(rootDir: string) {
    this.discoverAll(rootDir);
  }

  /**
   * Returns whether `allowImportingTsExtensions` is enabled for the
   * closest tsconfig to the given file path.
   */
  getAllowImportingTsExtensions(filePath: string): boolean {
    const dirs = this.getAncestorDirs(filePath);
    for (const dir of dirs) {
      const val = this.configMap.get(dir);
      if (val !== undefined) return val;
    }
    return false;
  }

  /** Serialize for structured-clone transfer to workers. */
  toJSON(): Record<string, boolean> {
    return Object.fromEntries(this.configMap);
  }

  /** Reconstruct from a serialized map. */
  static fromJSON(map: Record<string, boolean>): TsConfigManager {
    const mgr = new TsConfigManager("");
    for (const [dir, val] of Object.entries(map)) {
      mgr.configMap.set(dir, val);
    }
    return mgr;
  }

  // ---------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------

  private discoverAll(rootDir: string) {
    if (!rootDir || !fs.existsSync(rootDir)) return;

    const files = globSync("**/tsconfig*.json", {
      cwd: rootDir,
      absolute: true,
      ignore: [
        "**/node_modules/**",
        "**/dist/**",
        "**/build/**",
        "**/.next/**",
        "**/out/**",
        "**/coverage/**",
        "**/public/**",
      ],
    });

    // Track which directories we've already resolved to handle
    // multiple tsconfig files in the same directory (e.g.
    // tsconfig.app.json + tsconfig.node.json).
    const seenDirs = new Set<string>();

    for (const file of files) {
      const dir = path.dirname(file);
      if (seenDirs.has(dir)) continue;

      const allow = this.resolveAllowImportingTsExtensions(file, rootDir, new Set());
      if (allow !== null) {
        this.configMap.set(dir, allow);
        seenDirs.add(dir);
      }
    }
  }

  private resolveAllowImportingTsExtensions(
    tsconfigPath: string,
    rootDir: string,
    visited: Set<string>,
  ): boolean | null {
    const absPath = path.resolve(tsconfigPath);
    if (visited.has(absPath)) return null;
    if (!fs.existsSync(absPath)) return null;
    visited.add(absPath);

    let config: TsConfigJson;
    try {
      const raw = fs.readFileSync(absPath, "utf-8");
      config = this.parseJson(raw);
    } catch {
      return null;
    }

    // Default value
    let allowTsExts = false;

    // Resolve extends chain: walk from parent (base) toward child (derived)
    if (config.extends) {
      const entries = Array.isArray(config.extends)
        ? config.extends
        : [config.extends];
      for (const ext of entries) {
        const extPath = this.resolveExtendsPath(ext, path.dirname(absPath), rootDir);
        if (extPath) {
          const inherited = this.resolveAllowImportingTsExtensions(
            extPath,
            rootDir,
            visited,
          );
          if (inherited !== null) {
            allowTsExts = inherited;
          }
        }
      }
    }

    // Child overrides parent
    if (config.compilerOptions?.allowImportingTsExtensions !== undefined) {
      allowTsExts = config.compilerOptions.allowImportingTsExtensions;
    }

    return allowTsExts;
  }

  private resolveExtendsPath(
    ext: string,
    configDir: string,
    rootDir: string,
  ): string | null {
    // 1. Try as relative path
    let candidate = path.resolve(configDir, ext);
    if (fs.existsSync(candidate)) {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        candidate = path.join(candidate, "tsconfig.json");
        if (fs.existsSync(candidate)) return candidate;
        return null;
      }
      if (stat.isFile()) return candidate;
    }

    // 2. Try appending tsconfig.json (path to directory without it)
    candidate = path.resolve(configDir, ext, "tsconfig.json");
    if (fs.existsSync(candidate)) return candidate;

    // 3. Try as a package name (e.g. @tsconfig/node20)
    try {
      const resolved = require.resolve(ext, { paths: [rootDir] });
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      // Not a resolvable package
    }

    return null;
  }

  private parseJson(raw: string): TsConfigJson {
    const cleaned = raw
      .replace(
        /("(?:\\.|[^\\"])*")|(\/\*[\s\S]*?\*\/|\/\/.*)/g,
        (match, string) => string || "",
      )
      .replace(/,\s*([}\]])/g, "$1");
    return JSON.parse(cleaned);
  }

  /**
   * Returns the ancestor directories of the given file path,
   * from most specific to least specific.
   */
  private getAncestorDirs(filePath: string): string[] {
    const dirs: string[] = [];
    let dir = path.dirname(filePath);
    while (true) {
      dirs.push(dir);
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return dirs;
  }
}
