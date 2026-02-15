import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import path from "path";

describe("dependency resolution", () => {
  it("should resolve dependencies to specific destructured identifiers", () => {
    const projectPath = path.resolve(
      process.cwd(),
      "../sample-project/destructuring-hook",
    );
    const packageJson = new PackageJson(projectPath);
    const viteConfigPath = getViteConfig(projectPath);
    const files = getFiles(projectPath);

    const graph = analyzeFiles(projectPath, viteConfigPath, files, packageJson);

    const appFile = graph.files["/src/App.tsx"];
    expect(appFile).toBeDefined();

    const appVar = Object.values(appFile!.var).find(
      (v) =>
        v.kind === "component" &&
        v.name.type === "identifier" &&
        v.name.name === "App",
    );
    expect(appVar).toBeDefined();
    if (appVar?.kind !== "component")
      throw new Error("App should be a component");

    // Check Child render dependency
    const childRender = Object.values(appVar.renders).find(
      (r) => r.id.includes("Child") || r.id === "1eb5061ae05ec5e0",
    );
    expect(childRender).toBeDefined();

    const dataDep = childRender!.dependencies.find((d) => d.name === "data");
    expect(dataDep).toBeDefined();
    // valueId should point to the 'name' identifier in useQuery destructuring
    expect(dataDep!.valueId).toBeDefined();

    // Find the 'name' identifier ID in useQuery
    const useQueryCall = Object.values(appVar.var).find(
      (v) =>
        v.kind === "hook" && v.type === "data" && v.call.name === "useQuery",
    );
    expect(useQueryCall).toBeDefined();

    // The ID should be the full nested ID (new behavior)
    expect(dataDep!.valueId).toContain(useQueryCall!.id);
    expect(dataDep!.valueId).not.toBe(useQueryCall!.id);
  });
});
