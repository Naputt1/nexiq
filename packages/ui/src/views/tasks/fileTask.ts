import { type JsonData, getDisplayName } from "shared";
import { type GraphViewResult, type GraphViewTask } from "../types";
import { type GraphComboData, type GraphNodeData } from "../../graph/hook";

/**
 * Task that groups components and hooks by their directory and file structure.
 */
export const fileTask: GraphViewTask = {
  id: "file-view",
  priority: 10,
  run: (graphData: JsonData, result: GraphViewResult): GraphViewResult => {
    const combos: GraphComboData[] = [];
    const nodes: GraphNodeData[] = [];
    const createdDirs = new Set<string>();

    for (const [filePath, file] of Object.entries(graphData.files)) {
      // Create folder combos
      const parts = filePath.split("/").filter(Boolean);
      let currentPath = "";
      
      // The last part is the file itself, we want to create combos for directories
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i]!;
        const parentPath = currentPath;
        currentPath = currentPath ? `${currentPath}/${part}` : `/${part}`;
        
        if (!createdDirs.has(currentPath)) {
          combos.push({
            id: `dir:${currentPath}`,
            label: { text: part },
            combo: parentPath ? `dir:${parentPath}` : undefined,
            type: "normal", // generic combo type
            fileName: currentPath,
            name: { type: "identifier", name: part, id: currentPath, loc: { line: 0, column: 0 } }
          });
          createdDirs.add(currentPath);
        }
      }

      // Create file combo
      const fileName = parts[parts.length - 1]!;
      const dirPath = parts.slice(0, -1).join("/");
      const fileId = `file:${filePath}`;
      
      combos.push({
        id: fileId,
        label: { text: fileName },
        combo: dirPath ? `dir:/${dirPath}` : undefined,
        type: "normal",
        fileName: filePath,
        pureFileName: filePath,
        name: { type: "identifier", name: fileName, id: fileId, loc: { line: 0, column: 0 } }
      });

      // Add components and hooks as nodes within the file combo
      for (const variable of Object.values(file.var)) {
        if (variable.kind === "component" || (variable.kind === "hook" && variable.type === "function")) {
          nodes.push({
            id: variable.id,
            name: variable.name,
            label: { text: getDisplayName(variable.name) },
            combo: fileId,
            type: variable.kind,
            fileName: `${graphData.src}${filePath}:${variable.loc.line}:${variable.loc.column}`,
            pureFileName: filePath,
            loc: variable.loc,
            radius: 20
          });
        }
      }
    }

    return {
      ...result,
      nodes: [...result.nodes, ...nodes],
      combos: [...result.combos, ...combos],
    };
  },
};
