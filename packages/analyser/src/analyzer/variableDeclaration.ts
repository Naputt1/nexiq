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
  getReactHookInfo,
} from "../utils.js";
import assert from "assert";
import { getProps } from "./propExtractor.js";
import { getExpressionData, getType } from "./type/helper.js";
import { getPattern, getVariableNameKey } from "./pattern.js";
import { getDeterministicId } from "../utils/hash.js";
import { getVariableComponentName } from "../variable.js";
import { generateFn } from "../utils/babel.js";

export default function VariableDeclarator(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.VariableDeclarator> {
  const extractDependencies = (
    init: t.Expression | null | undefined,
  ): Record<string, ComponentFileVarDependency> => {
    const dependencies: Record<string, ComponentFileVarDependency> = {};
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
    } else if (init?.type === "CallExpression") {
      if (init.callee.type === "Identifier") {
        const id = getDeterministicId(init.callee.name);
        dependencies[id] = {
          id,
          name: init.callee.name,
        };
      }
    }
    return dependencies;
  };

  const processPattern = (
    nodePath: traverse.NodePath<t.VariableDeclarator>,
    pId: t.LVal | null,
    pParentId?: string,
    special?:
      | { type: "state"; extra: { setter: string | undefined } }
      | {
          type: "memo";
          extra: {
            scope: VariableScope;
            async?: boolean;
            reactDeps: ReactDependency[];
          };
        }
      | {
          type: "callback";
          extra: {
            scope: VariableScope;
            async?: boolean;
            reactDeps: ReactDependency[];
          };
        }
      | { type: "ref"; extra: { defaultData: PropDataType } }
      | { type: "hook"; extra: { call: { id: string; name: string } } }
      | null,
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

    const pLoc = pId?.loc
      ? { line: pId.loc.start.line, column: pId.loc.start.column }
      : loc;

    const pattern = getPattern(pId || nodePath.node.id);
    const componentId = getDeterministicId(
      fileName,
      getVariableNameKey(pattern),
    );

    let currentId: string | undefined;

    if (special) {
      if (special.type === "state") {
        const name = getVariableComponentName(nodePath);

        if (name) {
          currentId = componentDB.comAddState(name.name, pLoc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "memo") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddMemo(pLoc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "callback") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddCallback(pLoc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "ref") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddRef(pLoc, fileName, {
            name: pattern,
            loc: pLoc,
            ...special.extra,
          });
        }
      } else if (special.type === "hook") {
        const parent = getVariableComponentName(nodePath);
        if (parent != null) {
          currentId = componentDB.comAddCallHook(pLoc, fileName, {
            name: pattern,
            loc: pLoc,
            dependencies: {},
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
          // ... (existing JSX component handling)
          assert(innerFn.loc != null, "Function loc not found");
          const scope = {
            start: {
              line: innerFn.loc.start.line,
              column: innerFn.loc.start.column,
            },
            end: {
              line: innerFn.loc.end.line,
              column: innerFn.loc.end.column,
            },
          };

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
            children: {},
            effects: {},
            loc,
            scope,
            async: innerFn.async,
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
              if (nodePath.node.init.typeParameters) {
                // TODO: handle type parameters
              }
            }
          }

          currentId = componentDB.addComponent(
            fileName,
            component,
            declarationKind,
          );
          return currentId;
        } else if (init && init.type === "JSXElement") {
          // ... (existing JSX variable handling)
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
              props: [],
              loc,
              dependencies: {},
              children: {},
            },
            declarationKind,
          );
        } else if (innerFn && isHook(name)) {
          // ... (existing Hook handling)
          assert(innerFn.loc != null, "Function loc not found");
          const scope = {
            start: {
              line: innerFn.loc.start.line,
              column: innerFn.loc.start.column,
            },
            end: {
              line: innerFn.loc.end.line,
              column: innerFn.loc.end.column,
            },
          };

          const hook: Omit<
            ComponentFileVarHook,
            "kind" | "id" | "var" | "components" | "states" | "hash" | "file"
          > = {
            name: pattern,
            type: "function",
            dependencies: {},
            loc,
            scope,
            async: innerFn.async,
            props: getProps(innerFnPath, pId, componentId),
            effects: {},
            hooks: [],
            children: {},
            parentId: pParentId,
          };

          currentId = componentDB.addHook(fileName, hook, declarationKind);
          return currentId;
        }

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

            if (returnJSX(init)) {
              currentId = componentDB.addComponent(
                fileName,
                {
                  name: pattern,
                  type: "function",
                  componentType: "Function",
                  hooks: [],
                  props: getProps(
                    nodePath.get("init") as traverse.NodePath<
                      t.ArrowFunctionExpression | t.FunctionExpression
                    >,
                    pId,
                    componentId,
                  ),
                  contexts: [],
                  dependencies: {},
                  var: {},
                  children: {},
                  loc,
                  scope,
                  async: init.async,
                  effects: {},
                  forwardRef: isRefUsed(
                    nodePath.get("init") as traverse.NodePath<
                      | t.FunctionDeclaration
                      | t.ArrowFunctionExpression
                      | t.FunctionExpression
                    >,
                  ),
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarComponent,
                  "id" | "kind" | "states" | "hash" | "file"
                >,
                declarationKind,
              );
            } else if (
              isHook(pattern.type === "identifier" ? pattern.name : "")
            ) {
              currentId = componentDB.addHook(
                fileName,
                {
                  name: pattern,
                  dependencies: {},
                  type: "function",
                  loc,
                  scope,
                  async: init.async,
                  props: getProps(
                    nodePath.get("init") as traverse.NodePath<
                      t.ArrowFunctionExpression | t.FunctionExpression
                    >,
                    pId,
                    componentId,
                  ),
                  effects: {},
                  hooks: [],
                  children: {},
                  var: {},
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarHook,
                  "kind" | "id" | "var" | "states" | "hash" | "file"
                >,
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
                  async: init.async,
                  children: {},
                  var: {},
                  parentId: pParentId,
                } as Omit<
                  ComponentFileVarNormalFunction,
                  "kind" | "file" | "id" | "var" | "hash"
                >,
                undefined,
                declarationKind,
              );
            }
          } else {
            const dependencies = extractDependencies(init);

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
              "normal",
              declarationKind,
            );
          }
        } else if (init?.type === "ArrowFunctionExpression") {
          if (
            nodePath.scope.block.type === "FunctionDeclaration" &&
            nodePath.scope.block.id?.type === "Identifier"
          ) {
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
              "normal",
              declarationKind,
            );
          } else if (nodePath.scope.block.type === "ArrowFunctionExpression") {
            assert(init.loc != null, "Function loc not found");
            const scope = {
              start: {
                line: init.loc.start.line,
                column: init.loc.start.column,
              },
              end: {
                line: init.loc.end.line,
                column: init.loc.end.column,
              },
            };

            currentId = componentDB.addVariable(
              fileName,
              {
                name: pattern,
                dependencies: {},
                type: "function",
                loc,
                scope,
                async: init.async,
                children: {},
                var: {},
                parentId: pParentId,
              } as Omit<
                ComponentFileVarNormalFunction,
                "kind" | "file" | "id" | "var" | "hash"
              >,
              undefined,
              declarationKind,
            );
          }
        } else {
          // Normal data variable not in Program block
          const dependencies = extractDependencies(init);
          currentId = componentDB.addVariable(
            fileName,
            {
              name: pattern,
              dependencies,
              type: "data",
              loc,
              parentId: pParentId,
            } as Omit<
              ComponentFileVarNormalData,
              "kind" | "file" | "id" | "var" | "hash"
            >,
            "normal",
            declarationKind,
          );
        }
      } else if (t.isObjectPattern(pId) || t.isArrayPattern(pId)) {
        const dependencies = extractDependencies(init);

        currentId = componentDB.addVariable(
          fileName,
          {
            name: pattern,
            type: "data",
            dependencies,
            loc: pLoc,
            parentId: pParentId,
          },
          "normal",
        );
      }
    }

    return currentId;
  };

  return {
    enter(nodePath) {
      const id = nodePath.node.id;
      if (id.type === "VoidPattern") return;
      const init = nodePath.node.init;
      assert(nodePath.node.id?.loc?.start != null);

      if (t.isCallExpression(init)) {
        const firstArgPath = nodePath.get("init").get("arguments")[0];
        const hookInfo = getReactHookInfo(init, componentDB, fileName);

        if (
          hookInfo?.isReact &&
          (hookInfo.name === "useState" || hookInfo.name === "useReducer")
        ) {
          processPattern(nodePath, id, undefined, {
            type: "state",
            extra: { setter: undefined },
          });
        } else if (
          hookInfo?.isReact &&
          (hookInfo.name === "useMemo" || hookInfo.name === "useCallback")
        ) {
          let targetFnPath:
            | traverse.NodePath<
                t.ArrowFunctionExpression | t.FunctionExpression
              >
            | undefined;

          if (
            firstArgPath &&
            (firstArgPath.isArrowFunctionExpression() ||
              firstArgPath.isFunctionExpression())
          ) {
            targetFnPath = firstArgPath as traverse.NodePath<
              t.ArrowFunctionExpression | t.FunctionExpression
            >;
          } else if (firstArgPath && firstArgPath.isCallExpression()) {
            const args = firstArgPath.get("arguments");
            for (const arg of args) {
              if (
                arg.isArrowFunctionExpression() ||
                arg.isFunctionExpression()
              ) {
                targetFnPath = arg as traverse.NodePath<
                  t.ArrowFunctionExpression | t.FunctionExpression
                >;
                break;
              }
            }
          }

          if (targetFnPath) {
            const body = targetFnPath.node.body;
            assert(body.loc != null, "Function body loc not found");

            const scope = {
              start: {
                line: body.loc.start.line,
                column: body.loc.start.column,
              },
              end: {
                line: body.loc.end.line,
                column: body.loc.end.column,
              },
            };

            const dependencies = init.arguments[1];
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

            const currentId = processPattern(nodePath, id, undefined, {
              type: hookInfo.name === "useMemo" ? "memo" : "callback",
              extra: { scope, reactDeps, async: targetFnPath.node.async },
            });

            if (currentId && firstArgPath && firstArgPath.isCallExpression()) {
              const extraDeps = extractDependencies(firstArgPath.node);
              for (const dep of Object.values(extraDeps)) {
                componentDB.addVariableDependency(fileName, currentId, dep);
              }
            }
          } else if (hookInfo.name === "useCallback") {
            // It's still a callback, even if we don't find a function implementation
            const dependencies = init.arguments[1];
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

            processPattern(nodePath, id, undefined, {
              type: "callback",
              extra: {
                scope: {
                  start: { line: 0, column: 0 },
                  end: { line: 0, column: 0 },
                },
                reactDeps,
              },
            });
          }
        } else if (hookInfo?.isReact && hookInfo.name === "useRef") {
          const defaultData: PropDataType = (init.arguments[0] &&
            t.isExpression(init.arguments[0]) &&
            getExpressionData(init.arguments[0])) || { type: "null" };

          processPattern(nodePath, id, undefined, {
            type: "ref",
            extra: { defaultData },
          });
        } else if (hookInfo) {
          processPattern(nodePath, id, undefined, {
            type: "hook",
            extra: {
              call: {
                id: getDeterministicId(hookInfo.name),
                name: hookInfo.name,
              },
            },
          });
        } else {
          processPattern(nodePath, id);
        }
      } else {
        processPattern(nodePath, id);
      }
    },
  };
}
