import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isJSXVariable } from "../db/variable/type.js";
import { getExpressionData } from "./type/helper.js";

export default function ArrowFunctionExpression(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ArrowFunctionExpression> {
  return {
    enter(nodePath) {
      if (nodePath.parentPath.isVariableDeclarator()) return;
      if (nodePath.parentPath.isCallExpression()) {
        const callee = nodePath.parentPath.node.callee;
        if (
          t.isIdentifier(callee) &&
          (callee.name === "useCallback" ||
            callee.name === "useMemo" ||
            callee.name === "useEffect")
        ) {
          return;
        }

        // Handle wrapped calls like useCallback(debounce(() => ...))
        const parentCall = nodePath.parentPath;
        if (parentCall.parentPath.isCallExpression()) {
          const grandCallee = parentCall.parentPath.node.callee;
          if (
            t.isIdentifier(grandCallee) &&
            grandCallee.name === "useCallback"
          ) {
            return;
          }
        }
      }

      const loc = {
        line: nodePath.node.loc!.start.line,
        column: nodePath.node.loc!.start.column,
      };

      componentDB.addVariable(
        fileName,
        {
          name: {
            type: "identifier",
            name: `anonymous@${loc.line}:${loc.column}`,
            loc: loc,
            id: "",
          },
          type: "function",
          loc: loc,
          scope: {
            start: {
              line: nodePath.node.loc!.start.line,
              column: nodePath.node.loc!.start.column,
            },
            end: {
              line: nodePath.node.loc!.end.line,
              column: nodePath.node.loc!.end.column,
            },
          },
          dependencies: {},
        },
        undefined,
      );
    },
    exit(nodePath) {
      const body = nodePath.node.body;
      if (body.type === "BlockStatement") return;

      const loc = {
        line: body.loc!.start.line,
        column: body.loc!.start.column,
      };

      if (t.isJSXElement(body) || t.isJSXFragment(body)) {
        if (body.loc) {
          const jsxVar = componentDB.getVariableFromLoc(fileName, {
            line: body.loc.start.line,
            column: body.loc.start.column,
          });
          if (jsxVar && isJSXVariable(jsxVar)) {
            componentDB.comSetReturn(fileName, loc, jsxVar.id);
          }
        }
      } else if (
        t.isArrowFunctionExpression(body) ||
        t.isFunctionExpression(body)
      ) {
        const innerLoc = {
          line: body.loc!.start.line,
          column: body.loc!.start.column,
        };

        const id = componentDB.addVariable(
          fileName,
          {
            name: {
              type: "identifier",
              name: `anonymous@${innerLoc.line}:${innerLoc.column}`,
              loc: innerLoc,
              id: "",
            },
            type: "function",
            loc: innerLoc,
            scope: {
              start: {
                line: body.loc!.start.line,
                column: body.loc!.start.column,
              },
              end: {
                line: body.loc!.end.line,
                column: body.loc!.end.column,
              },
            },
            dependencies: {},
          },
          undefined,
        );
        componentDB.comSetReturn(fileName, loc, id);
      } else if (t.isExpression(body)) {
        const data = getExpressionData(body);
        if (data) {
          // Use a location strictly inside the function to find the right parent
          const bodyLoc = {
            line: body.loc!.start.line,
            column: body.loc!.start.column,
          };
          componentDB.comSetReturn(fileName, bodyLoc, data);
        }
      }
    },
  };
}
