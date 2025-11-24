import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isHook } from "../utils.js";

export default function CallExpression(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.CallExpression> {
  return (nodePath) => {
    const callee = nodePath.node.callee;
    if (callee.type !== "Identifier") return;

    const fn = callee.name;
    const parentFunc = nodePath.getFunctionParent();
    let compName: string | undefined;
    if (parentFunc?.node.type === "FunctionDeclaration") {
      compName = parentFunc.node.id?.name;
    } else if (
      parentFunc?.node.type === "ArrowFunctionExpression" ||
      parentFunc?.node.type === "FunctionExpression"
    ) {
      const bindingPath = parentFunc.parentPath;
      if (bindingPath.isVariableDeclarator()) {
        if (bindingPath.node.id.type === "Identifier") {
          compName = bindingPath.node.id.name;
        }
      } else if (bindingPath.isAssignmentExpression()) {
        if (bindingPath.node.left.type === "Identifier") {
          compName = bindingPath.node.left.name;
        }
      }
    }

    // if (!compName || !components[compName]) return;

    // if (fn === "useState" || fn === "useReducer") {
    //   components[compName].states.push(fn);
    // }

    // if (fn === "useContext") {
    //   components[compName].contexts.push(fn);
    // }

    if (compName && isHook(fn) && fn === "useWindowDimensions") {
      componentDB.comAddHook(compName, fileName, fn);
    }
  };
}
