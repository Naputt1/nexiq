import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { analyzeProject } from "./index.ts";
import { getFiles, getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";
import os from "os";
import type { SnapshotData } from "./types/test.ts";
import { ComponentFileVarFunctionComponent } from "@nexiq/shared";

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
    "class-components",
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
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-class-test-"));
    const pkgJsonPath = path.resolve(tempDir, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "class-test", version: "1.0.0" }),
    );

    const fileName = "ClassComp.tsx";
    const code = `
      import React from 'react';
      export default class ClassComp extends React.Component {
        render() {
          return <div>Class Component</div>;
        }
      }
    `;

    const filePath = path.resolve(tempDir, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const result = await analyzeProject(tempDir);
      const file = result.files["/ClassComp.tsx"];

      expect(file).toBeDefined();
      const comp = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "ClassComp",
      );
      expect(comp).toBeDefined();
      expect(comp?.kind).toBe("component");
      expect(comp?.type).toBe("class");
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });
});

describe("analyser memo components", () => {
  it("correctly identifies state inside a memo() wrapped component", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-memo-test-"));
    const pkgJsonPath = path.resolve(tempDir, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "memo-test", version: "1.0.0" }),
    );

    const fileName = "MemoState.tsx";
    const code = `
      import React, { memo, useState } from "react";

      export const GitChangeTree = memo(function GitChangeTree({
        data,
      }: { data: any }) {
        const [expandedIds, setExpandedIds] = useState(new Set());
        return <div>{data}</div>;
      });
    `;

    const filePath = path.resolve(tempDir, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(tempDir);
      const graph = await analyzeFiles(tempDir, null, [fileName], packageJson);

      const file = graph.files["/MemoState.tsx"];
      expect(file).toBeDefined();

      const gitChangeTree = Object.values(file!.var).find(
        (v) => v.name.type == "identifier" && v.name?.name === "GitChangeTree",
      ) as ComponentFileVarFunctionComponent;

      if (!gitChangeTree) throw new Error("GitChangeTree not found");

      expect(gitChangeTree).toBeDefined();
      expect(gitChangeTree.kind).toBe("component");

      // Check if state exists in the component's state list
      expect(gitChangeTree.states).toBeDefined();
      const stateId = gitChangeTree.states[0];
      const stateVar = gitChangeTree.var[stateId!] || file!.var[stateId!];
      expect(stateVar).toBeDefined();
      expect(stateVar!.kind).toBe("state");
      expect(stateVar!.name.type).toBe("array");
      expect(
        stateVar!.name.type == "array" &&
          stateVar!.name.elements[0]!.value.type == "identifier" &&
          stateVar!.name.elements[0]!.value.name,
      ).toBe("expandedIds");
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });

  it("correctly sets the memo flag for a memo() wrapped component", async () => {
    const tempDir = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexiq-memo-flag-test-"),
    );
    const pkgJsonPath = path.resolve(tempDir, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "memo-flag-test", version: "1.0.0" }),
    );

    const fileName = "MemoFlag.tsx";
    const code = `
      import React, { memo } from "react";
      export const MemoComponent = memo(() => <div>Memo</div>);
      export const NormalComponent = () => <div>Normal</div>;
    `;

    const filePath = path.resolve(tempDir, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(tempDir);
      const graph = await analyzeFiles(tempDir, null, [fileName], packageJson);

      const file = graph.files["/MemoFlag.tsx"];
      expect(file).toBeDefined();

      const memoComponent = Object.values(file!.var).find(
        (v) => v.name.type == "identifier" && v.name?.name === "MemoComponent",
      ) as ComponentFileVarFunctionComponent;
      const normalComponent = Object.values(file!.var).find(
        (v) =>
          v.name.type == "identifier" && v.name?.name === "NormalComponent",
      ) as ComponentFileVarFunctionComponent;

      expect(memoComponent).toBeDefined();
      expect(memoComponent.memo).toBe(true);

      expect(normalComponent).toBeDefined();
      expect(normalComponent.memo).toBeFalsy();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(tempDir)) fs.rmdirSync(tempDir);
    }
  });
});
