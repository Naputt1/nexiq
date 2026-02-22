import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isJSXVariable } from "../db/variable/type.js";
import { getExpressionData } from "./type/helper.js";

export default function ReturnStatement(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ReturnStatement> {
  return {
    exit(nodePath) {
      const arg = nodePath.node.argument;
      if (!arg) return;

      const parentFunc = nodePath.getFunctionParent();
      if (!parentFunc) return;

      let loc: { line: number; column: number } | undefined;

      if (parentFunc.node.type === "FunctionDeclaration") {
        if (parentFunc.node.id?.loc) {
          loc = {
            line: parentFunc.node.id.loc.start.line,
            column: parentFunc.node.id.loc.start.column,
          };
        }
      } else if (
        parentFunc.node.type === "ArrowFunctionExpression" ||
        parentFunc.node.type === "FunctionExpression"
      ) {
        if (parentFunc.parentPath.isVariableDeclarator()) {
          const id = parentFunc.parentPath.node.id;
          if (id.loc) {
            loc = {
              line: id.loc.start.line,
              column: id.loc.start.column,
            };
          }
        }
      }

      if (!loc) return;

      if (t.isJSXElement(arg) || t.isJSXFragment(arg)) {
        if (arg.loc) {
          const jsxVar = componentDB.getVariableFromLoc(fileName, {
            line: arg.loc.start.line,
            column: arg.loc.start.column,
          });
          if (jsxVar && isJSXVariable(jsxVar)) {
            componentDB.comSetReturn(fileName, loc, jsxVar.id);
          }
        }
      } else if (t.isExpression(arg)) {
        const data = getExpressionData(arg);
        if (data) {
          componentDB.comSetReturn(fileName, loc, data);
        }
      }
    },
  };
}
