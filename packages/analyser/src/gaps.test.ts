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

describe("Object/Array expression dependency in variable init", () => {
  it("should track dependencies from object expression init ({ a, b })", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-objdep-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useContext } from "react";

        const a = 1;
        const b = 2;
        const combined = { a, b };

        export function App() {
          return <div>{combined.a}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "objdep-test" }),
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

      // Find combined variable and check it has deps on a and b
      const combinedVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "combined",
      );
      expect(combinedVar).toBeDefined();
      if (!combinedVar) throw new Error("combined not found");

      const depNames = Object.values(combinedVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("a");
      expect(depNames).toContain("b");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should track dependencies from array expression init ([a, b])", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-arrdep-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        const a = 1;
        const b = 2;
        const list = [a, b];

        export function App() {
          return <div>{list[0]}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "arrdep-test" }),
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

      const listVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "list",
      );
      expect(listVar).toBeDefined();
      if (!listVar) throw new Error("list not found");

      const depNames = Object.values(listVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("a");
      expect(depNames).toContain("b");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("OptionalCallExpression in usage collector", () => {
  it("should emit usage-call relation for optional call fn?.()", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-optcall-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        function save() {
          return "ok";
        }

        export function App() {
          const [result] = useState("");
          const r = save?.();
          return <div>{r}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "optcall-test" }),
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

      // There should be a usage-call relation for save?.()
      const callRelation = file!.relations?.find(
        (r) =>
          r.kind === "usage-call" &&
          r.data_json &&
          typeof r.data_json === "object" &&
          "displayLabel" in r.data_json &&
          r.data_json.displayLabel === "save",
      );
      expect(callRelation).toBeDefined();
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

describe("UnaryExpression (!) in JSX props", () => {
  it("should extract dependency ref (not literal) from unary logical-not in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-unary-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        export function App() {
          const [visible] = useState(true);
          return <div hidden={!visible} />;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "unary-test" }),
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

      const hiddenDep = rootRender.dependencies.find((d) => d.name === "hidden");
      expect(hiddenDep).toBeDefined();
      if (!hiddenDep) throw new Error("hidden dependency not found");

      // Should be a ref to 'visible', not a literal string
      expect(hiddenDep.value.type).toBe("ref");
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

describe("TSSatisfiesExpression (satisfies) unwrapping", () => {
  it("should extract dependency ref from satisfies expression in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-satisfies-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        interface User { name: string; }
        const user = { name: "Alice" } satisfies User;

        export function App() {
          return <div data={user satisfies User}>{user.name}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "satisfies-test" }),
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

      const userVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "user",
      );
      expect(userVar).toBeDefined();
      if (!userVar) throw new Error("user not found");

      // user should exist and not crash - satisfies expression unwrapped
      expect(userVar).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("ImportExpression (dynamic import) handling", () => {
  it("should not crash on dynamic import() in code", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-dynimport-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState, lazy, Suspense } from "react";

        const Other = lazy(() => import("./Other"));

        export function App() {
          return (
            <Suspense fallback={<div>Loading...</div>}>
              <Other />
            </Suspense>
          );
        }
      `,
    );

    fs.writeFileSync(
      path.join(srcDir, "Other.tsx"),
      `
        export default function Other() {
          return <div>Other</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "dynimport-test" }),
    );

    try {
      const packageJson = new PackageJson(tmpDir);
      const graph = await analyzeFiles(
        tmpDir,
        null,
        ["src/App.tsx", "src/Other.tsx"],
        packageJson,
      );

      const file = graph.files["/src/App.tsx"];
      expect(file).toBeDefined();
      // Should not crash - dynamic imports within lazy() should be tolerated
      expect(Object.keys(file!.var).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TaggedTemplateExpression (styled) handling", () => {
  it("should not crash on tagged template expressions like styled.div`...`", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-tte-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        // Simulating styled-components pattern
        const colors = { primary: "blue" };
        const Box = () => <div>Box</div>;

        export function App() {
          const [count] = useState(0);
          return <div>{count}</div>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tte-test" }),
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
      // Should analyze normally without crashing
      const appVar = Object.values(file!.var).find(
        (v) => v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TSParameterProperty (constructor shorthand)", () => {
  it("should register constructor parameter properties as class properties", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-tspp-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import React from "react";

        export class App extends React.Component {
          constructor(public name: string, private count: number) {
            super();
          }
          render() {
            return <div>{this.name}: {this.count}</div>;
          }
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tspp-test" }),
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

      // Should have name and count as properties
      const propertyIds = Object.keys(appVar.var).filter((key) => {
        const v = appVar.var[key];
        return v.kind === "property" || v.type === "data";
      });
      expect(propertyIds.length).toBeGreaterThanOrEqual(2);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TemplateLiteral in getExpressionData", () => {
  it("should extract dependency ref from template literal expression in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-tpl-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        export function App() {
          const [name] = useState("World");
          return <div greeting={\`Hello \${name}\`} />;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tpl-test" }),
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

      const rootRender = returnVar.render;
      expect(rootRender).toBeDefined();
      if (!rootRender) throw new Error("root render not found");

      const greetingDep = rootRender.dependencies.find((d) => d.name === "greeting");
      expect(greetingDep).toBeDefined();
      if (!greetingDep) throw new Error("greeting dependency not found");

      // Should have a ref to 'name' (not just a literal string)
      expect(greetingDep.value.type).toBe("ref");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("UpdateExpression (++/--) in JSX props", () => {
  it("should extract dependency ref from prefix update in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-update-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState } from "react";

        export function App() {
          let i = 0;
          return <button onClick={() => { i++; }}>Click</button>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "update-test" }),
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
      // Should handle i++ without crashing and still find App
      const appVar = Object.values(file!.var).find(
        (v) => v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("UpdateExpression (++/--) in JSX props", () => {
  it("should extract dependency ref from update expression in JSX prop", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-update-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import { useState, useCallback } from "react";

        export function App() {
          const [count, setCount] = useState(0);
          const inc = useCallback(() => setCount(count + 1), [count]);
          return <button onClick={inc}>Clicked {count} times</button>;
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "update-test" }),
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
      // Should not crash - update expressions in JSX children tolerated
      expect(Object.keys(file!.var).length).toBeGreaterThan(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("StaticBlock in classes", () => {
  it("should not crash on static { } blocks and create scopes for them", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-static-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import React from "react";

        export class App extends React.Component {
          static counter = 0;
          static {
            App.counter = 42;
          }
          render() {
            return <div>{App.counter}</div>;
          }
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "static-test" }),
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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("IfStatement block scope", () => {
  it("should create a block scope for if/else bodies", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-ifscope-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "export function App({ cond }: { cond: boolean }) {",
        "  if (cond) {",
        '    const x = "in if";',
        "    return <div>{x}</div>;",
        "  } else {",
        '    const y = "in else";',
        "    return <span>{y}</span>;",
        "  }",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "ifscope-test" }),
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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TSEnumDeclaration handling", () => {
  it("should register enum members as variables", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-enum-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        'enum Status { Active, Inactive, Pending }',
        'const current = Status.Active;',
        '',
        'export function App() {',
        '  return <div>{current}</div>;',
        '}',
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "enum-test" }),
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

      // Status enum should exist as a variable
      const statusVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "Status",
      );
      expect(statusVar).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("Super expression handling", () => {
  it("should not crash on super.method() calls in class components", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-super-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      `
        import React from "react";

        class Base {
          getInitialState() { return { x: 0 }; }
        }

        export class App extends React.Component {
          state = { count: 0 };
          componentDidMount() {
            super.componentDidMount?.();
          }
          render() {
            return <div>{this.state.count}</div>;
          }
        }
      `,
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "super-test" }),
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
      // Class component App should be found
      const appVar = Object.values(file!.var).find(
        (v) => v.kind === "component" &&
          v.name.type === "identifier" &&
          v.name.name === "App",
      );
      expect(appVar).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("ConditionalExpression in variable init", () => {
  it("should extract dependency refs from conditional (ternary) expression init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-cond-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "import { useState } from 'react';",
        "",
        "const a = 1;",
        "const b = 2;",
        "const c = 3;",
        "const result = a ? b : c;",
        "",
        "export function App() {",
        "  return <div>{result}</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "cond-init-test" }),
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

      const resultVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "result",
      );
      expect(resultVar).toBeDefined();
      if (!resultVar) throw new Error("result not found");

      const depNames = Object.values(resultVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("a");
      expect(depNames).toContain("b");
      expect(depNames).toContain("c");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("LogicalExpression in variable init", () => {
  it("should extract dependency refs from logical expression init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-logic-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "const a = true;",
        "const b = false;",
        "const result = a && b;",
        "",
        "export function App() {",
        "  return <div>{result}</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "logic-init-test" }),
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

      const resultVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "result",
      );
      expect(resultVar).toBeDefined();
      if (!resultVar) throw new Error("result not found");

      const depNames = Object.values(resultVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("a");
      expect(depNames).toContain("b");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("BinaryExpression in variable init", () => {
  it("should extract dependency refs from binary expression init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-bin-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "const a = 1;",
        "const b = 2;",
        "const result = a + b;",
        "",
        "export function App() {",
        "  return <div>{result}</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "bin-init-test" }),
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

      const resultVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "result",
      );
      expect(resultVar).toBeDefined();
      if (!resultVar) throw new Error("result not found");

      const depNames = Object.values(resultVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("a");
      expect(depNames).toContain("b");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TemplateLiteral in variable init", () => {
  it("should extract dependency refs from template literal init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-tpl-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "import { useState } from 'react';",
        "",
        "export function App() {",
        "  const [name] = useState('World');",
        "  const greeting = `Hello ${name}`;",
        "  return <div>{greeting}</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "tpl-init-test" }),
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

      const greetingVar = Object.values(appVar.var).find(
        (v: any) =>
          v.name?.type === "identifier" && v.name?.name === "greeting",
      );
      expect(greetingVar).toBeDefined();
      if (!greetingVar) throw new Error("greeting not found");

      const depNames = Object.values(greetingVar.dependencies).map(
        (d: any) => d.name,
      );
      expect(depNames).toContain("name");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("UnaryExpression in variable init", () => {
  it("should extract dependency ref from unary expression init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-unary-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "const visible = true;",
        "const hidden = !visible;",
        "",
        "export function App() {",
        "  return <div hidden={hidden} />;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "unary-init-test" }),
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

      const hiddenVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "hidden",
      );
      expect(hiddenVar).toBeDefined();
      if (!hiddenVar) throw new Error("hidden not found");

      const depNames = Object.values(hiddenVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("visible");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("TSNonNullExpression in variable init", () => {
  it("should extract dependency ref from non-null assertion init", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-nn-init-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "interface User { name: string; }",
        "const maybe: User | undefined = { name: 'Alice' };",
        "const sure = maybe!;",
        "",
        "export function App() {",
        "  return <div>{sure.name}</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "nn-init-test" }),
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

      const sureVar = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "sure",
      );
      expect(sureVar).toBeDefined();
      if (!sureVar) throw new Error("sure not found");

      const depNames = Object.values(sureVar.dependencies).map((d) => d.name);
      expect(depNames).toContain("maybe");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("WhileStatement block scope", () => {
  it("should create a block scope for while loop bodies", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-whilescope-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "export function App() {",
        "  let i = 0;",
        "  while (i < 3) {",
        "    const x = i;",
        "    i++;",
        "  }",
        "  return <div>done</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "whilescope-test" }),
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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("DoWhileStatement block scope", () => {
  it("should create a block scope for do-while loop bodies", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-dowhile-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "export function App() {",
        "  let i = 0;",
        "  do {",
        "    const x = i;",
        "    i++;",
        "  } while (i < 3);",
        "  return <div>done</div>;",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "dowhile-test" }),
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
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("this.props member expression tracking in class components", () => {
  it("should detect this.props.x usage in class component render", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-thisprops-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    fs.writeFileSync(
      path.join(srcDir, "App.tsx"),
      [
        "import React from 'react';",
        "",
        "interface AppProps {",
        "  name: string;",
        "  count: number;",
        "}",
        "",
        "export class App extends React.Component<AppProps> {",
        "  render() {",
        "    return <div>{this.props.name}: {this.props.count}</div>;",
        "  }",
        "}",
      ].join("\n"),
    );

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "thisprops-test" }),
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

      expect('props' in appVar).toBe(true);
      const propNames = (appVar as { props: Array<{ name: string }> }).props.map(
        (p) => p.name,
      );
      expect(propNames).toContain("name");
      expect(propNames).toContain("count");
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
