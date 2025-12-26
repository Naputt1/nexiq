import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isHook } from "../utils.js";
import type { VariableLoc } from "shared";
import assert from "assert";

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
    let loc: VariableLoc | undefined;
    if (parentFunc?.node.type === "FunctionDeclaration") {
      const start = parentFunc.node.id?.loc?.start;
      assert(start != null);

      compName = parentFunc.node.id?.name;
      loc = {
        line: start.line,
        column: start.column,
      };
    } else if (
      parentFunc?.node.type === "ArrowFunctionExpression" ||
      parentFunc?.node.type === "FunctionExpression"
    ) {
      const bindingPath = parentFunc.parentPath;
      if (bindingPath.isVariableDeclarator()) {
        if (bindingPath.node.id.type === "Identifier") {
          const start = bindingPath.node.id?.loc?.start;
          assert(start != null);

          compName = bindingPath.node.id.name;
          loc = {
            line: start.line,
            column: start.column,
          };
        }
      } else if (bindingPath.isAssignmentExpression()) {
        if (bindingPath.node.left.type === "Identifier") {
          // const start = bindingPath.node.left.name?.loc?.start;
          // assert(start != null);

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

    // if (fn === "useEffect" || fn === "useLayoutEffect") {
    //   debugger;
    // }

    if (compName && loc && isHook(fn)) {
      componentDB.comAddHook(compName, loc, fileName, fn);
    }
  };
}
