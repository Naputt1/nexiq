import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";

export default function ExportAllDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.ExportAllDeclaration> {
  return (nodePath) => {
    const source = componentDB.getImportFileName(
      nodePath.node.source.value,
      fileName
    );
    
    // We don't know the names being exported here without analyzing the source file,
    // but the analyzer should probably handle this by tagging the file as having a star export.
    // For now, these are harder to resolve statically without multi-pass or recursive file analysis.
    // However, we can at least record that this file depends on the source.
  };
}
