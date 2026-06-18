import type { Extension } from "@nexiq/extension-sdk";
import { exampleTask } from "./exampleTask.js";

export const exampleExtension: Extension = {
  id: "example-extension",
  viewTasks: {
    component: [exampleTask],
  },
  nodeTypes: {
    customType: { color: "#8b5cf6", radius: 14 },
  },
};

export default exampleExtension;
