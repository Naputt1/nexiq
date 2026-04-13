import { createRequire } from "node:module";
import type { GraphViewTask, TaskContext } from "@nexiq/extension-sdk";

const require = createRequire(import.meta.url);
const { runComponentTask } = require("../index.cjs");

export const componentRustTask: GraphViewTask = {
  id: "component-structure-rust",
  priority: 10,
  // The UI Electron view-generator checks for runBuffer
  runBuffer: (nodeDataBuffer: SharedArrayBuffer, detailBuffer: SharedArrayBuffer, context: TaskContext) => {
    
    // Convert SharedArrayBuffers into Node.js Buffers which NAPI-RS strictly expects
    const nodeBuffer = Buffer.from(nodeDataBuffer);
    const detailBuf = Buffer.from(detailBuffer);
    
    const napiContext = {
      projectRoot: context.projectRoot || "",
      // NAPI-RS auto camel-cases the rust `sqlite_path` snake case props
      sqlitePath: (context.db as any)?.name || context.analysisPaths?.[0] || "",
      viewType: context.viewType || "component"
    };

    // This dives directly into the rust `lib.rs` > `run_component_task` execution
    return runComponentTask(nodeBuffer, detailBuf, napiContext);
  }
};
