import { parentPort } from "node:worker_threads";
import fs from "node:fs";
import path from "node:path";
import { parseCode } from "./analyzer/utils.js";
import { traverseFn } from "./utils/babel.js";
import { ComponentDB } from "./db/componentDB.js";
import { PackageJson } from "./db/packageJson.js";
import ImportDeclaration from "./analyzer/importDeclaration.js";
import ExportNamedDeclaration from "./analyzer/exportNamedDeclaration.js";
import ExportDefaultDeclaration from "./analyzer/exportDefaultDeclaration.js";
import ExportAllDeclaration from "./analyzer/exportAllDeclaration.js";
import FunctionDeclaration from "./analyzer/functionDeclaration.js";
import VariableDeclarator from "./analyzer/variableDeclaration.js";
import ClassDeclaration from "./analyzer/classDeclaration.js";
import ClassMethod from "./analyzer/classMethod.js";
import ClassProperty from "./analyzer/classProperty.js";
import JSXElement from "./analyzer/JSXElement.js";
import CallExpression from "./analyzer/callExpression.js";
import ReturnStatement from "./analyzer/returnStatement.js";
import TSInterfaceDeclaration from "./analyzer/type/TSInterfaceDeclaration.js";
import TSTypeAliasDeclaration from "./analyzer/type/TSTypeAliasDeclaration.js";
import { extractFileUsages } from "./analyzer/usageCollector.js";
import type { FileTaskMessage } from "./types.js";

interface WorkerParams {
  filePath: string;
  srcDir: string;
  viteAliases: Record<string, string>;
  packageJsonData: Record<string, unknown>;
  runId?: string;
}

async function analyzeFile(params: WorkerParams) {
  const { filePath, srcDir, viteAliases, packageJsonData } = params;
  const fileName = "/" + filePath;
  const fullPath = path.resolve(srcDir, filePath);

  const packageJson = new PackageJson(srcDir, packageJsonData);

  const componentDB = new ComponentDB({
    packageJson,
    viteAliases,
    dir: srcDir,
    sqlite: undefined, // Workers don't write to SQLite
  });

  const code = fs.readFileSync(fullPath, "utf-8");
  const ast = parseCode(code);

  componentDB.addFile(filePath);

  traverseFn(ast, {
    ImportDeclaration: ImportDeclaration(componentDB, fileName),
    ExportNamedDeclaration: ExportNamedDeclaration(componentDB, fileName),
    ExportAllDeclaration: ExportAllDeclaration(componentDB, fileName),
    ExportDefaultDeclaration: ExportDefaultDeclaration(componentDB, fileName),
    FunctionDeclaration: FunctionDeclaration(componentDB, fileName),
    ClassDeclaration: ClassDeclaration(componentDB, fileName),
    ClassExpression: ClassDeclaration(componentDB, fileName),
    ClassMethod: ClassMethod(componentDB, fileName),
    ClassPrivateMethod: ClassMethod(componentDB, fileName),
    ClassProperty: ClassProperty(componentDB, fileName),
    ClassPrivateProperty: ClassProperty(componentDB, fileName),
    VariableDeclarator: VariableDeclarator(componentDB, fileName),
    ReturnStatement: ReturnStatement(componentDB, fileName),
    ...JSXElement(componentDB, fileName),
    CallExpression: CallExpression(componentDB, fileName),
    TSTypeAliasDeclaration: TSTypeAliasDeclaration(componentDB, fileName),
    TSInterfaceDeclaration: TSInterfaceDeclaration(componentDB, fileName),
  });

  extractFileUsages(ast, componentDB, fileName);

  const fileData = componentDB.getFile(fileName).getData();
  fileData.package_id = packageJson.getPackageIdForFile(fullPath) || undefined;
  return fileData;
}

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception in worker:", err);
});

process.on("unhandledRejection", (reason, _promise) => {
  console.error("Unhandled Rejection in worker:", reason);
});

if (parentPort) {
  parentPort.on("message", async (params: WorkerParams) => {
    try {
      const result = await analyzeFile(params);
      const message: FileTaskMessage = {
        type: "file_success",
        filePath: params.filePath,
        result,
      };
      parentPort!.postMessage(message);
    } catch (error) {
      console.error(`Worker error for ${params.filePath}:`, error);
      const err = error as Error & {
        code?: string;
        loc?: { line?: number; column?: number };
        pos?: number;
      };
      const isParseError =
        err?.name === "SyntaxError" ||
        (typeof err?.message === "string" &&
          err.message.includes("Unexpected"));
      const message: FileTaskMessage = {
        type: isParseError ? "file_parse_error" : "file_extract_error",
        filePath: params.filePath,
        error: err instanceof Error ? err.message : String(error),
        stack: err instanceof Error ? err.stack : undefined,
        line: err?.loc?.line,
        column: err?.loc?.column,
        parser: "babel",
      };
      parentPort!.postMessage(message);
    }
  });
}
