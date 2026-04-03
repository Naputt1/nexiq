import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";

describe("repro stack overflow", () => {
  it("should not crash on circular object spread", async () => {
    const projectPath = path.resolve(
      process.cwd(),
      "../sample-project/class-components",
    );
    const fileName = "Repro.tsx";
    const code = `
      import React from 'react';
      export class MyComponent extends React.Component {
        update() {
          const a = { ...b };
          const b = { ...a };
          this.setState(a);
        }
        render() { return <div />; }
      }
    `;

    if (!fs.existsSync(projectPath)) {
      fs.mkdirSync(projectPath, { recursive: true });
    }
    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    const pkgJsonPath = path.resolve(projectPath, "package.json");
    if (!fs.existsSync(pkgJsonPath)) {
      fs.writeFileSync(
        pkgJsonPath,
        JSON.stringify({ name: "repro", version: "1.0.0" }),
      );
    }

    try {
      const packageJson = new PackageJson(projectPath);
      const graph = await analyzeFiles(
        projectPath,
        null,
        [fileName],
        packageJson,
        undefined,
        undefined,
        1,
      );
      expect(graph).toBeDefined();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });
});
