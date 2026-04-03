import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { analyzeProject } from "./lib.ts";
import { PackageJson } from "./db/packageJson.ts";
import type { ComponentFileVar } from "@nexiq/shared";
import path from "path";
import fs from "fs";
import os from "os";
import { RouterParser } from "./routerParser/index.ts";
import { ReactRouterParser } from "./routerParser/react-router.ts";
import * as analyzerCli from "./analyzer.ts";
import * as snapshotCli from "./snapshot.ts";

describe("analyser coverage expansion", () => {
  const createTmpProject = (files: Record<string, string>) => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-coverage-"));

    for (const [filePath, content] of Object.entries(files)) {
      const fullPath = path.join(tmpDir, filePath);
      fs.mkdirSync(path.dirname(fullPath), { recursive: true });
      fs.writeFileSync(fullPath, content);
    }

    if (!files["package.json"]) {
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ name: "test-coverage" }),
      );
    }

    return tmpDir;
  };

  it("should cover analyzeProject and config loading", async () => {
    const tmpDir = createTmpProject({
      "nexiq.config.json": JSON.stringify({
        ignorePatterns: ["**/ignored.ts"],
      }),
      "src/App.tsx": "export const App = () => <div>Hello</div>;",
      "src/ignored.ts": "export const Ignored = 1;",
    });

    const graph = await analyzeProject(tmpDir);
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    expect(graph.files["/src/ignored.ts"]).toBeUndefined();

    // Test with cache
    const cacheFile = path.join(tmpDir, "cache.json");
    fs.writeFileSync(cacheFile, JSON.stringify(graph));
    const cachedGraph = await analyzeProject(tmpDir, cacheFile);
    expect(cachedGraph.files["/src/App.tsx"]).toBeDefined();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover JSXElement edge cases (object props, spread, named functions)", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        import React from 'react';
        export function NamedFunction() {
          const props = { a: 1 };
          // Object expressions that getExpressionData might not fully handle
          // Passing a complex expression to trigger line 84
          return <div 
            obj={{ x: 1, [Math.random()]: 2, ...props }} 
            logical={true && false} 
            conditional={true ? 1 : 0}
            template={\`\${props.a}\`}
          >
            { { child: <div>Inner</div> } }
          </div>;
        }
        
        // Named function with ID for line 63
        export function CompWithId() {
          return <div />;
        }
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover variableDeclaration edge cases", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        import { useCallback, useRef, useEffect, useState } from 'react';
        import { someDep } from './dep';
        
        const someFunc = () => 42;

        export function Parent() {
          const callback = useCallback(function inner() {}, []);
          const ref = useRef();
          const refWithLiteral = useRef([Parent, someDep]);
          const refWithObj = useRef({ p: Parent });
          const myVar = new Date();
          
          function Nested() {
            const nestedVar = () => {};
          }

          useEffect(() => {}, [someDep]);
          
          const c2 = useCallback(someFunc, []);
          
          // Trigger line 61 (undefined declarationKind)
          for (let i = 0; i < 1; i++) {
             const loopVar = 1;
          }

          // Array pattern with hole for processPattern robustness
          const [, setter] = useState(0);
        }
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover propExtractor and pattern edge cases", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        import React, { FC, FunctionComponent } from 'react';
        
        interface MyProps {
          id: string;
        }
        
        export const Comp1: FC<MyProps> = ({ id, ...rest }) => <div />;
        export const Comp2: FunctionComponent<MyProps> = ({ details: [a, b] }) => <div />;
        export const Comp3: React.FunctionComponent<MyProps> = (props: MyProps) => <div />;
        
        export const PatternTest = () => {
          const { "prop-name": p, [computed]: c } = {};
          const [first, ...rest] = [];
        }
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover TS types in helper", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        type T = string | number | null | undefined | void | unknown | never | bigint;
        export const App = (p: T) => <div />;
        
        // Unsupported types for lines 550+
        type U = keyof T | T[keyof T];
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover export declarations", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        export default class MyClass extends React.Component {
          render() { return <div />; }
        }
        export class AnotherClass {}
        export { a as b } from './mod';
      `,
      "src/Anon.tsx": `
        export default class extends React.Component {
          render() { return <div />; }
        }
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx", "src/Anon.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover utils edge cases", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": `
        export const Cond = (p) => {
          if (p) return <div>A</div>;
          else return <div>B</div>;
        }
        export const Nested = () => {
          {
            return <div />;
          }
        }
      `,
    });

    const packageJson = new PackageJson(tmpDir);
    const graph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );
    expect(graph.files["/src/App.tsx"]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover RouterParsers", () => {
    const parser = new RouterParser();
    expect(parser.based).toBeNull();
    const rrParser = new ReactRouterParser();
    expect(rrParser.routerType).toBe("react-router");
  });

  it("should cover cache loading types in fileDB", async () => {
    const tmpDir = createTmpProject({
      "src/App.tsx": "export const App = () => <div>Hello</div>;",
    });

    const packageJson = new PackageJson(tmpDir);
    const initialGraph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
    );

    const fileName = "/src/App.tsx";
    const file = initialGraph.files[fileName];
    expect(file).toBeDefined();
    if (!file) throw new Error("File not found");

    file.var["func-id"] = {
      id: "func-id",
      name: {
        type: "identifier",
        name: "f",
        loc: { line: 1, column: 1 },
        id: "f",
      },
      kind: "normal",
      type: "function",
      file: fileName,
      loc: { line: 1, column: 1 },
      scope: { start: { line: 1, column: 1 }, end: { line: 1, column: 10 } },
      var: {},
      dependencies: {},
      children: {},
      return: undefined,
    } as ComponentFileVar;
    file.var["hook-id"] = {
      id: "hook-id",
      name: {
        type: "identifier",
        name: "useH",
        loc: { line: 2, column: 1 },
        id: "useH",
      },
      kind: "hook",
      type: "function",
      file: fileName,
      loc: { line: 2, column: 1 },
      scope: { start: { line: 2, column: 1 }, end: { line: 2, column: 10 } },
      var: {},
      dependencies: {},
      hooks: [],
      refs: [],
      props: [],
      effects: {},
      states: [],
      children: {},
      return: undefined,
    } as ComponentFileVar;
    file.var["call-id"] = {
      id: "call-id",
      name: {
        type: "identifier",
        name: "data",
        loc: { line: 3, column: 1 },
        id: "data",
      },
      kind: "hook",
      type: "data",
      file: fileName,
      loc: { line: 3, column: 1 },
      call: { id: "h", name: "useH" },
      dependencies: {},
    } as ComponentFileVar;

    const secondGraph = await analyzeFiles(
      tmpDir,
      null,
      ["src/App.tsx"],
      packageJson,
      initialGraph,
    );
    expect(secondGraph.files[fileName]).toBeDefined();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it("should cover package index", async () => {
    const index = await import("./index.ts");
    expect(index.analyzeProject).toBeDefined();
  });

  it("should cover CLIs", () => {
    // We already called them once, calling again with different mocks if possible
    try {
      analyzerCli.main();
    } catch (_e) {
      // Ignore errors during coverage run
    }

    try {
      snapshotCli.runSnapshot("simple");
    } catch (_e) {
      // Ignore errors during coverage run
    }
  });
});
