import * as t from "@babel/types";
import type * as traverse from "@babel/traverse";
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
import {
  isHook,
  returnJSX,
  isForwardRefCall,
  isForwardRefRefUsed,
  isRefUsed,
} from "../utils.js";
import assert from "assert";
import { getProps } from "./propExtractor.js";
import { getExpressionData, getType } from "./type/helper.js";
import { getPattern, getVariableNameKey } from "./pattern.js";
import { getDeterministicId } from "../utils/hash.js";
import { getVariableComponentName } from "../variable.js";
import { generateFn } from "../utils/babel.js";
import { isJSXVariable } from "../db/variable/type.js";

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
  const processPattern = (
    nodePath: traverse.NodePath<t.VariableDeclarator>,
    pId: t.LVal | null,
    pParentId?: string,
    special?:
      | { type: "state"; extra: { setter: string | undefined } }
      | {
          type: "memo";
          extra: { scope: VariableScope; reactDeps: ReactDependency[] };
        }
      | {
          type: "callback";
          extra: { scope: VariableScope; reactDeps: ReactDependency[] };
        }
      | { type: "ref"; extra: { defaultData: PropDataType } }
      | {
          type: "hook";
          extra: {
            dependencies: Record<string, ComponentFileVarDependency>;
            call: { id: string; name: string };
          };
        },
  ): string | undefined => {
    const init = nodePath.node.init;
    const declarationKind =
      nodePath.parent.type === "VariableDeclaration"
        ? nodePath.parent.kind
        : undefined;

    const loc = {
      line: nodePath.node.id.loc!.start.line,
      column: nodePath.node.id.loc!.start.column,
    };

    const scope = {
      start: {
        line: nodePath.node.id.loc!.start.line,
        column: nodePath.node.id.loc!.start.column,
      },
      end: {
        line: nodePath.node.id.loc!.end.line,
        column: nodePath.node.id.loc!.end.column,
      },
    };

    if (pId == null) return undefined;
    const pattern = getPattern(pId, pParentId);
    const nameKey = getVariableNameKey(pattern);
    const componentId = getDeterministicId(nameKey);

    if (pId.loc == null) return undefined;
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
            ...special.extra,
          });
        }
      } else if (special.type === "memo") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddMemo(parent.loc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "callback") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddCallback(parent.loc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "ref") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddRef(parent.loc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "hook") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddCallHook(parent.loc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      }
    }

    if (currentId == null && !special) {
      if (t.isIdentifier(pId)) {
        const name = pId.name;

        const isForwardRef =
          init &&
          t.isCallExpression(init) &&
          isForwardRefCall(init, componentDB, fileName);
        const innerFnPath = isForwardRef
          ? (nodePath.get("init").get("arguments")[0] as traverse.NodePath<
              t.ArrowFunctionExpression | t.FunctionExpression
            >)
          : (nodePath.get("init") as traverse.NodePath<
              t.ArrowFunctionExpression | t.FunctionExpression
            >);
        const innerFn = innerFnPath?.node;

        if (innerFn && returnJSX(innerFn)) {
          const parentPath = getParentPath(nodePath);
          const component: Omit<
            ComponentFileVarComponent,
            "id" | "kind" | "states" | "hash" | "file"
          > = {
            name: pattern,
            type: "function",
            componentType: "Function",
            hooks: [],
            props: getProps(innerFnPath, pId, componentId),
            contexts: [],
            dependencies: {},
            var: {},
            effects: {},
            loc,
            scope,
            parentId: pParentId,
            forwardRef: isForwardRef
              ? isForwardRefRefUsed(innerFnPath)
              : isRefUsed(innerFnPath),
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
            declarationKind,
          );
        } else if (init && init.type === "JSXElement") {
          const parentPath = getParentPath(nodePath);
          const opening = init.openingElement.name;
          let tag = "";
          if (opening.type === "JSXIdentifier") {
            tag = opening.name;
          } else if (opening.type === "JSXMemberExpression") {
            tag = generateFn(opening).code;
          }

          currentId = componentDB.addJSXVariable(
            fileName,
            {
              name: pattern,
              tag,
              props: [], // Will be filled by JSXElement visitor
              loc,
              dependencies: {},
              children: {},
            },
            parentPath,
            declarationKind,
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
                currentId = componentDB.addHook(
                  fileName,
                  {
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
                    "kind" | "id" | "var" | "states" | "hash" | "file"
                  >,
                  undefined,
                  declarationKind,
                );
              } else {
                currentId = componentDB.addVariable(
                  fileName,
                  {
                    name: pattern,
                    type: "function",
                    dependencies: {},
                    loc,
                    scope,
                    parentId: pParentId,
                  } as Omit<
                    ComponentFileVarNormalFunction,
                    "kind" | "file" | "id" | "var" | "hash"
                  >,
                  undefined,
                  undefined,
                  declarationKind,
                );
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

              currentId = componentDB.addVariable(
                fileName,
                {
                  name: pattern,
                  type: "data",
                  dependencies,
                  loc,
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarNormalData,
                  "kind" | "file" | "id" | "var" | "hash"
                >,
                undefined,
                "normal",
                declarationKind,
              );
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
                  "kind" | "file" | "id" | "var" | "hash"
                >,
                parentPath,
                "normal",
                declarationKind,
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
                  "kind" | "file" | "id" | "var" | "hash"
                >,
                parentPath,
                undefined,
                declarationKind,
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
                "kind" | "file" | "id" | "var" | "hash"
              >,
              parentPath,
              "normal",
              declarationKind,
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
          "normal",
        );
      }
    }

    return currentId;
  };

  return {
    enter(nodePath) {
      const id = nodePath.node.id;
      const init = nodePath.node.init;
      assert(nodePath.node.id?.loc?.start != null);

      const loc = {
        line: nodePath.node.id.loc.start.line,
        column: nodePath.node.id.loc.start.column,
      };

      if (t.isCallExpression(init)) {
        const firstArgPath = nodePath.get("init").get("arguments")[0];
        const calleeName = t.isIdentifier(init.callee)
          ? init.callee.name
          : "call";
        const patternPrefix = `${calleeName}-${loc.line}-${loc.column}`;

        if (
          (t.isArrowFunctionExpression(firstArgPath?.node) ||
            t.isFunctionExpression(firstArgPath?.node)) &&
          returnJSX(firstArgPath.node)
        ) {
          if (id.type == "Identifier") {
            processPattern(nodePath, id as t.LVal, patternPrefix, undefined);
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
              processPattern(
                nodePath,
                id.elements[0] as t.LVal,
                patternPrefix,
                {
                  type: "state",
                  extra: { setter: setterName },
                },
              );
              return;
            }

            processPattern(nodePath, id as t.LVal, patternPrefix, {
              type: "state",
              extra: { setter: setterName },
            });
            return;
          } else if (init.callee.name === "useMemo") {
            const id = nodePath.node.id;

            let scope: VariableScope | undefined;
            const reactDeps: ReactDependency[] = [];
            if (init.arguments.length > 0) {
              const func = init.arguments[0];
              if (
                (t.isArrowFunctionExpression(func) ||
                  t.isFunctionExpression(func)) &&
                func.loc
              ) {
                scope = {
                  start: {
                    line: func.loc.start.line,
                    column: func.loc.start.column,
                  },
                  end: {
                    line: func.loc.end.line,
                    column: func.loc.end.column,
                  },
                };
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
                  }
                }
              }
            }

            if (scope) {
              processPattern(nodePath, id as t.LVal, patternPrefix, {
                type: "memo",
                extra: { scope, reactDeps },
              });
              return;
            }
          } else if (init.callee.name === "useCallback") {
            const id = nodePath.node.id;

            let scope: VariableScope | undefined;
            const reactDeps: ReactDependency[] = [];
            if (init.arguments.length > 0) {
              const func = init.arguments[0];
              if (
                (t.isArrowFunctionExpression(func) ||
                  t.isFunctionExpression(func)) &&
                func.loc
              ) {
                scope = {
                  start: {
                    line: func.loc.start.line,
                    column: func.loc.start.column,
                  },
                  end: {
                    line: func.loc.end.line,
                    column: func.loc.end.column,
                  },
                };
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
                  }
                }
              }
            }

            if (scope) {
              processPattern(nodePath, id as t.LVal, patternPrefix, {
                type: "callback",
                extra: { scope, reactDeps },
              });
              return;
            }
          } else if (init.callee.name === "useRef") {
            const id = nodePath.node.id;

            const defaultData =
              init.arguments.length > 0 && t.isExpression(init.arguments[0])
                ? (getExpressionData(init.arguments[0]) as PropDataType) || {
                    type: "undefined",
                  }
                : ({ type: "undefined" } as PropDataType);

            processPattern(nodePath, id as t.LVal, patternPrefix, {
              type: "ref",
              extra: { defaultData },
            });
            return;
          } else if (isHook(init.callee.name)) {
            const name = getVariableComponentName(nodePath);
            if (name) {
              componentDB.comAddHook(
                name.name,
                name.loc,
                fileName,
                init.callee.name,
              );
            }

            //TODO: add dependencies
            const dependencies: Record<string, ComponentFileVarDependency> = {};

            const id = nodePath.node.id;
            if (t.isArrayPattern(id) && id.elements.length > 0) {
              processPattern(
                nodePath,
                id.elements[0] as t.LVal,
                patternPrefix,
                {
                  type: "hook",
                  extra: {
                    dependencies,
                    call: {
                      id: getDeterministicId(init.callee.name),
                      name: init.callee.name,
                    },
                  },
                },
              );
              return;
            }

            processPattern(
              nodePath,
              nodePath.node.id as t.LVal,
              patternPrefix,
              {
                type: "hook",
                extra: {
                  dependencies,
                  call: {
                    id: getDeterministicId(init.callee.name),
                    name: init.callee.name,
                  },
                },
              },
            );
            return;
          }
        }
      }
      processPattern(nodePath, id as t.LVal, undefined, undefined);
    },
    exit(nodePath) {
      const init = nodePath.node.init;
      assert(nodePath.node.id?.loc?.start != null);

      const loc = {
        line: nodePath.node.id.loc.start.line,
        column: nodePath.node.id.loc.start.column,
      };

      const isForwardRef =
        init &&
        t.isCallExpression(init) &&
        isForwardRefCall(init, componentDB, fileName);
      const innerFnPath = isForwardRef
        ? (nodePath.get("init").get("arguments")[0] as traverse.NodePath<
            t.ArrowFunctionExpression | t.FunctionExpression
          >)
        : (nodePath.get("init") as traverse.NodePath<
            t.ArrowFunctionExpression | t.FunctionExpression
          >);
      const innerFn = innerFnPath?.node;

      if (innerFn && returnJSX(innerFn)) {
        if (innerFn.body.type !== "BlockStatement") {
          const body = innerFn.body;
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
          } else if (t.isExpression(body)) {
            const data = getExpressionData(body);
            if (data) {
              componentDB.comSetReturn(fileName, loc, data);
            }
          }
        }
      }
    },
  };
}
