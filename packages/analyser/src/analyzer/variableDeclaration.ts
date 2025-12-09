import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileVarDependency, State } from "shared";
import { containsJSX } from "../utils.js";
import assert from "assert";
import { getVariableComponentName } from "../variable.js";

function getParentPath(nodePath: traverse.NodePath<t.VariableDeclarator>) {
  const parentPath: string[] = [];
  let path: traverse.NodePath<t.Node> = nodePath;
  while (true) {
    if (path.scope.block.type === "Program") {
      break;
    }

    if (path.scope.block.type === "FunctionDeclaration") {
      if (path.scope.block.id?.type === "Identifier") {
        parentPath.push(path.scope.block.id.name);
      }
    } else if (path.scope.block.type === "ArrowFunctionExpression") {
      if (path.scope.parentBlock.type == "VariableDeclarator") {
        if (path.scope.parentBlock.id.type === "Identifier") {
          parentPath.push(path.scope.parentBlock.id.name);
        }
      }
    }

    path = path.scope.parent.path;
  }

  // debugger;

  return parentPath;
}

export default function VariableDeclarator(
  componentDB: ComponentDB,
  fileName: string
): traverse.VisitNode<traverse.Node, t.VariableDeclarator> {
  return (nodePath) => {
    const id = nodePath.node.id;
    const init = nodePath.node.init;
    assert(nodePath.node.id?.loc?.start != null);

    const loc = {
      line: nodePath.node.id.loc.start.line,
      column: nodePath.node.id.loc.start.column,
    };

    if (t.isCallExpression(init)) {
      const firstArg = init.arguments[0];
      const firstArgPath = nodePath.get("init").get("arguments")[0];

      if (
        (t.isArrowFunctionExpression(firstArgPath?.node) ||
          t.isFunctionExpression(firstArgPath?.node)) &&
        containsJSX(firstArgPath)
      ) {
        if (id.type == "Identifier") {
          componentDB.addComponent({
            name: id.name,
            file: fileName,
            type: "Function",
            states: [],
            hooks: [],
            props: [],
            contexts: [],
            renders: {},
            dependencies: {},
            var: {},
            loc,
          });
          return;
        }
      } else if (
        t.isIdentifier(init.callee) &&
        init.callee.name === "useState"
      ) {
        const id = nodePath.node.id;

        if (t.isArrayPattern(id)) {
          const [stateVar, setterVar] = id.elements;
          assert(id.loc?.start != null);

          let state: State | null = null;
          if (t.isIdentifier(stateVar)) {
            state = {
              value: stateVar.name,
              loc: {
                line: id.loc.start.line,
                column: id.loc.start.column,
              },
            };
          }
          // TODO: handle ObjectPattern
          // const [{ previous, current }, setMemory] = useState<{

          if (t.isIdentifier(setterVar)) {
            if (state == null) {
              state = {
                value: "ObjectPattern",
                setter: setterVar.name,
                loc,
              };
            } else {
              state.setter = setterVar.name;
            }
          }

          if (state != null) {
            const name = getVariableComponentName(nodePath);

            if (name) {
              componentDB.comAddState(name, fileName, state);
            }
          }
        }
      }
    }

    if (id.type !== "Identifier") return;

    const name = id.name;

    if (
      !(
        !init ||
        (init.type !== "ArrowFunctionExpression" &&
          init.type !== "FunctionExpression")
      ) &&
      containsJSX(nodePath)
    ) {
      componentDB.addComponent({
        name,
        file: fileName,
        type: "Function",
        states: [],
        hooks: [],
        props: [],
        contexts: [],
        renders: {},
        dependencies: {},
        var: {},
        loc,
      });
    } else {
      if (nodePath.scope.block.type === "Program") {
        const dependencies: Record<string, ComponentFileVarDependency> = {};
        if (init?.type === "NewExpression") {
          if (init.callee.type === "Identifier") {
            const id = crypto.randomUUID();
            dependencies[id] = {
              id,
              name: init.callee.name,
            };
          }
        } else if (init?.type === "Identifier") {
          const id = crypto.randomUUID();
          dependencies[id] = {
            id,
            name: init.name,
          };
        }

        if (name === "AppRouters") {
          debugger;
        }

        componentDB.addVariable(fileName, {
          name,
          dependencies,
          type: "data",
          loc,
        });
      } else {
        if (
          nodePath.scope.block.type === "FunctionDeclaration" &&
          nodePath.scope.block.id?.type === "Identifier"
        ) {
          const parentPath = getParentPath(nodePath);

          if (name === "AppRouters") {
            debugger;
          }

          componentDB.addVariable(
            fileName,
            {
              name,
              dependencies: {},
              type: "data",
              loc,
            },
            parentPath
          );
        } else if (nodePath.scope.block.type === "ArrowFunctionExpression") {
          if (name === "AppRouters") {
            debugger;
          }

          const parentPath = getParentPath(nodePath);
          componentDB.addVariable(
            fileName,
            {
              name,
              dependencies: {},
              type: "function",
              loc,
            },
            parentPath
          );
        }
      }
    }
  };
}
