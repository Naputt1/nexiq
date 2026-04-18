import { type Extension } from "@nexiq/extension-sdk";
import { fileTask } from "./fileTask.js";
import { packageTask } from "./packageTask.js";

export * from "./fileTask.js";
export * from "./packageTask.js";

export const fileExtension: Extension = {
  id: "file-extension",
  viewTasks: {
    component: [fileTask],
    file: [fileTask],
    package: [packageTask],
  },
};
