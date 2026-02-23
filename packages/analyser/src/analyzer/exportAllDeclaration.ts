import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";

export default function ExportAllDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ExportAllDeclaration> {
  return (nodePath) => {
    const source = componentDB.getImportFileName(
      nodePath.node.source.value,
      fileName,
    );

    componentDB.fileAddStarExport(fileName, source);
  };
}
