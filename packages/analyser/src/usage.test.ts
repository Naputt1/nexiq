import { describe, expect, it } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";
import os from "os";

describe("usage extraction", () => {
  it("normalizes setState calls back to the state node", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-usage-test-1-"));
    const pkgJsonPath = path.resolve(tempDir, "package.json");
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: "usage-test-1", version: "1.0.0" }));

    const fileName = "UsageStateTest.tsx";
    const filePath = path.resolve(tempDir, fileName);

    fs.writeFileSync(
      filePath,
      `
        import { useState } from "react";

        export function App() {
          const [count, setCount] = useState(0);
          const increment = () => setCount(count + 1);
          return <button onClick={increment}>{count}</button>;
        }
      `,
    );

    try {
      const packageJson = new PackageJson(tempDir);
      const graph = await analyzeFiles(
        tempDir,
        null,
        [fileName],
        packageJson,
      );

      const file = graph.files[`/${fileName}`];
      expect(file?.relations).toBeDefined();

      const setterCall = file?.relations?.find(
        (relation) =>
          relation.kind === "usage-call" && relation.to_id.includes(":state:"),
      );
      expect(setterCall).toBeDefined();

      const readRelation = file?.relations?.find(
        (relation) => relation.kind === "usage-read",
      );
      expect(readRelation).toBeDefined();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });

  it("captures effect reads and JSX prop usages with the correct owners", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-usage-test-2-"));
    const pkgJsonPath = path.resolve(tempDir, "package.json");
    fs.writeFileSync(pkgJsonPath, JSON.stringify({ name: "usage-test-2", version: "1.0.0" }));

    const fileName = "UsageEffectAndJsxTest.tsx";
    const filePath = path.resolve(tempDir, fileName);

    fs.writeFileSync(
      filePath,
      `
        import { useEffect } from "react";

        function Child({ value }: { value: string }) {
          return <div>{value}</div>;
        }

        export function App() {
          const name = "Ada";

          useEffect(() => {
            console.log(name);
          }, [name]);

          return <Child value={name} />;
        }
      `,
    );

    try {
      const packageJson = new PackageJson(tempDir);
      const graph = await analyzeFiles(
        tempDir,
        null,
        [fileName],
        packageJson,
      );

      const file = graph.files[`/${fileName}`];
      expect(file?.relations).toBeDefined();

      const effectRead = file?.relations?.find(
        (relation) =>
          relation.kind === "usage-read" &&
          relation.data_json &&
          typeof relation.data_json === "object" &&
          "ownerKind" in relation.data_json &&
          relation.data_json.ownerKind === "effect" &&
          relation.data_json.displayLabel === "name",
      );
      expect(effectRead).toBeDefined();

      const jsxPropRead = file?.relations?.find(
        (relation) =>
          relation.kind === "usage-read" &&
          relation.data_json &&
          typeof relation.data_json === "object" &&
          "ownerKind" in relation.data_json &&
          relation.data_json.ownerKind === "normal" &&
          relation.data_json.displayLabel === "name",
      );
      expect(jsxPropRead).toBeDefined();

      const jsxRenderCall = file?.relations?.find(
        (relation) =>
          relation.kind === "usage-render-call" &&
          relation.data_json &&
          typeof relation.data_json === "object" &&
          "ownerKind" in relation.data_json &&
          relation.data_json.ownerKind === "normal" &&
          relation.data_json.displayLabel === "Child",
      );
      expect(jsxRenderCall).toBeDefined();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });
});
