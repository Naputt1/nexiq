import { type GraphViewType } from "../../electron/types";
import { type GraphViewTask } from "./types";
import { componentTask, gitTask } from "@react-map/extension-sdk";
import { fileTask } from "./tasks/fileTask";
import { allExtensions } from "./tasks/all-tasks";

const registry: Record<string, GraphViewTask[]> = {
  component: [componentTask, gitTask],
  file: [fileTask, gitTask],
  router: [gitTask], // Default to gitTask for router too
};

// Automatically register tasks from all extensions
for (const extension of allExtensions) {
  if (extension.viewTasks) {
    for (const [view, tasks] of Object.entries(extension.viewTasks)) {
      for (const task of tasks) {
        const viewType = view as GraphViewType;
        if (!registry[viewType]) {
          registry[viewType] = [];
        }
        // Check if task already registered
        if (!registry[viewType].some((t) => t.id === task.id)) {
          registry[viewType].push(task);
        }
      }
    }
  }
}

/**
 * Returns a prioritized list of tasks for a given view type.
 */
export function getTasksForView(view: GraphViewType): GraphViewTask[] {
  const tasks = registry[view] || [];
  return [...tasks].sort((a, b) => a.priority - b.priority);
}

/**
 * Allows extensions or other modules to register new tasks dynamically.
 */
export function registerTask(view: GraphViewType, task: GraphViewTask) {
  if (!registry[view]) {
    registry[view] = [];
  }
  // Check if task already registered
  if (registry[view].some((t) => t.id === task.id)) return;

  registry[view].push(task);
}

/**
 * Returns the entire registry for debugging.
 */
export function getRegistry() {
  return registry;
}
