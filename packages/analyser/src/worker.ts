import { parentPort, threadId, workerData } from "node:worker_threads";
import { performance } from "node:perf_hooks";

console.error("Worker process starting...");

process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception in worker:", err);
});

process.on("unhandledRejection", (reason, _promise) => {
  console.error("Unhandled Rejection in worker:", reason);
});

import fs from "node:fs";
import { parseCode } from "./analyzer/utils.ts";
import { mergeVisitors, traverseFn } from "./utils/babel.ts";
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
import TSEnumDeclaration from "./analyzer/TSEnumDeclaration.ts";
import TSModuleDeclaration from "./analyzer/TSModuleDeclaration.ts";
import TSImportEqualsDeclaration from "./analyzer/TSImportEqualsDeclaration.ts";
import TSExportAssignment from "./analyzer/TSExportAssignment.ts";
import TSNamespaceExportDeclaration from "./analyzer/TSNamespaceExportDeclaration.ts";
import TSDeclareFunction from "./analyzer/TSDeclareFunction.ts";
import TSDeclareMethod from "./analyzer/TSDeclareMethod.ts";
import MemberExpression from "./analyzer/memberExpression.ts";
import { createUsageCollector } from "./analyzer/usageCollector.ts";
import type {
  AnalyzerWorkerMessage,
  AnalyzerWorkerRequest,
  AnalyzerWorkerResponse,
  FileTaskMessage,
  FileTaskSuccessMessage,
  WorkerSessionConfig,
} from "./types.ts";
import type { ComponentFile, ComponentFileVar } from "@nexiq/shared";
import { resolvePath } from "./utils/path.ts";
import AssignmentExpression from "./analyzer/assignmentExpression.ts";
import BlockScope from "./analyzer/blockScope.ts";
import { TsConfigManager } from "./tsconfig.ts";

const sessionConfig = (workerData || {}) as WorkerSessionConfig;

// Signal that the module graph (babel parser, analyser visitors) has finished
// loading so the pool can measure worker startup overhead.
if (parentPort) {
  parentPort.postMessage({ type: "worker_ready" } satisfies AnalyzerWorkerMessage);
}

// PackageJson and TsConfigManager are immutable per batch, so they are created
// once per batch and reused. The ComponentDB is intentionally per-file: it
// accumulates traversal state (edges, resolve tasks, scope history) that must
// not leak between files — sharing it across a batch produced subtly different
// variable-id resolutions for some files.
// NOTE: this deliberately does NOT call componentDB.resolveDependency() — that
// pass only builds render edges into the worker-local ComponentDB, which is
// never returned, and the parent re-runs it once on the merged DB (matching the
// serial path). The per-file data is identical either way.
function analyzeFileInBatch(
  componentDB: ComponentDB,
  packageJson: PackageJson,
  filePath: string,
  srcDir: string,
): {
  fileData: ComponentFile;
  blockedVars: Record<string, Record<string, ComponentFileVar>>;
  readMs: number;
  parseMs: number;
  traverseMainMs: number;
  usageMs: number;
  extractMs: number;
  serializeMs: number;
} {
  const fullPath = resolvePath(srcDir, filePath);

  const readStart = performance.now();
  const code = fs.readFileSync(fullPath, "utf-8");
  const readMs = performance.now() - readStart;

  const parseStart = performance.now();
  const ast = parseCode(code);
  const parseMs = performance.now() - parseStart;

  const extractStart = performance.now();
  componentDB.addFile(filePath);

  const fileName = filePath;
  let usageMs = 0;
  const usage = createUsageCollector(componentDB, filePath);
  const collectUsage = () => {
    const flushStart = performance.now();
    usage.flush();
    usageMs += performance.now() - flushStart;
  };
  const traverseMainStart = performance.now();
  traverseFn(
    ast,
    mergeVisitors(
      {
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
        ClassAccessorProperty: ClassProperty(componentDB, fileName),
        VariableDeclarator: VariableDeclarator(componentDB, fileName),
        ReturnStatement: ReturnStatement(componentDB, fileName),
        ArrowFunctionExpression: ArrowFunctionExpression(componentDB, fileName),
        FunctionExpression: FunctionExpression(componentDB, fileName),
        ...JSXElement(componentDB, fileName),
        CallExpression: CallExpression(componentDB, fileName),
        TSTypeAliasDeclaration: TSTypeAliasDeclaration(componentDB, fileName),
        TSInterfaceDeclaration: TSInterfaceDeclaration(componentDB, fileName),
        TSEnumDeclaration: TSEnumDeclaration(componentDB, fileName),
        TSDeclareFunction: TSDeclareFunction(componentDB, fileName),
        TSModuleDeclaration: TSModuleDeclaration(componentDB, fileName),
        TSImportEqualsDeclaration: TSImportEqualsDeclaration(componentDB, fileName),
        TSExportAssignment: TSExportAssignment(componentDB, fileName),
        TSNamespaceExportDeclaration: TSNamespaceExportDeclaration(componentDB, fileName),
        TSDeclareMethod: TSDeclareMethod(componentDB, fileName),
        MemberExpression: MemberExpression(componentDB, fileName),
        AssignmentExpression: AssignmentExpression(componentDB, fileName),
        ...BlockScope(componentDB, fileName),
      },
      usage.visitors,
      {
        Program: {
          exit() {
            collectUsage();
          },
        },
      },
    ),
  );
  const traverseMainMs = performance.now() - traverseMainStart;

  const extractMs = performance.now() - extractStart;

  const file = componentDB.getFile(filePath);
  if (file) {
    file.init = true;
    file.package_id = packageJson.getPackageIdForFile(fullPath) || undefined;
  }

  const serializeStart = performance.now();
  const fileData = file!.getData();
  const blockedVars = file!.getBlockedVars();
  const serializeMs = performance.now() - serializeStart;

  return {
    fileData,
    blockedVars,
    readMs,
    parseMs,
    traverseMainMs,
    usageMs,
    extractMs,
    serializeMs,
  };
}

