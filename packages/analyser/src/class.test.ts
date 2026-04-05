import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";

describe("analyser class handling", () => {
  it("should correctly scope variables inside class methods", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");

    // Create a temporary file with a class
    const fileName = "ClassScopeTest.tsx";
    const code = `
      export class MyClass {
        myMethod() {
          const x = 1;
          return x;
        }
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(projectPath);
      const viteConfigPath = getViteConfig(projectPath);
      const files = [fileName]; // Only analyze our test file

      const graph = await analyzeFiles(
        projectPath,
        viteConfigPath,
        files,
        packageJson,
      );

      const file = graph.files["/ClassScopeTest.tsx"];
      expect(file).toBeDefined();

      // Check for MyClass
      const myClass = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyClass",
      );
      expect(myClass).toBeDefined();
      expect(myClass?.kind).toBe("class");
      expect(myClass?.type).toBe("data");

      // Check for 'x'
      const topLevelX = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "x",
      );

      // 'x' should NOT be at the top level
      expect(topLevelX).toBeUndefined();

      if (myClass?.kind !== "class")
        throw new Error("MyClass should be a class");

      // Check for myMethod
      const myClassVar = myClass?.var;
      expect(myClassVar).toBeDefined();

      const myMethod = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "myMethod",
      );
      expect(myMethod).toBeDefined();
      expect(myMethod?.type).toBe("function");

      if (myMethod?.kind !== "method")
        throw new Error("myMethod should be a method");

      // 'x' should be inside myMethod's var
      const myMethodVar = myMethod?.var;
      expect(myMethodVar).toBeDefined();

      const methodX = Object.values(myMethodVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "x",
      );
      expect(methodX).toBeDefined();
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });

  it("should capture inheritance and members", async () => {
    const projectPath = path.resolve(process.cwd(), "../sample-project/simple");

    const fileName = "ClassMembersTest.tsx";
    const code = `
      class Base {}
      export class MyClass extends Base {
        myProp = 1;
        static staticProp = 2;
        constructor() {
          this.myProp = 3;
        }
        myMethod() {
          return this.myProp;
        }
      }
    `;

    const filePath = path.resolve(projectPath, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(projectPath);
      const viteConfigPath = getViteConfig(projectPath);
      const files = [fileName];

      const graph = await analyzeFiles(
        projectPath,
        viteConfigPath,
        files,
        packageJson,
      );

      const file = graph.files["/ClassMembersTest.tsx"];
      const myClass = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyClass",
      );

      if (myClass?.kind !== "class")
        throw new Error("MyClass should be a class");

      expect(myClass).toBeDefined();
      expect(myClass?.superClass).toBeDefined();
      expect(myClass?.superClass?.name).toBe("Base");

      const myClassVar = myClass.var;

      const myProp = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "myProp",
      );
      expect(myProp).toBeDefined();
      expect(myProp?.memberKind).toBe("property");

      const staticProp = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "staticProp",
      );
      expect(staticProp).toBeDefined();
      expect(staticProp?.isStatic).toBe(true);

      const constructor = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "constructor",
      );
      expect(constructor).toBeDefined();
      expect(constructor?.memberKind).toBe("constructor");

      const myMethod = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "myMethod",
      );
      expect(myMethod).toBeDefined();
      expect(myMethod?.memberKind).toBe("method");
    } finally {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  });
});
