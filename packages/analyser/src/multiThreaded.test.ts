import { describe, it, expect } from "vitest";
import { analyzeProject } from "./index.ts";
import path from "path";
import fs from "fs";
import type { SnapshotData } from "./types/test.ts";
import { JsonData } from "@nexiq/shared";
import { deepSort } from "./utils/sort.ts";

describe("analyser multi-threaded consistency", () => {
  const normalize = (graph: JsonData): JsonData => {
    const result = JSON.parse(JSON.stringify(graph));
    delete result.src;

    if (result.files) {
      for (const file of Object.values(result.files as any[])) {
        delete file.fingerPrint;
      }
      result.files = deepSort(result.files);
    }

    if (result.edges) {
      result.edges.sort((a: any, b: any) => {
        return (
          a.from.localeCompare(b.from) ||
          a.to.localeCompare(b.to) ||
          a.label.localeCompare(b.label)
        );
      });
    }

    if (result.resolve) {
      result.resolve.sort((a: any, b: any) => {
        return (
          (a.type || "").localeCompare(b.type || "") ||
          (a.fileName || "").localeCompare(b.fileName || "") ||
          (a.id || "").localeCompare(b.id || "") ||
          (a.tag || "").localeCompare(b.tag || "")
        );
      });
    }

    return result;
  };

  const projects = [
    "simple",
    "complex",
    "props",
    "hook",
    "props-complex",
    "destructuring-hook",
    "jsx-variable",
    "forward-ref",
    "destructured-export",
    "ts-method-signature",
    "class-components",
    "props-dot-dependency",
    "async-functions",
    "gaps",
  ];

  projects.forEach((projectName) => {
    it(`should be consistent and match snapshot for ${projectName}`, async () => {
      const projectPath = path.resolve(
        process.cwd(),
        `../sample-project/${projectName}`,
      );

      // 1. Run single-threaded (threads: 1)
      const singleThreadedGraph = await analyzeProject(projectPath, {
        fileWorkerThreads: 1,
      });

      // 2. Run multi-threaded (threads: 2)
      const multiThreadedGraph = await analyzeProject(projectPath, {
        fileWorkerThreads: 2,
      });

      const normalizedSingle = normalize(singleThreadedGraph);
      const normalizedMulti = normalize(multiThreadedGraph);

      // Verify consistency with deep comparison
      try {
        expect(normalizedMulti).toEqual(normalizedSingle);
      } catch (err) {
        // Find which file is different
        for (const [path, fileSingle] of Object.entries(
          normalizedSingle.files,
        )) {
          const fileMulti = normalizedMulti.files[path];
          if (JSON.stringify(fileSingle) !== JSON.stringify(fileMulti)) {
            console.error(`Mismatch in file: ${path}`);
            // Check top-level variables
            const varsSingle = fileSingle.var;
            const varsMulti = fileMulti?.var;
            if (varsSingle && varsMulti) {
              for (const [id, varSingle] of Object.entries(varsSingle)) {
                const varMulti = varsMulti?.[id];
                if (JSON.stringify(varSingle) !== JSON.stringify(varMulti)) {
                  console.error(`- Mismatch in variable ID: ${id}`);
                  console.error(
                    `  - Expected:`,
                    JSON.stringify(varSingle, null, 2),
                  );
                  console.error(
                    `  - Actual:  `,
                    JSON.stringify(varMulti, null, 2),
                  );
                }
              }
            }
          }
        }
        throw err;
      }

      // Multi-threaded output should also match the stored snapshot.
      const snapshotPath = path.resolve(
        process.cwd(),
        `test/snapshots/${projectName}.json`,
      );
      if (fs.existsSync(snapshotPath)) {
        const snapshotData: SnapshotData = JSON.parse(
          fs.readFileSync(snapshotPath, "utf-8"),
        );
        expect(normalizedMulti).toEqual(normalize(snapshotData as any));
      }

      // Specifically verify class props if it's the 'class-components' project
      if (projectName === "class-components") {
        const file = multiThreadedGraph.files["/src/SimpleClass.tsx"];
        expect(file).toBeDefined();

        // Find the class component
        const classComp = Object.values(file!.var).find(
          (v) => v.name.type === "identifier" && v.name.name === "SimpleClass",
        );
        expect(classComp).toBeDefined();
        expect(classComp?.kind).toBe("component");
        expect(classComp?.type).toBe("class");

        // Verify props are not empty (it was failing here before)
        const props = (classComp as any).props;
        expect(props).toBeDefined();
        expect(props.length).toBeGreaterThan(0);

        // Find the render method inside the class
        const renderMethod = Object.values((classComp as any).var).find(
          (v: any) => v.name.type === "identifier" && v.name.name === "render",
        );
        expect(renderMethod).toBeDefined();

        // Verify renders are present in the global edges
        const renderEdges = multiThreadedGraph.edges.filter(
          (e) =>
            (e.from === (renderMethod as any).id || e.from === classComp!.id) &&
            e.label === "render",
        );
        expect(renderEdges.length).toBeGreaterThan(0);
      }
    });
  });

  // The worker pool is only engaged for projects with >=150 files, so the
  // consistency tests above never exercise it. Force the thresholds down so a
  // real worker run is compared against the single-threaded in-place path.
  // NOTE: the file data (scopes, vars, renders) is the primary contract and is
  // compared here; the edge list still has a pre-existing worker-path duplicate
  // issue that is tracked separately.
  it("should be consistent when the worker pool is forced", async () => {
    const prevMinFiles = process.env["NEXIQ_MIN_FILES_FOR_WORKERS"];
    const prevMinPerWorker = process.env["NEXIQ_MIN_FILES_PER_WORKER"];
    process.env["NEXIQ_MIN_FILES_FOR_WORKERS"] = "1";
    process.env["NEXIQ_MIN_FILES_PER_WORKER"] = "1";
    try {
      const projectPath = path.resolve(
        process.cwd(),
        `../sample-project/complex`,
      );

      const singleThreadedGraph = await analyzeProject(projectPath, {
        fileWorkerThreads: 1,
      });
      const multiThreadedGraph = await analyzeProject(projectPath, {
        fileWorkerThreads: 4,
      });

      expect(normalize(multiThreadedGraph).files).toEqual(
        normalize(singleThreadedGraph).files,
      );
    } finally {
      if (prevMinFiles === undefined) {
        delete process.env["NEXIQ_MIN_FILES_FOR_WORKERS"];
      } else {
        process.env["NEXIQ_MIN_FILES_FOR_WORKERS"] = prevMinFiles;
      }
      if (prevMinPerWorker === undefined) {
        delete process.env["NEXIQ_MIN_FILES_PER_WORKER"];
      } else {
        process.env["NEXIQ_MIN_FILES_PER_WORKER"] = prevMinPerWorker;
      }
    }
  }, 30000);
});
