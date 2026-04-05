import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";

describe("analyser class state inference", () => {
  it("should infer state properties from setState keys and object literal", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");
    const fileName = "StateInferenceTest.tsx";
    const code = `
      import React from 'react';
      export class MyComponent extends React.Component {
        constructor() {
          super();
          this.state = { count: 0 };
        }
        increment() {
          this.setState({ count: 1, name: "test" });
        }
        render() { return <div />; }
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(projectPath);
      const graph = await analyzeFiles(
        projectPath,
        null,
        [fileName],
        packageJson,
      );
      const file = graph.files["/StateInferenceTest.tsx"];

      const myComponent = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyComponent",
      );
      if (myComponent?.kind !== "component")
        throw new Error("MyComponent should be a component");
      expect(myComponent).toBeDefined();
      expect(myComponent?.states).toBeDefined();

      // count and name should be in states
      const stateVars = Object.values(myComponent.var).filter(
        (v) => v.kind === "state",
      );
      expect(
        stateVars.find(
          (v) => v.name.type == "identifier" && v.name.name === "count",
        ),
      ).toBeDefined();
      expect(
        stateVars.find(
          (v) => v.name.type == "identifier" && v.name.name === "name",
        ),
      ).toBeDefined();

      const countVar = stateVars.find(
        (v) => v.name.type == "identifier" && v.name.name === "count",
      );
      expect(countVar?.stateType).toEqual({
        type: "literal-type",
        literal: { type: "number", value: 0 },
      });

      const nameVar = stateVars.find(
        (v) => v.name.type == "identifier" && v.name.name === "name",
      );
      expect(nameVar?.stateType).toEqual({
        type: "literal-type",
        literal: { type: "string", value: "test" },
      });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it("should infer state properties from variable spread", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");
    const fileName = "StateSpreadTest.tsx";
    const code = `
      import React from 'react';
      export class MyComponent extends React.Component {
        update() {
          const newState = { active: true };
          this.setState({ ...newState, count: 5 });
        }
        render() { return <div />; }
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(projectPath);
      const graph = await analyzeFiles(
        projectPath,
        null,
        [fileName],
        packageJson,
      );
      const file = graph.files["/StateSpreadTest.tsx"];

      const myComponent = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyComponent",
      );
      if (myComponent?.kind !== "component")
        throw new Error("MyComponent should be a component");
      const stateVars = Object.values(myComponent?.var ?? {}).filter(
        (v) => v.kind === "state",
      );
      expect(
        stateVars.find(
          (v) => v.name.type == "identifier" && v.name.name === "active",
        ),
      ).toBeDefined();
      expect(
        stateVars.find(
          (v) => v.name.type == "identifier" && v.name.name === "count",
        ),
      ).toBeDefined();

      const activeVar = stateVars.find(
        (v) => v.name.type == "identifier" && v.name.name === "active",
      );
      expect(activeVar?.stateType).toEqual({
        type: "literal-type",
        literal: { type: "boolean", value: true },
      });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });

  it("should create relations between setState call and state variables", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");
    const fileName = "StateRelationTest.tsx";
    const code = `
      import React from 'react';
      export class MyComponent extends React.Component {
        myMethod() {
          this.setState({ count: 1 });
        }
        render() { return <div />; }
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(projectPath);
      const graph = await analyzeFiles(
        projectPath,
        null,
        [fileName],
        packageJson,
      );
      const file = graph.files["/StateRelationTest.tsx"];

      const myComponent = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyComponent",
      );
      if (myComponent?.kind !== "component")
        throw new Error("MyComponent should be a component");
      const myMethod =
        myComponent.var[
          Object.keys(myComponent.var).find(
            (k) =>
              myComponent?.var[k]?.name.type == "identifier" &&
              myComponent.var[k].name.name === "myMethod",
          )!
        ];

      const stateVar = Object.values(myComponent.var).find(
        (v) =>
          v.kind === "state" &&
          v.name.type == "identifier" &&
          v.name.name === "count",
      );

      // Check relations
      const relations = file!.relations;
      const setRelation = relations?.find(
        (r) =>
          r.from_id === myMethod?.id &&
          r.to_id === stateVar!.id &&
          r.kind === "usage-write",
      );
      expect(setRelation).toBeDefined();
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
  });
});
