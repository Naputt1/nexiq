import { type JsonData } from "shared";
import { type GraphViewType } from "../../electron/types";
import { type GraphViewResult, type ViewWorkerResponse } from "./types";
import { getTasksForView, getRegistry } from "./registry";

export type ViewWorkerRequest = {
  type: GraphViewType | "DEBUG_GET_REGISTRY";
  data: JsonData;
};

export type ViewWorkerRegistryResponse = {
  type: "DEBUG_REGISTRY";
  registry: Record<string, { id: string; priority: number }[]>;
};

self.onmessage = (e: MessageEvent<ViewWorkerRequest>) => {
  const { type, data } = e.data;

  if (type === "DEBUG_GET_REGISTRY") {
    const registry = getRegistry();
    const serializedRegistry: Record<
      string,
      { id: string; priority: number }[]
    > = {};
    for (const [view, tasks] of Object.entries(registry)) {
      serializedRegistry[view] = tasks.map((t) => ({
        id: t.id,
        priority: t.priority,
      }));
    }
    self.postMessage({
      type: "DEBUG_REGISTRY",
      registry: serializedRegistry,
    } as ViewWorkerRegistryResponse);
    return;
  }

  // Initialize empty result
  let result: GraphViewResult = {
    nodes: [],
    edges: [],
    combos: [],
    typeData: {},
  };

  // Get and run tasks for the requested view
  const tasks = getTasksForView(type);
  for (const task of tasks) {
    console.log("Running task", task.id);
    result = task.run(data, result);
  }

  // Clean up raw data before serialization to prevent loops
  result.nodes.forEach((n) => delete n.raw);
  result.combos.forEach((c) => delete c.raw);

  self.postMessage({ result } as ViewWorkerResponse);
};
