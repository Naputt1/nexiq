import { createRequire } from "node:module";
import type { GraphViewTask, TaskContext } from "@nexiq/extension-sdk";

const require = createRequire(import.meta.url);
const { runComponentTaskSqlite } = require("../index.cjs");

export const componentTask: GraphViewTask = {
  id: "component-structure",
  priority: 10,
  runSqlite: (context: TaskContext) => {
    if (!context.db) return;

    const napiContext = {
      projectRoot: context.projectRoot || "",
      viewType: context.viewType || "component",
      cacheDbPath: context.cacheDbPath,
    };

    // This calls into rust lib.rs > run_component_task_sqlite
    const resultBuffer = runComponentTaskSqlite(napiContext);

    // Update the in-memory DB with the modified buffer from Rust
    if (resultBuffer) {
      return resultBuffer;
    }
  },
};

export const componentRustTask = componentTask;
