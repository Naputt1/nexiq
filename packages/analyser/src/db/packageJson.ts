import assert from "assert";
import fs from "fs";
import path from "path";

type PackageJsonData = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export class PackageJson {
  private data: PackageJsonData;

  constructor(dir: string) {
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
    if (Object.prototype.hasOwnProperty.call(this.data.dependencies, name)) {
      return true;
    }
    return Object.prototype.hasOwnProperty.call(
      this.data.devDependencies,
      name
    );
  }
}
