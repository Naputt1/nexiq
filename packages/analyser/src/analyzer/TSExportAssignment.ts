import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";

export default function TSExportAssignment(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSExportAssignment> {
  return {
    exit(nodePath) {
      const node = nodePath.node;
      let name = "anonymous";
      if (t.isIdentifier(node.expression)) {
        name = node.expression.name;
      }
      componentDB.fileAddExport(fileName, {
        name,
        type: "default",
        exportKind: "value",
      });
    },
  };
}
