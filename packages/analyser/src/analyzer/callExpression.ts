import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import { isHook } from "../utils.js";
import type { VariableLoc, VariableScope } from "shared";
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

    if (fn === "useEffect") {
      const effect = nodePath.node.arguments[0];
      const dependencies = nodePath.node.arguments[1];

      let scope: VariableScope | undefined;

      assert(nodePath.node.loc?.start != null, "Function loc not found");

      const effectLoc = {
        line: nodePath.node.loc.start.line,
        column: nodePath.node.loc.start.column,
      };

      if (effect && effect.type == "ArrowFunctionExpression") {
        if (effect.body.type == "BlockStatement") {
          assert(effect.body.loc != null, "Function body loc not found");

          scope = {
            start: {
              line: effect.body.loc.start.line,
              column: effect.body.loc.start.column,
            },
            end: {
              line: effect.body.loc.end.line,
              column: effect.body.loc.end.column,
            },
          };
        }
      } else {
        debugger;
      }

      const dependency: string[] = [];
      if (dependencies && dependencies.type == "ArrayExpression") {
        for (const element of dependencies.elements) {
          if (element == null) continue;

          if (element.type == "Identifier") {
            dependency.push(element.name);
          } else {
            debugger;
          }
        }
      } else {
        debugger;
      }

      if (loc && scope) {
        componentDB.comAddEffect(fileName, loc, {
          scope,
          loc: effectLoc,
          dependencies: dependency,
        });
      }
    }

    if (compName && loc && isHook(fn)) {
      componentDB.comAddHook(compName, loc, fileName, fn);
    }
  };
}
