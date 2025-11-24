import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";

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
        componentDB.comAddRender(compName, fileName, tag);
        // components[id].renders.push(tag);
        // edges.push({
        //   from: id,
        //   to: tag,
        //   label: "renders",
        // });
      }
    }
  };
}
