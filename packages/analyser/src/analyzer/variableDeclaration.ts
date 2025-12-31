import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type {
  ComponentFileVarComponent,
  ComponentFileVarDependency,
  State,
} from "shared";
import { isHook, returnJSX } from "../utils.js";
import assert from "assert";
import { getVariableComponentName } from "../variable.js";
import { newUUID } from "../utils/uuid.js";
import { getProps } from "./propExtractor.js";
import { getType } from "./type/helper.js";

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
      const firstArgPath = nodePath.get("init").get("arguments")[0];

      if (
        (t.isArrowFunctionExpression(firstArgPath?.node) ||
          t.isFunctionExpression(firstArgPath?.node)) &&
        returnJSX(firstArgPath.node)
      ) {
        if (id.type == "Identifier") {
          const parentPath = getParentPath(nodePath);
          const component: Omit<
            ComponentFileVarComponent,
            "id" | "variableType"
          > = {
            name: id.name,
            file: fileName,
            type: "function",
            componentType: "Function",
            states: {},
            hooks: [],
            props: getProps(
              firstArgPath as traverse.NodePath<
                t.ArrowFunctionExpression | t.FunctionExpression
              >,
              nodePath.node.id as t.Identifier
            ),
            contexts: [],
            renders: {},
            dependencies: {},
            var: {},
            effects: {},
            loc,
            scope,
          };

          if (nodePath.node.id.type === "Identifier") {
            if (nodePath.node.id.typeAnnotation?.type === "TSTypeAnnotation") {
              const propType = getType(
                nodePath.node.id.typeAnnotation.typeAnnotation
              );

              if (
                propType.type === "ref" &&
                propType.refType === "qualified" &&
                propType.names?.length == 2 &&
                propType.names[0] == "React" &&
                propType.names[1] == "FC" &&
                propType.params?.length == 1
              ) {
                component.propType = propType.params[0]!;
              }
            }
          }

          componentDB.addComponent(component, parentPath);
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
      const component: Omit<ComponentFileVarComponent, "id" | "variableType"> =
        {
          name,
          file: fileName,
          type: "function",
          componentType: "Function",
          states: {},
          hooks: [],
          props:
            t.isArrowFunctionExpression(init) || t.isFunctionExpression(init)
              ? getProps(
                  nodePath.get("init") as traverse.NodePath<
                    t.ArrowFunctionExpression | t.FunctionExpression
                  >,
                  nodePath.node.id as t.Identifier
                )
              : [],
          contexts: [],
          renders: {},
          dependencies: {},
          var: {},
          effects: {},
          loc,
          scope,
        };

      if (nodePath.node.id.type === "Identifier") {
        if (nodePath.node.id.typeAnnotation?.type === "TSTypeAnnotation") {
          const propType = getType(
            nodePath.node.id.typeAnnotation.typeAnnotation
          );

          if (
            propType.type === "ref" &&
            propType.refType === "qualified" &&
            propType.names?.length == 2 &&
            propType.names[0] == "React" &&
            propType.names[1] == "FC" &&
            propType.params?.length == 1
          ) {
            component.propType = propType.params[0]!;
          }
        }
      }

      if (component.propType == null) {
        if (
          nodePath.node.init?.type === "ArrowFunctionExpression" ||
          nodePath.node.init?.type === "FunctionExpression"
        ) {
          if (
            (nodePath.node.init?.type === "ArrowFunctionExpression" ||
              nodePath.node.init?.type === "FunctionExpression") &&
            nodePath.node.init.params.length > 0 &&
            nodePath.node.init.params[0]!.type === "ObjectPattern" &&
            nodePath.node.init.params[0]!.typeAnnotation
          ) {
            assert(
              nodePath.node.init.params[0]!.typeAnnotation.type ===
                "TSTypeAnnotation"
            );
            component.propType = getType(
              nodePath.node.init.params[0]!.typeAnnotation.typeAnnotation
            );
          }
        } else {
          debugger;
        }
      }

      componentDB.addComponent(component, parentPath);
    } else {
      if (nodePath.scope.block.type === "Program") {
        if (
          init?.type === "ArrowFunctionExpression" ||
          init?.type === "FunctionExpression"
        ) {
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
              props: getProps(
                nodePath.get("init") as traverse.NodePath<
                  t.ArrowFunctionExpression | t.FunctionExpression
                >,
                nodePath.node.id as t.Identifier
              ),
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
