import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentInfoRenderDependency } from "shared";
import assert from "assert";

export default function JSXElement(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.JSXElement> {
  return (nodePath) => {
    const opening = nodePath.node.openingElement.name;
    if (opening.type === "JSXIdentifier") {
      const tag = opening.name;
      const parentFunc = nodePath.getFunctionParent();

      let compName = null;

      assert(nodePath.node.loc?.start != null);
      const loc = {
        line: nodePath.node.loc.start.line,
        column: nodePath.node.loc.start.column,
      };

      if (parentFunc?.node.type === "FunctionDeclaration") {
        // function MyComponent() {}
        compName = parentFunc.node.id?.name;
      } else if (
        parentFunc?.node.type === "ArrowFunctionExpression" ||
        parentFunc?.node.type === "FunctionExpression"
      ) {
        // const MyComponent = () => {}
        const parent = parentFunc.parentPath?.node;
        if (parent?.type === "VariableDeclarator") {
          const id = parent.id;

          if (id.type === "Identifier") {
            compName = id.name;
          }
        }
      } else {
        compName = parentFunc?.node.type;
      }

      if (compName == null) {
        return;
      }

      // TODO: handle ObjectMethod
      if (compName == "ObjectMethod") {
        return;
      }

      // const key = getComponentKey(compName, file);
      // let id = componentIds.get(key);

      // if (id == null) {
      //   id = crypto.randomUUID();
      //   componentIds.set(key, id);
      // }

      if (/^[A-Z]/.test(tag)) {
        const dependency: ComponentInfoRenderDependency[] = [];
        for (const prop of nodePath.node.openingElement.attributes) {
          if (
            prop.type === "JSXAttribute" &&
            prop.name.type === "JSXIdentifier"
          ) {
            let value = "";
            if (
              prop.value?.type === "JSXExpressionContainer" &&
              prop.value.expression.type === "Identifier"
            ) {
              value = prop.value.expression.name;
            }

            dependency.push({
              id: prop.name.name,
              value: value,
            });
          }
        }

        componentDB.comAddRender(compName, fileName, tag, dependency, loc);
      }
    }
  };
}
