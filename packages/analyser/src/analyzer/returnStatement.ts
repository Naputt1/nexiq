import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { isJSXVariable } from "../db/variable/type.ts";
import { getExpressionData } from "./type/helper.ts";

export default function ReturnStatement(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ReturnStatement> {
  return {
    exit(nodePath) {
      const arg = nodePath.node.argument;
      if (!arg) return;

      const loc = {
        line: nodePath.node.loc!.start.line,
        column: nodePath.node.loc!.start.column,
      };

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
      } else if (
        t.isArrowFunctionExpression(arg) ||
        t.isFunctionExpression(arg)
      ) {
        if (arg.loc) {
          const id = componentDB.getVariableIDFromLoc(fileName, {
            line: arg.loc.start.line,
            column: arg.loc.start.column,
          });
          if (id) {
            componentDB.comSetReturn(fileName, loc, id);
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
