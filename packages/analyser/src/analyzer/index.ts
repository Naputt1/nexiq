import { ComponentDB } from "../db/componentDB.js";
import type { PackageJson } from "../db/packageJson.js";
import { getViteAliases } from "../vite.js";
import fs from "fs";
import path from "path";
import traverse from "@babel/traverse";
import { parseCode } from "./utils.js";
import type { File } from "@babel/types";
import ImportDeclaration from "./importDeclaration.js";
import ExportNamedDeclaration from "./exportNamedDeclaration.js";
import ExportDefaultDeclaration from "./exportDefaultDeclaration.js";
import ExportAllDeclaration from "./exportAllDeclaration.js";
import FunctionDeclaration from "./functionDeclaration.js";
import VariableDeclarator from "./variableDeclaration.js";
import JSXElement from "./JSXElement.js";
import CallExpression from "./callExpression.js";

function analyzeFiles(
  SRC_DIR: string,
  viteConfigPath: string | null,
  files: string[],
  packageJson: PackageJson
) {
  const componentDB = new ComponentDB({
    packageJson,
    viteAliases: getViteAliases(viteConfigPath),
    dir: SRC_DIR,
  });

  for (const fullfileName of files) {
    const fileName = "/" + fullfileName;

    componentDB.addFile(fileName);
    // console.log(fileName);
    const code = fs.readFileSync(path.resolve(SRC_DIR, fullfileName), "utf-8");
    let ast: File;
    try {
      ast = parseCode(code, fullfileName);
    } catch (e) {
      console.warn(`Skipping ${fullfileName}: ${(e as Error).message}`);
      continue;
    }

    const traverseFn: typeof traverse.default =
      (traverse as any).default || traverse;
    traverseFn(ast, {
      ImportDeclaration: ImportDeclaration(componentDB, fileName),
      ExportNamedDeclaration: ExportNamedDeclaration(componentDB, fileName),

      ExportAllDeclaration: ExportAllDeclaration(componentDB, fileName),

      ExportDefaultDeclaration: ExportDefaultDeclaration(componentDB, fileName),
      FunctionDeclaration: FunctionDeclaration(componentDB, fileName),
      VariableDeclarator: VariableDeclarator(componentDB, fileName),
      JSXElement: JSXElement(componentDB, fileName),
      CallExpression: CallExpression(componentDB, fileName),
    });
  }

  componentDB.resolve();
  componentDB.resolveDependency();

  return componentDB.getData();
}

export default analyzeFiles;
