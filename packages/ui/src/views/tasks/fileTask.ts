import { type DatabaseData, getDisplayName } from "shared";
import { type GraphViewResult, type GraphViewTask } from "../types";
import { type GraphComboData, type GraphNodeData } from "../../graph/hook";

/**
 * Task that groups components and hooks by their directory and file structure.
 */
export const fileTask: GraphViewTask = {
  id: "file-view",
  priority: 10,
  run: (data: DatabaseData, result: GraphViewResult, batch?: Partial<DatabaseData>): GraphViewResult => {
    const combos: GraphComboData[] = [...result.combos];
    const nodes: GraphNodeData[] = [...result.nodes];
    
    const files = batch?.files || data.files;
    const symbols = batch?.symbols || data.symbols;
    
    const createdDirs = new Set<string>();
    combos.forEach(c => { if (c.id.startsWith("dir:")) createdDirs.add(c.id.slice(4)); });

    for (const file of files) {
      const filePath = file.path;
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
      
      if (!combos.some(c => c.id === fileId)) {
        combos.push({
          id: fileId,
          label: { text: fileName },
          combo: dirPath ? `dir:/${dirPath}` : undefined,
          type: "normal",
          fileName: filePath,
          pureFileName: filePath,
          name: { type: "identifier", name: fileName, id: fileId, loc: { line: 0, column: 0 } }
        });
      }
    }

    // Add symbols (components and hooks) as nodes within the file combo
    for (const symbol of symbols) {
      if (nodes.some(n => n.id === symbol.id)) continue;

      const entity = data.entities.find(e => e.id === symbol.entity_id);
      if (!entity || (entity.kind !== 'component' && entity.kind !== 'hook')) continue;

      const scope = data.scopes.find(s => s.id === symbol.scope_id);
      if (!scope) continue;

      const file = data.files.find(f => f.id === scope.file_id);
      if (!file) continue;

      nodes.push({
        id: symbol.id,
        name: symbol.name,
        label: { text: symbol.name },
        combo: `file:${file.path}`,
        type: entity.kind,
        fileName: file.path,
        pureFileName: file.path,
        loc: { line: entity.line || 0, column: entity.column || 0 },
        radius: 20
      });
    }

    return {
      ...result,
      nodes,
      combos,
    };
  },
};
