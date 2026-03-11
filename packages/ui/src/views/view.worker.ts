import { type DatabaseData } from "shared";
import { type GraphViewType } from "../../electron/types";
import { type GraphViewResult, type ViewWorkerResponse } from "./types";
import { getTasksForView, getRegistry } from "./registry";

export type ViewWorkerRequest = {
  type: GraphViewType | "DEBUG_GET_REGISTRY";
  data: DatabaseData;
};

export type ViewWorkerRegistryResponse = {
  type: "DEBUG_REGISTRY";
  registry: Record<string, { id: string; priority: number }[]>;
};

self.onmessage = async (e: MessageEvent<ViewWorkerRequest>) => {
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

  const tasks = getTasksForView(type);
  const BATCH_SIZE = 100;
  
  // Process entities in batches
  for (let i = 0; i < data.entities.length; i += BATCH_SIZE) {
    const entityBatch = data.entities.slice(i, i + BATCH_SIZE);
    const symbolBatch = data.symbols.filter(s => entityBatch.some(e => e.id === s.entity_id));
    const renderBatch = data.renders.filter(r => entityBatch.some(e => e.id === r.parent_entity_id));
    
    const batch: Partial<DatabaseData> = {
        entities: entityBatch,
        symbols: symbolBatch,
        renders: renderBatch,
        scopes: data.scopes.filter(s => entityBatch.some(e => e.scope_id === s.id) || entityBatch.some(e => e.id === s.entity_id)),
        relations: data.relations.filter(r => symbolBatch.some(s => s.id === r.from_id || s.id === r.to_id)),
    };

    for (const task of tasks) {
      try {
        result = task.run(data, result, batch);
      } catch (err) {
        console.error(`Task "${task.id}" failed:`, err);
      }
    }

    // Send incremental result
    self.postMessage({ result, isIncremental: true } as ViewWorkerResponse & { isIncremental: boolean });
    
    // Allow UI thread to breathe
    await new Promise(resolve => setTimeout(resolve, 0));
  }

  // Final message
  self.postMessage({ result, done: true } as ViewWorkerResponse & { done: boolean });
};
