import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.js";
import { analyzeProject } from "./index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import path from "path";
import fs from "fs";
import type { SnapshotData } from "./types/test.js";

describe("analyser snapshots", () => {
  const projects = [
    "simple",
    "complex",
    "props",
    "hook",
    "props-complex",
    "destructuring-hook",
    "jsx-variable",
    "forward-ref",
    "destructured-export",
    "ts-method-signature",
  ];

  projects.forEach((projectName) => {
    it(`should match snapshot for ${projectName}`, async () => {
      const projectPath = path.resolve(
        process.cwd(),
        `../sample-project/${projectName}`,
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

      const snapshotPath = path.resolve(
        process.cwd(),
        `test/snapshots/${projectName}.json`,
      );
      const snapshotData: SnapshotData = JSON.parse(
        fs.readFileSync(snapshotPath, "utf-8"),
      );

      // Compare the result with the stored snapshot
      // We strip the absolute 'src' path as it changes between environments
      const result: SnapshotData = JSON.parse(JSON.stringify(graph));
      delete result.src;

      // Strip fingerPrint as it contains timestamps
      for (const file of Object.values(result.files)) {
        delete file.fingerPrint;
      }

      expect(result).toEqual(snapshotData);
    });
  });
});

describe("analyser ignore patterns", () => {
  it("should respect ignore patterns in getFiles", () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");

    const allFiles = getFiles(projectPath);
    const ignoredFiles = getFiles(projectPath, ["**/App.tsx"]);

    expect(allFiles.length).toBeGreaterThan(ignoredFiles.length);
    expect(allFiles).toContain("src/App.tsx");
    expect(ignoredFiles).not.toContain("src/App.tsx");
  });
});

describe("analyser class components", () => {
  it("should identify class components", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");
    
    // We'll mock a file with a class component
    const fileName = "ClassComp.tsx";
    const code = `
      import React from 'react';
      export default class ClassComp extends React.Component {
        render() {
          return <div>Class Component</div>;
        }
      }
    `;
    
    // Create a temporary file
    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);
    
    try {
      const result = await analyzeProject(projectPath);
      const file = result.files["/ClassComp.tsx"];
      
      expect(file).toBeDefined();
      const comp = Object.values(file!.var).find(v => v.name.type === 'identifier' && v.name.name === 'ClassComp');
      expect(comp).toBeDefined();
      expect(comp?.kind).toBe('component');
      expect(comp?.type).toBe('class');
    } finally {
      fs.unlinkSync(filePath);
    }
  });
});
