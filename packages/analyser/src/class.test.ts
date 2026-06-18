import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.ts";
import { getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import path from "path";
import fs from "fs";
import os from "os";

describe("analyser class handling", () => {
  it("should correctly scope variables inside class methods", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-class-scope-"));
    const fileName = "ClassScopeTest.tsx";
    const code = `
      export class MyClass {
        myMethod() {
          const x = 1;
          return x;
        }
      }
    `;

    const filePath = path.resolve(tmpDir, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(tmpDir);
      const viteConfigPath = getViteConfig(tmpDir);
      const files = [fileName];

      const graph = await analyzeFiles(
        tmpDir,
        viteConfigPath,
        files,
        packageJson,
      );

      const file = graph.files["/ClassScopeTest.tsx"];
      expect(file).toBeDefined();

      const myClass = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "MyClass",
      );
      expect(myClass).toBeDefined();
      expect(myClass?.kind).toBe("class");
      expect(myClass?.type).toBe("data");

      const topLevelX = Object.values(file!.var).find(
        (v) => v.name.type === "identifier" && v.name.name === "x",
      );
      expect(topLevelX).toBeUndefined();

      if (myClass?.kind !== "class")
        throw new Error("MyClass should be a class");

      const myClassVar = myClass?.var;
      expect(myClassVar).toBeDefined();

      const myMethod = Object.values(myClassVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "myMethod",
      );
      expect(myMethod).toBeDefined();
      expect(myMethod?.type).toBe("function");

      if (myMethod?.kind !== "method")
        throw new Error("myMethod should be a method");

      const myMethodVar = myMethod?.var;
      expect(myMethodVar).toBeDefined();

      const methodX = Object.values(myMethodVar).find(
        (v) => v.name.type === "identifier" && v.name.name === "x",
      );
      expect(methodX).toBeDefined();
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("should capture inheritance and members", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-class-members-"));
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

    const filePath = path.resolve(tmpDir, fileName);
    fs.writeFileSync(filePath, code);

    try {
      const packageJson = new PackageJson(tmpDir);
      const viteConfigPath = getViteConfig(tmpDir);
      const files = [fileName];

      const graph = await analyzeFiles(
        tmpDir,
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
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
