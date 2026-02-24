import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";

export default function FunctionExpression(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.FunctionExpression> {
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

        // Handle wrapped calls like useCallback(debounce(function() ...))
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
  };
}
