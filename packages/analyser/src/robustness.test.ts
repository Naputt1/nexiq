import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { PackageJson } from "./db/packageJson.ts";
import { File } from "./db/fileDB.ts";
import { FunctionVariable } from "./db/variable/functionVariable.ts";
import path from "path";
import fs from "fs";
import os from "os";

describe("analyser robustness", () => {
  it("should handle problematic React patterns without crashing", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-test-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    const testFile = `
      import React, { useState, useMemo, useCallback } from 'react';

      export const ProblematicComponent = () => {
        // 1. Array destructuring with holes
        const [, setter] = useState(0);

        // 2. useMemo with non-inline function
        const someFunc = () => 42;
        const memoValue = useMemo(someFunc, []);

        // 3. useCallback with non-inline function
        const callback = useCallback(someFunc, []);

        // 4. useEffect with non-block body
        React.useEffect(() => console.log('effect'), []);

        return <div>{memoValue}</div>;
      };

      // 5. Hook called outside component (robustness check)
      const outside = useMemo(() => 'fixed', []);
    `;

    fs.writeFileSync(path.join(srcDir, "App.tsx"), testFile);
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test" }),
    );

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );

    expect(graph.files["/src/App.tsx"]).toBeDefined();
    const file = graph.files["/src/App.tsx"]!;
    expect(Object.keys(file.var).length).toBeGreaterThan(0);

    // Cleanup
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should handle circular dependencies without infinite loops", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-circular-"));
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir);

    const fileA = `
      import { B } from './B';
      export const A = () => <B />;
    `;
    const fileB = `
      import { A } from './A';
      export const B = () => <A />;
    `;

    fs.writeFileSync(path.join(srcDir, "A.tsx"), fileA);
    fs.writeFileSync(path.join(srcDir, "B.tsx"), fileB);
    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "test" }),
    );

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/A.tsx", "src/B.tsx"],
      packageJson,
    );

    expect(graph.edges.length).toBeGreaterThan(0);
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should tolerate serialized function scopes during variable merges", () => {
    const file = new File();
    file.path = "/src/App.tsx";

    const existing = new FunctionVariable(
      {
        id: "fn-id",
        name: {
          type: "identifier",
          name: "handler",
          id: "fn-id",
          loc: { line: 1, column: 0 },
        },
        dependencies: {},
        loc: { line: 1, column: 0 },
        scope: {
          start: { line: 1, column: 0 },
          end: { line: 3, column: 1 },
        },
      },
      file,
    );

    const incoming = {
      id: "fn-id",
      name: {
        type: "identifier",
        name: "handler",
        id: "fn-id",
        loc: { line: 1, column: 0 },
      },
      kind: "normal",
      type: "function",
      dependencies: {},
      loc: { line: 1, column: 0 },
      scope: {
        start: { line: 1, column: 0 },
        end: { line: 3, column: 1 },
      },
      var: {},
      children: {},
      load: () => undefined,
      getData: () => {
        throw new Error("not needed in test");
      },
      getDataInternal: () => undefined,
      getBaseData: () => {
        throw new Error("not needed in test");
      },
    } as unknown as FunctionVariable;

    expect(() => existing.load(incoming)).not.toThrow();
  });
});
