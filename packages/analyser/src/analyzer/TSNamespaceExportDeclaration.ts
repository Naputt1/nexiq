import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";

export default function TSNamespaceExportDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSNamespaceExportDeclaration> {
  return {
    exit(nodePath) {
      componentDB.fileAddExport(fileName, {
        name: nodePath.node.id.name,
        type: "named",
        exportKind: "value",
      });
    },
  };
}
