import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";
import os from "os";

describe("repro stack overflow", () => {
  it("should not crash on circular object spread", async () => {
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexiq-repro-circular-"),
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

    const filePath = path.join(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    const pkgJsonPath = path.join(projectPath, "package.json");
    fs.writeFileSync(
      pkgJsonPath,
      JSON.stringify({ name: "repro", version: "1.0.0" }),
    );

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

describe("wrapper function analysis", () => {
  it("treats assigned wrapper callbacks as functions without anonymous helper nodes", async () => {
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexiq-wrapper-repro-"),
    );
    const fileName = "WrapperRepro.tsx";
    const code = `
      import { useEffect } from "react";

      declare function debounce<T extends (...args: never[]) => unknown>(fn: T, wait: number): T;
      declare function useAppStateStore<T>(selector: (s: { selectedSubProjects: string[] }) => T): T;

      export function Demo({
        graph,
        projectPath,
        view,
      }: {
        graph: unknown;
        projectPath: string;
        view: string;
      }) {
        const selectedSubProjects = useAppStateStore((s) => s.selectedSubProjects);

        useEffect(() => {
          const savePositions = debounce(() => {
            const positions = {};
            return positions;
          }, 1000);

          return () => {
            void graph;
            void projectPath;
            void selectedSubProjects;
            void view;
            savePositions();
          };
        }, [graph, projectPath, selectedSubProjects, view]);

        return <div />;
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    const pkgJsonPath = path.resolve(projectPath, "package.json");

    try {
      fs.writeFileSync(
        pkgJsonPath,
        JSON.stringify({ name: "wrapper-repro", version: "1.0.0" }),
      );
      fs.writeFileSync(filePath, code);

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

      const file = graph.files["/WrapperRepro.tsx"];
      expect(file).toBeDefined();

      const findVariableByName = (
        vars: Record<string, any>,
        targetName: string,
      ): any | undefined => {
        for (const variable of Object.values(vars)) {
          if (
            variable.name &&
            typeof variable.name === "object" &&
            "name" in variable.name &&
            variable.name.name === targetName
          ) {
            return variable;
          }

          if (variable.var && typeof variable.var === "object") {
            const nested = findVariableByName(variable.var, targetName);
            if (nested) return nested;
          }
        }

        return undefined;
      };

      const demo = findVariableByName(file!.var, "Demo");
      expect(demo).toBeDefined();
      expect("var" in demo!).toBe(true);

      const selectedSubProjects = findVariableByName(
        demo!.var,
        "selectedSubProjects",
      );
      expect(selectedSubProjects?.kind).toBe("hook");
      expect(selectedSubProjects?.type).toBe("data");

      const savePositions = findVariableByName(demo!.var, "savePositions");
      expect(savePositions?.kind).toBe("normal");
      expect(savePositions?.type).toBe("function");

      const collectNames = (
        vars: Record<string, any>,
        names: string[] = [],
      ) => {
        for (const variable of Object.values(vars)) {
          if (
            variable.name &&
            typeof variable.name === "object" &&
            "name" in variable.name &&
            typeof variable.name.name === "string"
          ) {
            names.push(variable.name.name);
          }
          if (variable.var && typeof variable.var === "object") {
            collectNames(variable.var, names);
          }
        }
        return names;
      };

      const names = collectNames(file!.var);
      const anonymousNames = names.filter((name) =>
        name.startsWith("anonymous@"),
      );
      expect(anonymousNames.length).toBe(1);
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(projectPath)) fs.rmdirSync(projectPath);
    }
  });

  it("treats top-level wrapped components as functions and preserves props", async () => {
    const projectPath = fs.mkdtempSync(
      path.join(os.tmpdir(), "nexiq-wrapper-component-"),
    );
    const fileName = "WrappedComponent.tsx";
    const code = `
      import React, { memo } from "react";

      type Props = { title: string };

      export const Wrapped = memo(function WrappedInner(props: Props) {
        return <div>{props.title}</div>;
      });
    `;

    const filePath = path.resolve(projectPath, fileName);
    const pkgJsonPath = path.resolve(projectPath, "package.json");

    try {
      fs.writeFileSync(
        pkgJsonPath,
        JSON.stringify({ name: "wrapper-component", version: "1.0.0" }),
      );
      fs.writeFileSync(filePath, code);

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

      const file = graph.files["/WrappedComponent.tsx"];
      const wrapped = Object.values(file!.var).find(
        (variable: any) => variable.name?.name === "Wrapped",
      ) as any;

      expect(wrapped).toBeDefined();
      expect(wrapped.type).toBe("function");
      expect(wrapped.kind).toBe("component");
      expect(wrapped.props).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "props",
            kind: "prop",
          }),
        ]),
      );
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      if (fs.existsSync(pkgJsonPath)) fs.unlinkSync(pkgJsonPath);
      if (fs.existsSync(projectPath)) fs.rmdirSync(projectPath);
    }
  });
});
