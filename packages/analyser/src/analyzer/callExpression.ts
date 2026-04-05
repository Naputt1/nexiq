import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import { ComponentDB } from "../db/componentDB.ts";
import { extractStateKeys, getStartLoc } from "./classDeclaration.ts";
import {
  isClassComponentVariable,
  isMethodVariable,
  isScope,
} from "../db/variable/type.ts";
import { Variable } from "../db/variable/variable.ts";
import { generateFn } from "../utils/babel.ts";
import {
  ReactDependency,
  VariableLoc,
  VariableScope,
} from "@nexiq/shared/component.ts";
import { getReactHookInfo } from "../utils.ts";
import assert from "assert";
import { Scope } from "../db/variable/scope.ts";

export default function CallExpression(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.CallExpression> {
  return {
    enter(nodePath) {
      const hookInfo = getReactHookInfo(nodePath.node, componentDB, fileName);
      if (hookInfo) {
        assert(nodePath.node.loc?.start != null, "Function loc not found");

        const callLoc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };

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

        if (
          hookInfo?.isReact &&
          (hookInfo.name === "useEffect" ||
            hookInfo.name === "useLayoutEffect" ||
            hookInfo.name === "useInsertionEffect")
        ) {
          const effect = nodePath.node.arguments[0];
          const dependencies = nodePath.node.arguments[1];

          let scope: VariableScope | undefined;

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
            // debugger;
          }

          const reactDeps: ReactDependency[] = [];
          if (dependencies && dependencies.type == "ArrayExpression") {
            for (const element of dependencies.elements) {
              if (element == null || !t.isExpression(element)) continue;

              const name = t.isIdentifier(element)
                ? element.name
                : generateFn(element).code;
              reactDeps.push({ id: "", name });
            }
          }

          if (scope) {
            componentDB.comAddEffect(fileName, callLoc, {
              name: hookInfo.name,
              scope,
              loc: callLoc,
              reactDeps,
            });
          }
        }

        if (compName && loc && hookInfo) {
          componentDB.comAddHook(
            hookInfo.name,
            callLoc,
            fileName,
            hookInfo.name,
          );
        }
      }

      // handle setstate for class components
      const { callee, arguments: args } = nodePath.node;

      // this.setState(...)
      if (
        t.isMemberExpression(callee) &&
        t.isThisExpression(callee.object) &&
        t.isIdentifier(callee.property, { name: "setState" }) &&
        args.length > 0
      ) {
        const file = componentDB.getFile(fileName);
        const loc = getStartLoc(callee);
        let component: Variable | Scope | undefined =
          file.var.findDeepestVariable(loc);
        if (component && isMethodVariable(component)) {
          component = component.parent;
        }

        if (
          component &&
          !isScope(component) &&
          isClassComponentVariable(component)
        ) {
          const keys = extractStateKeys(args[0], nodePath.scope);
          for (const key of keys) {
            componentDB.addStateVariable(
              fileName,
              component.id,
              key.name,
              getStartLoc(callee.property),
              key.type,
            );
          }
        }
      }
    },
  };
}
