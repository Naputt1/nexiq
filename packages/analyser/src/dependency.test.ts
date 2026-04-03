import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { getFiles, getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";

describe("dependency resolution", () => {
  it("should resolve dependencies to specific destructured identifiers", async () => {
    const projectPath = path.resolve(
      process.cwd(),
      "../sample-project/destructuring-hook",
    );
    const packageJson = new PackageJson(projectPath);
    const viteConfigPath = getViteConfig(projectPath);
    const files = getFiles(projectPath);

    const graph = await analyzeFiles(
      projectPath,
      viteConfigPath,
      files,
      packageJson,
    );

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
    const returnID = appVar.return;
    expect(returnID).toBeDefined();
    if (!returnID || typeof returnID !== "string") {
      throw new Error("App return should be JSX");
    }

    const returnVar = appVar.var[returnID];
    if (!returnVar) throw new Error("JSX variable not found");
    if (returnVar.type !== "jsx") throw new Error("JSX variable not found");

    const childRender = Object.values(returnVar.render?.children).find(
      (r) => r.tag === "Child",
    );
    expect(childRender).toBeDefined();
    if (!childRender) throw new Error("Child render not found");

    const dataDep = childRender.dependencies.find((d) => d.name === "data");
    expect(dataDep).toBeDefined();
    if (!dataDep || !dataDep.valueId)
      throw new Error("Data dependency or valueId not found");

    // valueId should point to the 'name' identifier in useQuery destructuring
    expect(dataDep.valueId).toBeDefined();

    // Find the 'name' identifier ID in useQuery
    const useQueryCall = Object.values(appVar.var).find(
      (v) =>
        v.kind === "hook" && v.type === "data" && v.call.name === "useQuery",
    );
    expect(useQueryCall).toBeDefined();
    if (!useQueryCall) throw new Error("useQuery call not found");

    // The ID should be the full nested ID (new behavior)
    expect(dataDep.valueId).toContain(useQueryCall.id);
    expect(dataDep.valueId).not.toBe(useQueryCall.id);
  });
});
