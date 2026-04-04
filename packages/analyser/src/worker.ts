import { parentPort, threadId, workerData } from "node:worker_threads";

console.error("Worker process starting...");

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception in worker:", err);
});

process.on("unhandledRejection", (reason, _promise) => {
  console.error("Unhandled Rejection in worker:", reason);
});

import fs from "node:fs";
import { parseCode } from "./analyzer/utils.ts";
import { traverseFn } from "./utils/babel.ts";
import { ComponentDB } from "./db/componentDB.ts";
import { PackageJson } from "./db/packageJson.ts";
import ImportDeclaration from "./analyzer/importDeclaration.ts";
import ExportNamedDeclaration from "./analyzer/exportNamedDeclaration.ts";
import ExportDefaultDeclaration from "./analyzer/exportDefaultDeclaration.ts";
import ExportAllDeclaration from "./analyzer/exportAllDeclaration.ts";
import FunctionDeclaration from "./analyzer/functionDeclaration.ts";
import VariableDeclarator from "./analyzer/variableDeclaration.ts";
import ClassDeclaration from "./analyzer/classDeclaration.ts";
import ClassMethod from "./analyzer/classMethod.ts";
import ClassProperty from "./analyzer/classProperty.ts";
import ArrowFunctionExpression from "./analyzer/arrowFunctionExpression.ts";
import FunctionExpression from "./analyzer/functionExpression.ts";
import JSXElement from "./analyzer/JSXElement.ts";
import CallExpression from "./analyzer/callExpression.ts";
import ReturnStatement from "./analyzer/returnStatement.ts";
import TSInterfaceDeclaration from "./analyzer/type/TSInterfaceDeclaration.ts";
import TSTypeAliasDeclaration from "./analyzer/type/TSTypeAliasDeclaration.ts";
import { extractFileUsages } from "./analyzer/usageCollector.ts";
import type {
  AnalyzerWorkerRequest,
  AnalyzerWorkerResponse,
  FileTaskMessage,
  FileTaskSuccessMessage,
  WorkerSessionConfig,
} from "./types.ts";
import { resolvePath } from "./utils/path.ts";
import AssignmentExpression from "./analyzer/assignmentExpression.ts";

const sessionConfig = (workerData || {}) as WorkerSessionConfig;

async function analyzeFile(filePath: string, config: WorkerSessionConfig) {
  const { srcDir, viteAliases, packageJsonData } = config;
  const fileName = filePath;
  const fullPath = resolvePath(srcDir, filePath);

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
    ArrowFunctionExpression: ArrowFunctionExpression(componentDB, fileName),
    FunctionExpression: FunctionExpression(componentDB, fileName),
    ...JSXElement(componentDB, fileName),
    CallExpression: CallExpression(componentDB, fileName),
    TSTypeAliasDeclaration: TSTypeAliasDeclaration(componentDB, fileName),
    TSInterfaceDeclaration: TSInterfaceDeclaration(componentDB, fileName),
    AssignmentExpression: AssignmentExpression(componentDB, fileName),
  });

  extractFileUsages(ast, componentDB, filePath);

  componentDB.resolveDependency();

  const file = componentDB.getFile(filePath);
  if (file) {
    file.init = true;
    file.package_id = packageJson.getPackageIdForFile(fullPath) || undefined;
  }
  const fileData = file!.getData();
  console.error(
    `[Worker ${threadId}] Found ${Object.keys(fileData.var).length} top-level components/variables in ${filePath}`,
  );
  return {
    fileData,
    resolveTasks: componentDB.getResolveTasks(),
  };
}

if (parentPort) {
  parentPort.on("message", async (request: AnalyzerWorkerRequest) => {
    const results: FileTaskMessage[] = [];
    console.log(
      `[Worker ${threadId}] Received batch: ${request.filePaths.length} files`,
    );

    for (const filePath of request.filePaths) {
      try {
        console.log(`[Worker ${threadId}] Analyzing file: ${filePath}`);
        const { fileData, resolveTasks } = await analyzeFile(
          filePath,
          sessionConfig,
        );
        const message: FileTaskSuccessMessage = {
          type: "file_success",
          filePath,
          result: fileData,
          resolveTasks,
        };
        results.push(message);
      } catch (error) {
        console.error(`[Worker ${threadId}] Error analyzing ${filePath}:`, error);
        if (error instanceof Error) {
          console.error(error.stack);
        }
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
          filePath,
          error: err instanceof Error ? err.message : String(error),
          stack: err instanceof Error ? err.stack : undefined,
          line: err?.loc?.line,
          column: err?.loc?.column,
          parser: "babel",
        };
        results.push(message);
      }
    }

    const response: AnalyzerWorkerResponse = {
      type: "batch_result",
      results,
    };
    parentPort!.postMessage(response);
  });
}
