import assert from "assert";
import fs from "fs";
import path from "path";

type PackageJsonData = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export class PackageJson {
  private data: PackageJsonData;
  private cache: Set<string>;

  constructor(dir: string) {
    this.cache = new Set();
    const configPath = path.join(dir, "package.json");
    if (fs.existsSync(configPath)) {
      try {
        const json = fs.readFileSync(configPath, "utf-8");
        this.data = JSON.parse(json);
        return;
      } catch (e) {
        console.error(e);
        assert(false, "package.json parse failed");
      }
    }

    this.data = {
      dependencies: {},
      devDependencies: {},
    };
  }

  public isDependency(name: string): boolean {
    if (this.cache.has(name)) {
      return true;
    }

    const nameParts = name.split("/");
    if (nameParts.length === 1) {
      return (
        (this.data.dependencies &&
          Object.prototype.hasOwnProperty.call(this.data.dependencies, name)) ||
        (this.data.devDependencies &&
          Object.prototype.hasOwnProperty.call(this.data.devDependencies, name))
      );
    }

    for (let i = 0; i < nameParts.length; i++) {
      const name = nameParts.slice(0, i + 1).join("/");

      if (
        (this.data.dependencies &&
          Object.prototype.hasOwnProperty.call(this.data.dependencies, name)) ||
        (this.data.devDependencies &&
          Object.prototype.hasOwnProperty.call(this.data.devDependencies, name))
      ) {
        this.cache.add(name);
        return true;
      }
    }

    return false;
  }
}