if (parentPort) {
  parentPort.on("message", async (request: AnalyzerWorkerRequest) => {
    const results: FileTaskMessage[] = [];
    let workerCpuMs = 0;
    let workerReadMs = 0;
    let workerParseMs = 0;
    let workerExtractMs = 0;
    let workerTraverseMainMs = 0;
    let workerUsageMs = 0;
    let workerSerializeMs = 0;
    if (process.env.MODE === "development") {
      console.log(
        `[Worker ${threadId}] Received batch: ${request.filePaths.length} files`,
      );
    }

    if (!request || typeof request.filePaths === "undefined") {
      parentPort!.postMessage({
        type: "batch_result",
        results: [
          {
            type: "file_extract_error",
            filePath: "",
            error: "Malformed worker request",
            parser: "babel",
          },
        ],
      });
      return;
    }

    // PackageJson + TsConfigManager are created once per batch and reused.
    const { srcDir, viteAliases, packageJsonData, tsConfigMap } = sessionConfig;
    const packageJson = new PackageJson(srcDir, packageJsonData);
    const tsConfigManager = tsConfigMap
      ? TsConfigManager.fromJSON(tsConfigMap)
      : undefined;

    for (const filePath of request.filePaths) {
      try {
        if (process.env.MODE === "development") {
          console.log(`[Worker ${threadId}] Analyzing file: ${filePath}`);
        }
        // Fresh ComponentDB per file — its traversal state must not leak.
        const componentDB = new ComponentDB({
          packageJson,
          viteAliases,
          dir: srcDir,
          sqlite: undefined, // Workers don't write to SQLite
          tsConfigManager,
        });
        const {
          fileData,
          blockedVars,
          readMs,
          parseMs,
          traverseMainMs,
          usageMs,
          extractMs,
          serializeMs,
        } = analyzeFileInBatch(componentDB, packageJson, filePath, srcDir);
        const resolveTasks = componentDB.getResolveTasks();
        workerCpuMs += readMs + parseMs + extractMs;
        workerReadMs += readMs;
        workerParseMs += parseMs;
        workerExtractMs += extractMs;
        workerTraverseMainMs += traverseMainMs;
        workerUsageMs += usageMs;
        workerSerializeMs += serializeMs;
        const message: FileTaskSuccessMessage = {
          type: "file_success",
          filePath,
          result: fileData,
          resolveTasks,
          blockedVars,
        };
        results.push(message);
      } catch (error) {
        console.error(
          `[Worker ${threadId}] Error analyzing ${filePath}:`,
          error,
        );
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

    try {
      const response: AnalyzerWorkerResponse = {
        type: "batch_result",
        results,
        workerCpuMs,
        serializeMs: workerSerializeMs,
        workerReadMs,
        workerParseMs,
        workerExtractMs,
        workerTraverseMainMs,
        workerUsageMs,
      };
      parentPort!.postMessage(response);
    } catch (error) {
      console.error(
        `[Worker ${threadId}] Failed to post batch result:`,
        error,
      );
      try {
        parentPort!.postMessage({
          type: "batch_result",
          results: [
            {
              type: "file_extract_error",
              filePath: "",
              error: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
              parser: "babel",
            },
          ],
        });
      } catch {
        // Worker is shutting down; nothing more we can do.
      }
    }
  });
}
