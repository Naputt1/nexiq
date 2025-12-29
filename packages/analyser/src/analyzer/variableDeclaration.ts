import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentFileVarDependency, State } from "shared";
import { isHook, returnJSX } from "../utils.js";
import assert from "assert";
import { getVariableComponentName } from "../variable.js";
import { newUUID } from "../utils/uuid.js";

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

  return parentPath;
}

function getVariableComponent(
  nodes: Array<traverse.Node | null>,
  _components?: Set<string>
) {
  const components = _components ?? new Set<string>();

  for (const node of nodes) {
    if (node == null) continue;

    if (node.type === "ArrayExpression") {
      getVariableComponent(node.elements, components);
    } else if (node.type === "ObjectExpression") {
      getVariableComponent(node.properties, components);
    } else if (node.type === "ObjectProperty") {
      if (node.value.type === "JSXElement") {
        if (node.value.openingElement.name.type === "JSXIdentifier") {
          components.add(node.value.openingElement.name.name);
        }
      }
    }
    if (node.type === "JSXElement") {
      if (node.openingElement.name.type === "JSXIdentifier") {
        components.add(node.openingElement.name.name);
      }
    }
  }

  return components;
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

    const scope = {
      start: {
        line: nodePath.node.id.loc.start.line,
        column: nodePath.node.id.loc.start.column,
      },
      end: {
        line: nodePath.node.id.loc.end.line,
        column: nodePath.node.id.loc.end.column,
      },
    };

    if (t.isCallExpression(init)) {
      const firstArg = init.arguments[0];
      const firstArgPath = nodePath.get("init").get("arguments")[0];

      if (
        (t.isArrowFunctionExpression(firstArgPath?.node) ||
          t.isFunctionExpression(firstArgPath?.node)) &&
        returnJSX(firstArgPath.node)
      ) {
        if (id.type == "Identifier") {
          const parentPath = getParentPath(nodePath);
          componentDB.addComponent(
            {
              name: id.name,
              file: fileName,
              type: "function",
              componentType: "Function",
              states: {},
              hooks: [],
              props: [],
              contexts: [],
              renders: {},
              dependencies: {},
              var: {},
              effects: {},
              loc,
              scope,
            },
            parentPath
          );
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

          let state: Omit<State, "id"> | null = null;
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
              componentDB.comAddState(name.name, name.loc, fileName, state);
            }
          }
        }
      }
    }

    if (id.type !== "Identifier") return;

    const name = id.name;

    if (
      init &&
      (init.type === "JSXElement" ||
        (!(
          init.type !== "ArrowFunctionExpression" &&
          init.type !== "FunctionExpression"
        ) &&
          returnJSX(init)))
    ) {
      const parentPath = getParentPath(nodePath);
      componentDB.addComponent(
        {
          name,
          file: fileName,
          type: "function",
          componentType: "Function",
          states: {},
          hooks: [],
          props: [],
          contexts: [],
          renders: {},
          dependencies: {},
          var: {},
          effects: {},
          loc,
          scope,
        },
        parentPath
      );
    } else {
      if (nodePath.scope.block.type === "Program") {
        if (init?.type === "ArrowFunctionExpression") {
          assert(init.body.loc != null, "Function body loc not found");

          const scope = {
            start: {
              line: init.body.loc.start.line,
              column: init.body.loc.start.column,
            },
            end: {
              line: init.body.loc.end.line,
              column: init.body.loc.end.column,
            },
          };

          if (isHook(name)) {
            componentDB.addHook({
              file: fileName,
              name,
              type: "function",
              dependencies: {},
              loc,
              scope,
              states: {},
              props: [],
              effects: {},
              hooks: [],
            });
          } else {
            componentDB.addVariable(fileName, {
              name,
              type: "function",
              dependencies: {},
              loc,
              scope,
            });
          }
          return;
        }

        const dependencies: Record<string, ComponentFileVarDependency> = {};
        if (init?.type === "NewExpression") {
          if (init.callee.type === "Identifier") {
            const id = newUUID();
            dependencies[id] = {
              id,
              name: init.callee.name,
            };
          }
        } else if (init?.type === "Identifier") {
          const id = newUUID();
          dependencies[id] = {
            id,
            name: init.name,
          };
        }

        componentDB.addVariable(fileName, {
          name,
          type: "data",
          dependencies,
          loc,
        });
      } else if (init?.type === "ArrowFunctionExpression") {
        if (
          nodePath.scope.block.type === "FunctionDeclaration" &&
          nodePath.scope.block.id?.type === "Identifier"
        ) {
          const parentPath = getParentPath(nodePath);

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
          const parentPath = getParentPath(nodePath);
          componentDB.addVariable(
            fileName,
            {
              name,
              dependencies: {},
              type: "function",
              loc,
              scope,
            },
            parentPath
          );
        }
      }
    }
  };
}
