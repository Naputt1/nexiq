import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { PackageJson } from "./db/packageJson.ts";
import type { ComponentInfoRender } from "@nexiq/shared";
import path from "path";
import fs from "fs";
import os from "os";

describe("TSAsExpression (as) in JSX props", () => {
  it("should extract dependency ref (not literal) from `as Type` cast in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-tsas-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        interface Item { id: string; name: string; }

        export function App() {
          const items: Item[] = [{ id: "1", name: "Alice" }];

          return (
            <div data={items as Item[]}>
              {items.map((item) => (
                <span key={item.id}>{item.name}</span>
              ))}
            </div>
          );
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tsas-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();

      const appVar = Object.values(file!.var).find(
        (v) =>
          v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
      if (appVar?.kind !== "component")
        throw new Error("App should be a component");

      const returnID = appVar.return;
      expect(returnID).toBeDefined();
      if (!returnID || typeof returnID !== "string")
        throw new Error("App return should be JSX");

      const returnVar = appVar.var[returnID];
      if (!returnVar || returnVar.type !== "jsx")
        throw new Error("JSX variable not found");

      const rootRender: ComponentInfoRender | null = returnVar.render;
      expect(rootRender).toBeDefined();
      if (!rootRender) throw new Error("root render not found");

      expect(rootRender.tag).toBe("div");

      const dataDep = rootRender.dependencies.find((d) => d.name === "data");
      expect(dataDep).toBeDefined();
      if (!dataDep) throw new Error("data dependency not found");

      // Should be a ref to 'items', not a literal string
      expect(dataDep.value.type).toBe("ref");
      if (dataDep.value.type === "ref" && "name" in dataDep.value) {
        expect(dataDep.value.name).toBe("items");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("NewExpression in getExpressionData", () => {
  it("should not crash on new Date() in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-new-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        export function App() {
          const [count] = useState(0);
          return <div data={new Date()} count={count} />;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "new-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();

      const appVar = Object.values(file!.var).find(
        (v) =>
          v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
      if (appVar?.kind !== "component")
        throw new Error("App should be a component");

      const returnID = appVar.return;
      expect(returnID).toBeDefined();
      if (!returnID || typeof returnID !== "string")
        throw new Error("App return should be JSX");

      const returnVar = appVar.var[returnID];
      if (!returnVar || returnVar.type !== "jsx")
        throw new Error("JSX variable not found");

      const rootRender: ComponentInfoRender | null = returnVar.render;
      expect(rootRender).toBeDefined();
      if (!rootRender) throw new Error("root render not found");

      expect(rootRender.tag).toBe("div");

      // Should have both count and data dependencies
      const countDep = rootRender.dependencies.find((d) => d.name === "count");
      expect(countDep).toBeDefined();
      // count should be a ref
      expect(countDep!.value.type).toBe("ref");

      const dataDep = rootRender.dependencies.find((d) => d.name === "data");
      expect(dataDep).toBeDefined();
      // data should be a literal (stringified new Date())
      expect(dataDep!.value.type).toBe("literal-type");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("MemberExpression dependency in variable init", () => {
  it("should track dependency on object from member expression init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-member-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useContext } from "react";

        const config = { theme: "dark" };
        const alias = config.theme;

        export function App() {
          return <div>{alias}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "member-init-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();

      // Find the "alias" variable and check it has a dependency on "config"
      const aliasVar = Object.values(file!.var).find(
        (v) =>
          v.name.type === "identifier" && v.name.name === "alias",
      );
      expect(aliasVar).toBeDefined();
      if (!aliasVar) throw new Error("alias not found");

      // alias should have a dependency on config
      const depKeys = Object.keys(aliasVar.dependencies);
      expect(depKeys.length).toBeGreaterThan(0);

      const configDep = Object.values(aliasVar.dependencies).find(
        (d) => d.name === "config",
      );
      expect(configDep).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TSNonNullExpression (!) in JSX props", () => {
  it("should extract dependency ref (not literal) from non-null assertion in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-nonnull-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        interface User { name: string; }
        const user: User | null = { name: "Alice" };

        export function App() {
          return <div data={user!.name} />;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "nonnull-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();

      const appVar = Object.values(file!.var).find(
        (v) =>
          v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
      if (appVar?.kind !== "component")
        throw new Error("App should be a component");

      const returnID = appVar.return;
      expect(returnID).toBeDefined();
      if (!returnID || typeof returnID !== "string")
        throw new Error("App return should be JSX");

      const returnVar = appVar.var[returnID];
      if (!returnVar || returnVar.type !== "jsx")
        throw new Error("JSX variable not found");

      const rootRender: ComponentInfoRender | null = returnVar.render;
      expect(rootRender).toBeDefined();
      if (!rootRender) throw new Error("root render not found");

      expect(rootRender.tag).toBe("div");

      const dataDep = rootRender.dependencies.find((d) => d.name === "data");
      expect(dataDep).toBeDefined();
      if (!dataDep) throw new Error("data dependency not found");

      // Should be a ref to 'user', not a literal string
      expect(dataDep.value.type).toBe("ref");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("optional chaining (?.) in JSX props", () => {
  it("should extract dependency ref (not literal) from ?. chain in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-chain-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        export function App() {
          const [obj] = useState({ nested: { value: 42 } });
          return <div data={obj?.nested?.value} />;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "chain-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();

      const appVar = Object.values(file!.var).find(
        (v) =>
          v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
      if (appVar?.kind !== "component")
        throw new Error("App should be a component");

      const returnID = appVar.return;
      expect(returnID).toBeDefined();
      if (!returnID || typeof returnID !== "string")
        throw new Error("App return should be JSX");

      const returnVar = appVar.var[returnID];
      if (!returnVar || returnVar.type !== "jsx")
        throw new Error("JSX variable not found");

      // The root render on the JSX variable is the div
      const rootRender: ComponentInfoRender | null = returnVar.render;
      expect(rootRender).toBeDefined();
      if (!rootRender) throw new Error("root render not found");

      expect(rootRender.tag).toBe("div");

      const dataDep = rootRender.dependencies.find((d) => d.name === "data");
      expect(dataDep).toBeDefined();
      if (!dataDep) throw new Error("data dependency not found");

      // The dependency value should be a ref to 'obj', not a literal string
      expect(dataDep.value.type).toBe("ref");
      if (dataDep.value.type === "ref" && "name" in dataDep.value) {
        expect(dataDep.value.name).toBe("obj");
      }
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
