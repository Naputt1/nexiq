import * as t from "@babel/types";
import traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type {
  ComponentFileVarComponent,
  ComponentFileVarHook,
  ComponentFileVarNormalData,
  ComponentFileVarNormalFunction,
  ComponentFileVarDependency,
  PropDataType,
  ReactDependency,
  VariableScope,
} from "shared";
import { isHook, returnJSX } from "../utils.js";
import assert from "assert";
import { getProps } from "./propExtractor.js";
import { getExpressionData, getType } from "./type/helper.js";
import { getPattern, getVariableNameKey } from "./pattern.js";
import { getDeterministicId } from "../utils/hash.js";
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

  return parentPath;
}

export default function VariableDeclarator(
  componentDB: ComponentDB,
  fileName: string,
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

    const processPattern = (
      pId: t.LVal,
      pParentId?: string,
      special?:
        | { type: "state"; extra: { setter: string | undefined } }
        | {
            type: "memo";
            extra: { scope: VariableScope; reactDeps: ReactDependency[] };
          }
        | { type: "ref"; extra: { defaultData: PropDataType } },
    ): string | undefined => {
      const pattern = getPattern(pId);
      const nameKey = getVariableNameKey(pattern);
      const componentId = getDeterministicId(nameKey);

      assert(pId.loc != null);
      const pLoc = {
        line: pId.loc.start.line,
        column: pId.loc.start.column,
      };

      let currentId: string | undefined;

      if (special) {
        if (special.type === "state") {
          const name = getVariableComponentName(nodePath);

          if (name) {
            currentId = componentDB.comAddState(name.name, name.loc, fileName, {
              name: pattern,
              loc: pLoc,
              parentId: pParentId,
              ...special.extra,
            });
          }
        } else if (special.type === "memo") {
          const parent = getVariableComponentName(nodePath);
          if (parent != null) {
            currentId = componentDB.comAddMemo(parent.loc, fileName, {
              name: pattern,
              loc: pLoc,
              parentId: pParentId,
              ...special.extra,
            });
          }
        } else if (special.type === "ref") {
          const parent = getVariableComponentName(nodePath);
          if (parent != null) {
            currentId = componentDB.comAddRef(parent.loc, fileName, {
              name: pattern,
              loc: pLoc,
              parentId: pParentId,
              ...special.extra,
            });
          }
        }
      }

      if (currentId == null) {
        if (t.isIdentifier(pId)) {
          const name = pId.name;

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
            const component: Omit<
              ComponentFileVarComponent,
              "id" | "kind" | "states" | "hash" | "file"
            > = {
              name: pattern,
              type: "function",
              componentType: "Function",
              hooks: [],
              props:
                t.isArrowFunctionExpression(init) ||
                t.isFunctionExpression(init)
                  ? getProps(
                      nodePath.get("init") as traverse.NodePath<
                        t.ArrowFunctionExpression | t.FunctionExpression
                      >,
                      pId,
                      componentId,
                    )
                  : [],
              contexts: [],
              renders: {},
              dependencies: {},
              var: {},
              effects: {},
              loc,
              scope,
              parentId: pParentId,
            };

            if (pId.typeAnnotation?.type === "TSTypeAnnotation") {
              const propType = getType(pId.typeAnnotation.typeAnnotation);

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
                      "TSTypeAnnotation",
                  );
                  component.propType = getType(
                    nodePath.node.init.params[0]!.typeAnnotation.typeAnnotation,
                  );
                }
              }
            }

            currentId = componentDB.addComponent(
              fileName,
              component,
              parentPath,
            );
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
                  currentId = componentDB.addHook(fileName, {
                    name: pattern,
                    type: "function",
                    dependencies: {},
                    loc,
                    scope,
                    props: getProps(
                      nodePath.get("init") as traverse.NodePath<
                        t.ArrowFunctionExpression | t.FunctionExpression
                      >,
                      pId,
                      componentId,
                    ),
                    effects: {},
                    hooks: [],
                    parentId: pParentId,
                  } as Omit<
                    ComponentFileVarHook,
                    | "kind"
                    | "id"
                    | "var"
                    | "components"
                    | "states" | "hash" | "file"
                  >);
                } else {
                  currentId = componentDB.addVariable(fileName, {
                    name: pattern,
                    type: "function",
                    dependencies: {},
                    loc,
                    scope,
                    parentId: pParentId,
                  } as Omit<
                    ComponentFileVarNormalFunction,
                    "kind" | "file" | "id" | "var" | "components" | "hash"
                  >);
                }
              } else {
                const dependencies: Record<string, ComponentFileVarDependency> =
                  {};
                if (init?.type === "NewExpression") {
                  if (init.callee.type === "Identifier") {
                    const id = getDeterministicId(init.callee.name);
                    dependencies[id] = {
                      id,
                      name: init.callee.name,
                    };
                  }
                } else if (init?.type === "Identifier") {
                  const id = getDeterministicId(init.name);
                  dependencies[id] = {
                    id,
                    name: init.name,
                  };
                }

                currentId = componentDB.addVariable(fileName, {
                  name: pattern,
                  type: "data",
                  dependencies,
                  loc,
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarNormalData,
                  "kind" | "file" | "id" | "var" | "components" | "hash"
                >);
              }
            } else if (init?.type === "ArrowFunctionExpression") {
              if (
                nodePath.scope.block.type === "FunctionDeclaration" &&
                nodePath.scope.block.id?.type === "Identifier"
              ) {
                const parentPath = getParentPath(nodePath);

                currentId = componentDB.addVariable(
                  fileName,
                  {
                    name: pattern,
                    dependencies: {},
                    type: "data",
                    loc,
                    parentId: pParentId,
                  } as Omit<
                    ComponentFileVarNormalData,
                    "kind" | "file" | "id" | "var" | "components" | "hash"
                  >,
                  parentPath,
                );
              } else if (
                nodePath.scope.block.type === "ArrowFunctionExpression"
              ) {
                const parentPath = getParentPath(nodePath);
                currentId = componentDB.addVariable(
                  fileName,
                  {
                    name: pattern,
                    dependencies: {},
                    type: "function",
                    loc,
                    scope,
                    parentId: pParentId,
                  } as Omit<
                    ComponentFileVarNormalFunction,
                    "kind" | "file" | "id" | "var" | "components" | "hash"
                  >,
                  parentPath,
                );
              }
            } else {
              // Normal data variable not in Program block
              const parentPath = getParentPath(nodePath);
              currentId = componentDB.addVariable(
                fileName,
                {
                  name: pattern,
                  dependencies: {},
                  type: "data",
                  loc,
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarNormalData,
                  "kind" | "file" | "id" | "var" | "components" | "hash"
                >,
                parentPath,
              );
            }
          }
        } else if (t.isObjectPattern(pId) || t.isArrayPattern(pId)) {
          const parentPath = getParentPath(nodePath);

          const dependencies: Record<string, ComponentFileVarDependency> = {};
          if (pParentId == null) {
            if (init?.type === "NewExpression") {
              if (init.callee.type === "Identifier") {
                const id = getDeterministicId(init.callee.name);
                dependencies[id] = {
                  id,
                  name: init.callee.name,
                };
              }
            } else if (init?.type === "Identifier") {
              const id = getDeterministicId(init.name);
              dependencies[id] = {
                id,
                name: init.name,
              };
            }
          }

          currentId = componentDB.addVariable(
            fileName,
            {
              name: pattern,
              type: "data",
              dependencies,
              loc: pLoc,
              parentId: pParentId,
            },
            parentPath,
          );
        }
      }

      if (currentId) {
        if (t.isObjectPattern(pId)) {
          for (const prop of pId.properties) {
            if (t.isObjectProperty(prop)) {
              processPattern(prop.value as t.LVal, currentId);
            } else if (t.isRestElement(prop)) {
              processPattern(prop.argument as t.LVal, currentId);
            }
          }
        } else if (t.isArrayPattern(pId)) {
          for (const element of pId.elements) {
            if (element) {
              processPattern(element as t.LVal, currentId);
            }
          }
        }
      }
      return currentId;
    };

    if (t.isCallExpression(init)) {
      const firstArgPath = nodePath.get("init").get("arguments")[0];

      if (
        (t.isArrowFunctionExpression(firstArgPath?.node) ||
          t.isFunctionExpression(firstArgPath?.node)) &&
        returnJSX(firstArgPath.node)
      ) {
        if (id.type == "Identifier") {
          processPattern(id as t.LVal);
          return;
        }
      } else if (t.isIdentifier(init.callee)) {
        if (init.callee.name === "useState") {
          const id = nodePath.node.id;

          let setterName: string | undefined;
          if (t.isArrayPattern(id)) {
            const [, setterVar] = id.elements;
            if (t.isIdentifier(setterVar)) {
              setterName = setterVar.name;
            }
          }

          if (t.isArrayPattern(id) && id.elements.length > 0) {
            processPattern(id.elements[0] as t.LVal, undefined, {
              type: "state",
              extra: { setter: setterName },
            });
            return;
          }

          processPattern(id as t.LVal, undefined, {
            type: "state",
            extra: { setter: setterName },
          });
          return;
        } else if (init.callee.name === "useMemo") {
          const id = nodePath.node.id;

          let scope: VariableScope | undefined;
          const reactDeps: ReactDependency[] = [];
          if (init.arguments.length > 0) {
            if (t.isArrowFunctionExpression(init.arguments[0])) {
              assert(init.arguments[0].loc != null, "Function loc not found");

              scope = {
                start: {
                  line: init.arguments[0].loc.start.line,
                  column: init.arguments[0].loc.start.column,
                },
                end: {
                  line: init.arguments[0].loc.end.line,
                  column: init.arguments[0].loc.end.column,
                },
              };
            } else {
              debugger;
            }
          }

          if (init.arguments.length > 1) {
            if (t.isArrayExpression(init.arguments[1])) {
              for (const element of init.arguments[1].elements) {
                if (t.isIdentifier(element)) {
                  reactDeps.push({
                    id: "",
                    name: element.name,
                  });
                } else {
                  debugger;
                }
              }
            } else {
              debugger;
            }
          } else {
            debugger;
          }

          assert(scope != null, "Scope not found");
          processPattern(id as t.LVal, undefined, {
            type: "memo",
            extra: { scope, reactDeps },
          });
          return;
        } else if (init.callee.name === "useRef") {
          const id = nodePath.node.id;

          const defaultData =
            init.arguments.length > 0 && t.isExpression(init.arguments[0])
              ? (getExpressionData(init.arguments[0]) as PropDataType) || {
                  type: "undefined",
                }
              : ({ type: "undefined" } as PropDataType);

          processPattern(id as t.LVal, undefined, {
            type: "ref",
            extra: { defaultData },
          });
          return;
        }
      }
    }
    processPattern(id as t.LVal);
  };
}
