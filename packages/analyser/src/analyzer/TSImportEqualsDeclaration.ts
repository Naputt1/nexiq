import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";

export default function TSImportEqualsDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.TSImportEqualsDeclaration> {
  return {
    enter(nodePath) {
      const node = nodePath.node;
      const source = t.isTSExternalModuleReference(node.moduleReference)
        ? node.moduleReference.expression.value
        : node.moduleReference.type === "TSQualifiedName"
          ? node.moduleReference.left.name + "." + node.moduleReference.right.name
          : undefined;

      if (source) {
        componentDB.fileAddImport(fileName, {
          localName: node.id.name,
          importedName: null,
          source: componentDB.getImportFileName(source, fileName),
          type: "default",
          importKind: "value",
        });
      }
    },
  };
}
