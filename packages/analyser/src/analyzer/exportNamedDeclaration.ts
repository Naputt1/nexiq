import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileExport } from "@nexu/shared";
import assert from "assert";
import { getPattern, getPatternIdentifiers } from "./pattern.js";

export default function ExportNamedDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ExportNamedDeclaration> {
  return {
    exit(nodePath) {
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
          const pattern = getPattern(declarator.id);
          const identifiers = getPatternIdentifiers(pattern);
          for (const ident of identifiers) {
            componentDB.fileAddExport(fileName, {
              name: ident.name,
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
  },
};
}
