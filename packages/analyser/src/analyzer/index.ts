import { ComponentDB } from "../db/componentDB.js";
import type { PackageJson } from "../db/packageJson.js";
import { getViteAliases, getTsConfigAliases } from "../vite.js";
import fs from "node:fs";
import path from "node:path";
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
import ReturnStatement from "./returnStatement.js";
import ArrowFunctionExpression from "./arrowFunctionExpression.js";
import FunctionExpression from "./functionExpression.js";
import TSInterfaceDeclaration from "./type/TSInterfaceDeclaration.js";
import TSTypeAliasDeclaration from "./type/TSTypeAliasDeclaration.js";
import type { JsonData, ComponentFile } from "shared";
import { traverseFn } from "../utils/babel.js";
import type { SqliteDB } from "../db/sqlite.js";
import { WorkerPool } from "../workerPool.js";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function analyzeFiles(
  SRC_DIR: string,
  viteConfigPath: string | null,
  files: string[],
  packageJson: PackageJson,
  cacheData?: JsonData,
  sqlite?: SqliteDB,
  threads: number = process.env.VITEST || process.env.SNAPSHOT
    ? 1
    : os.cpus().length,
) {
  const viteAliases = {
    ...getViteAliases(viteConfigPath),
    ...getTsConfigAliases(SRC_DIR),
  };

  const componentDB = new ComponentDB({
    packageJson,
    viteAliases,
    dir: SRC_DIR,
    sqlite,
  });

  const filesToAnalyze: string[] = [];

  // 1. Identify files to analyze vs load from cache
  for (const fullfileName of files) {
    const fileName = "/" + fullfileName;
    let fileCache: ComponentFile | undefined = cacheData?.files?.[fileName];

    if (!fileCache && sqlite) {
      fileCache = sqlite.loadFileResults(fullfileName);
    }

    if (!componentDB.addFile(fullfileName, fileCache)) {
      // Unchanged, addFile already loaded it from cache if provided
      continue;
    }

    // Changed or new
    filesToAnalyze.push(fullfileName);
  }

  // 2. Multi-threaded analysis
  if (threads > 1 && filesToAnalyze.length > 0) {
    const isTs = import.meta.url.endsWith(".ts");
    const workerScript = fileURLToPath(
      new URL(isTs ? "../worker.ts" : "./worker.js", import.meta.url),
    );
    const pool = new WorkerPool(threads, workerScript);

    console.log(
      `Analyzing ${filesToAnalyze.length} files in ${threads} threads...`,
    );

    const results = await Promise.all(
      filesToAnalyze.map(async (filePath) => {
        try {
          const result = await pool.runTask({
            filePath,
            srcDir: SRC_DIR,
            viteAliases,
            packageJsonData: packageJson.rawData,
          });
          return { filePath, result };
        } catch (e) {
          console.error(`Error analyzing ${filePath}:`, e);
          return { filePath, error: e };
        }
      }),
    );

    await pool.terminate();

    for (const { filePath, result, error: _error } of results) {
      if (result) {
        componentDB.addFile(filePath, result); // This time it will populate
        if (sqlite) {
          sqlite.saveFileResults(result);
        }
      }
    }
  } else {
    // Single-threaded fallback
    for (const fullfileName of filesToAnalyze) {
      const fileName = "/" + fullfileName;
      const code = fs.readFileSync(
        path.resolve(SRC_DIR, fullfileName),
        "utf-8",
      );
      let ast: File;
      try {
        ast = parseCode(code);
      } catch (e) {
        console.warn(`Skipping ${fullfileName}: ${(e as Error).message}`);
        continue;
      }

      traverseFn(ast, {
        ImportDeclaration: ImportDeclaration(componentDB, fileName),
        ExportNamedDeclaration: ExportNamedDeclaration(componentDB, fileName),
        ExportAllDeclaration: ExportAllDeclaration(componentDB, fileName),
        ExportDefaultDeclaration: ExportDefaultDeclaration(
          componentDB,
          fileName,
        ),
        FunctionDeclaration: FunctionDeclaration(componentDB, fileName),
        VariableDeclarator: VariableDeclarator(componentDB, fileName),
        ReturnStatement: ReturnStatement(componentDB, fileName),
        ArrowFunctionExpression: ArrowFunctionExpression(componentDB, fileName),
        FunctionExpression: FunctionExpression(componentDB, fileName),
        ...JSXElement(componentDB, fileName),
        CallExpression: CallExpression(componentDB, fileName),
        TSTypeAliasDeclaration: TSTypeAliasDeclaration(componentDB, fileName),
        TSInterfaceDeclaration: TSInterfaceDeclaration(componentDB, fileName),
      });

      const result = componentDB.getFile(fileName).getData();
      if (sqlite) {
        sqlite.saveFileResults(result);
      }
    }
  }

  // 3. Inter-file resolution
  componentDB.resolve();
  componentDB.resolveDependency();

  const graphData = componentDB.getData();

  // Save global edges if sqlite is used
  if (sqlite) {
    sqlite.saveEdges(graphData.edges);
  }

  return graphData;
}

export default analyzeFiles;
