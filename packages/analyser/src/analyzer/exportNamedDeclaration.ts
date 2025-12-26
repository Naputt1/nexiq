import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileExport } from "shared";
import assert from "assert";

export default function ExportNamedDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.ExportNamedDeclaration> {
  return (nodePath) => {
    const decl = nodePath.node.declaration;
    if (decl) {
      let name: string | undefined;

      let exportType: ComponentFileExport["type"] = "named";
      let exportKind: ComponentFileExport["exportKind"] = "value";
      if (
        decl.type === "TSTypeAliasDeclaration" ||
        decl.type === "TSInterfaceDeclaration"
      ) {
        exportKind = "type";
        exportType = "type";
        name = decl.id.name;
      } else if (decl.type === "ClassDeclaration") {
        exportKind = "class";
        name = decl.id?.name;
      } else if (decl.type === "FunctionDeclaration") {
        let isComponent = false;
        nodePath.traverse({
          JSXElement(innerPath) {
            isComponent = true;
            innerPath.stop();
          },
        });

        exportKind = isComponent ? "component" : "function";
        name = decl.id?.name;
      } else if (decl.type === "VariableDeclaration") {
        decl.declarations.forEach((declarator) => {
          if (declarator.id.type === "Identifier") {
            componentDB.fileAddExport(fileName, {
              name: declarator.id.name,
              type: "named",
              exportKind: "value",
            });
          }
        });
        return;
      }

      componentDB.fileAddExport(fileName, {
        name: name ?? "anonymous",
        type: exportType,
        exportKind,
      });
      return;
    }

    const source = nodePath.node.source?.value;
    for (const spec of nodePath.node.specifiers) {
      assert(spec.exported.type === "Identifier");

      if (source) {
        // It's a re-export
        const importedName =
          spec.type === "ExportSpecifier" && spec.local.type === "Identifier"
            ? spec.local.name
            : spec.exported.name;

        componentDB.fileAddImport(fileName, {
          localName: spec.exported.name,
          importedName: importedName,
          source: componentDB.getImportFileName(source, fileName),
          type: "named",
          importKind: "value",
        });
      }

      componentDB.fileAddExport(fileName, {
        name: spec.exported.name,
        type: "named",
        exportKind: "value",
      });
    }
  };
}
