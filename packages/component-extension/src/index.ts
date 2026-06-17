import type { Extension } from "@nexiq/extension-sdk";
import { componentTask } from "./rustTask.js";

export * from "./rustTask.js";

export const componentExtension: Extension = {
  id: "component-extension",
  viewTasks: {
    component: [componentTask],
    file: [componentTask],
  },
};

export default componentExtension;
