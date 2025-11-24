import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";

export default function ImportDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.ImportDeclaration> {
  return (nodePath) => {
    const source = componentDB.getImportFileName(
      nodePath.node.source.value,
      fileName
    );

    const importKind: "value" | "type" =
      nodePath.node.importKind === "type" ? "type" : "value";

    nodePath.node.specifiers.forEach((spec) => {
      if (t.isImportDefaultSpecifier(spec)) {
        componentDB.fileAddImport(fileName, {
          localName: spec.local.name,
          importedName: null,
          source,
          type: "default",
          importKind,
        });
      } else if (t.isImportSpecifier(spec)) {
        let importedName: string | null = null;
        if (t.isIdentifier(spec.imported)) {
          importedName = spec.imported.name;
        } else if (t.isStringLiteral(spec.imported)) {
          importedName = spec.imported.value;
        }

        componentDB.fileAddImport(fileName, {
          localName: spec.local.name,
          importedName,
          source,
          type: "named",
          importKind,
        });
      } else if (t.isImportNamespaceSpecifier(spec)) {
        componentDB.fileAddImport(fileName, {
          localName: spec.local.name,
          importedName: "*",
          source,
          type: "namespace",
          importKind,
        });
      }
    });
  };
}
