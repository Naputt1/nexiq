import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileExport } from "shared";

export default function ExportDefaultDeclaration(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.ExportDefaultDeclaration> {
  return (nodePath) => {
    const decl = nodePath.node.declaration;

    let exportKind: ComponentFileExport["exportKind"] = "value";
    let name: string | undefined;

    if (t.isIdentifier(decl)) {
      // export default Foo;
      name = decl.name;
      exportKind = "value";
    } else if (t.isFunctionDeclaration(decl)) {
      // export default function Foo() {} or export default function() {}
      name = decl.id?.name ?? "anonymous";

      let isComponent = false;
      nodePath.traverse({
        JSXElement(innerPath) {
          isComponent = true;
          innerPath.stop();
        },
      });

      exportKind = isComponent ? "component" : "function";
    } else if (t.isClassDeclaration(decl)) {
      // export default class Foo {} or export default class {}
      name = decl.id?.name ?? "anonymous";
      exportKind = "class";
    } else if (
      t.isArrowFunctionExpression(decl) ||
      t.isFunctionExpression(decl) ||
      t.isCallExpression(decl) ||
      t.isClassExpression(decl)
    ) {
      // export default () => {}, export default call(), export default class {}
      name = "anonymous";

      // If it's an arrow/function with JSX, treat as component
      if (t.isArrowFunctionExpression(decl) || t.isFunctionExpression(decl)) {
        let isComponent = false;
        nodePath.traverse({
          JSXElement(innerPath) {
            isComponent = true;
            innerPath.stop();
          },
        });
        exportKind = isComponent ? "component" : "function";
      } else if (t.isCallExpression(decl)) {
        exportKind = "value";
      } else if (t.isClassExpression(decl)) {
        exportKind = "class";
      }
    }

    componentDB.fileAddExport(fileName, {
      name: name ?? "anonymous",
      type: "default",
      exportKind,
    });
  };
}
