import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentInfoRenderDependency, VariableName } from "@nexu/shared";
import assert from "assert";
import generate from "@babel/generator";
import { getDeterministicId } from "../utils/hash.js";
import { getExpressionData } from "./type/helper.js";
import {
  isJSXVariable,
  isComponentVariable,
  isBaseFunctionVariable,
} from "../db/variable/type.js";

const generateFn: typeof generate.default = generate.default || generate;

function extractDependencies(
  expr: t.Expression,
  name: string,
  dependency: ComponentInfoRenderDependency[],
) {
  const data = getExpressionData(expr);
  if (data) {
    dependency.push({
      id: getDeterministicId(name),
      name: name,
      value: data,
    });
  } else if (t.isObjectExpression(expr)) {
    for (const prop of expr.properties) {
      if (t.isObjectProperty(prop)) {
        let propName = "";
        if (t.isIdentifier(prop.key)) {
          propName = prop.key.name;
        } else if (t.isStringLiteral(prop.key)) {
          propName = prop.key.value;
        }

        if (propName && t.isExpression(prop.value)) {
          extractDependencies(prop.value, propName, dependency);
        }
      } else if (t.isSpreadElement(prop)) {
        extractDependencies(prop.argument, "...", dependency);
      }
    }
  } else if (t.isLogicalExpression(expr)) {
    extractDependencies(expr.left, name, dependency);
    extractDependencies(expr.right, name, dependency);
  } else if (t.isConditionalExpression(expr)) {
    extractDependencies(expr.consequent, name, dependency);
    extractDependencies(expr.alternate, name, dependency);
  } else if (t.isTemplateLiteral(expr)) {
    for (const subExpr of expr.expressions) {
      if (t.isExpression(subExpr)) {
        extractDependencies(subExpr, name, dependency);
      }
    }
  } else if (t.isBinaryExpression(expr)) {
    if (t.isExpression(expr.left)) {
      extractDependencies(expr.left, name, dependency);
    }
    extractDependencies(expr.right, name, dependency);
  } else if (t.isCallExpression(expr)) {
    for (const arg of expr.arguments) {
      if (t.isExpression(arg)) {
        extractDependencies(arg, name, dependency);
      }
    }
  } else {
    dependency.push({
      id: getDeterministicId(name),
      name: name,
      value: {
        type: "literal-type",
        literal: { type: "string", value: generateFn(expr).code },
      },
    });
  }
}

export default function JSXElement(
  componentDB: ComponentDB,
  fileName: string,
): traverse.Visitor {
  return {
    JSXElement: {
      enter(nodePath: traverse.NodePath<t.JSXElement>) {
        const opening = nodePath.node.openingElement.name;
        let tag = "";
        if (opening.type === "JSXIdentifier") {
          tag = opening.name;
        } else if (opening.type === "JSXMemberExpression") {
          tag = generateFn(opening).code;
        }

        if (!tag) return;

        assert(nodePath.node.loc?.start != null);
        const loc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };

        const dependency: ComponentInfoRenderDependency[] = [];
        for (const prop of nodePath.node.openingElement.attributes) {
          if (
            prop.type === "JSXAttribute" &&
            prop.name.type === "JSXIdentifier"
          ) {
            if (prop.value?.type === "JSXExpressionContainer") {
              if (t.isExpression(prop.value.expression)) {
                extractDependencies(
                  prop.value.expression,
                  prop.name.name,
                  dependency,
                );
              }
            } else if (prop.value?.type === "StringLiteral") {
              dependency.push({
                id: getDeterministicId(prop.name.name),
                name: prop.name.name,
                value: {
                  type: "literal-type",
                  literal: { type: "string", value: prop.value.value },
                },
              });
            }
          } else if (prop.type === "JSXSpreadAttribute") {
            extractDependencies(prop.argument, "...", dependency);
          }
        }

        let existingVar = componentDB.getVariableFromLoc(fileName, loc);
        if (!existingVar) {
          const varPath = nodePath.findParent((p) => p.isVariableDeclarator());
          if (
            varPath &&
            varPath.isVariableDeclarator() &&
            t.isIdentifier(varPath.node.id) &&
            varPath.node.init === nodePath.node
          ) {
            const varLoc = {
              line: varPath.node.id.loc!.start.line,
              column: varPath.node.id.loc!.start.column,
            };
            existingVar = componentDB.getVariableFromLoc(fileName, varLoc);
          }
        }

        let id: string;
        if (existingVar && isJSXVariable(existingVar)) {
          existingVar.props = dependency;
          id = existingVar.id;
        } else {
          const name: VariableName = {
            type: "identifier",
            name: `jsx@${loc.line}:${loc.column}`,
            loc,
            id: getDeterministicId(`jsx@${loc.line}:${loc.column}`),
          };

          id = componentDB.addJSXVariable(fileName, {
            name,
            tag,
            props: dependency,
            loc,
            dependencies: {},
            children: {},
          });
        }

        componentDB.pushJSX(id);

        const parentFunc = nodePath.getFunctionParent();
        if (parentFunc) {
          let funcLoc: { line: number; column: number } | undefined;
          if (parentFunc.node.type === "FunctionDeclaration") {
            if (parentFunc.node.id?.loc) {
              funcLoc = {
                line: parentFunc.node.id.loc.start.line,
                column: parentFunc.node.id.loc.start.column,
              };
            }
          } else if (
            parentFunc.node.type === "ArrowFunctionExpression" ||
            parentFunc.node.type === "FunctionExpression"
          ) {
            if (parentFunc.parentPath.isVariableDeclarator()) {
              const fid = parentFunc.parentPath.node.id;
              if (fid.loc) {
                funcLoc = {
                  line: fid.loc.start.line,
                  column: fid.loc.start.column,
                };
              }
            }
          }

          if (funcLoc) {
            const body = parentFunc.node.body;
            if (
              body === nodePath.node ||
              (body.type === "BlockStatement" &&
                nodePath.parent.type === "ReturnStatement")
            ) {
              componentDB.comSetReturn(fileName, funcLoc, id);
            }
          }
        }

        const shouldAddRender = true; // Always add to capture structure

        if (shouldAddRender) {
          const instanceId = componentDB.comAddRender(
            fileName,
            tag,
            dependency,
            loc,
            "jsx",
            componentDB.getCurrentRenderInstance(),
          );
          componentDB.pushRenderInstance(instanceId);
        } else {
          componentDB.pushRenderInstance(
            componentDB.getCurrentRenderInstance(),
          );
        }
      },
      exit() {
        componentDB.popJSX();
        componentDB.popRenderInstance();
      },
    },
    JSXFragment: {
      enter(nodePath: traverse.NodePath<t.JSXFragment>) {
        assert(nodePath.node.loc?.start != null);
        const loc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };

        const existingVar = componentDB.getVariableFromLoc(fileName, loc);
        if (existingVar && isJSXVariable(existingVar)) {
          componentDB.pushJSX(existingVar.id);
          componentDB.pushRenderInstance(
            componentDB.getCurrentRenderInstance(),
          );
          return;
        }

        const tag = "Fragment";
        const name: VariableName = {
          type: "identifier",
          name: `jsx@${loc.line}:${loc.column}`,
          loc,
          id: getDeterministicId(`jsx@${loc.line}:${loc.column}`),
        };

        const id = componentDB.addJSXVariable(fileName, {
          name,
          tag,
          props: [],
          loc,
          dependencies: {},
          children: {},
        });

        componentDB.pushJSX(id);

        const parentFunc = nodePath.getFunctionParent();
        if (parentFunc) {
          let funcLoc: { line: number; column: number } | undefined;
          if (parentFunc.node.type === "FunctionDeclaration") {
            if (parentFunc.node.id?.loc) {
              funcLoc = {
                line: parentFunc.node.id.loc.start.line,
                column: parentFunc.node.id.loc.start.column,
              };
            }
          } else if (
            parentFunc.node.type === "ArrowFunctionExpression" ||
            parentFunc.node.type === "FunctionExpression"
          ) {
            if (parentFunc.parentPath.isVariableDeclarator()) {
              const fid = parentFunc.parentPath.node.id;
              if (fid.loc) {
                funcLoc = {
                  line: fid.loc.start.line,
                  column: fid.loc.start.column,
                };
              }
            }
          }

          if (funcLoc) {
            const body = parentFunc.node.body;
            if (
              body === nodePath.node ||
              (body.type === "BlockStatement" &&
                nodePath.parent.type === "ReturnStatement")
            ) {
              componentDB.comSetReturn(fileName, funcLoc, id);
            }
          }
        }

        const instanceId = componentDB.comAddRender(
          fileName,
          tag,
          [],
          loc,
          "jsx",
          componentDB.getCurrentRenderInstance(),
        );
        componentDB.pushRenderInstance(instanceId);
      },
      exit() {
        componentDB.popJSX();
        componentDB.popRenderInstance();
      },
    },
    JSXExpressionContainer(
      nodePath: traverse.NodePath<t.JSXExpressionContainer>,
    ) {
      const currentJSX = componentDB.getCurrentJSX();
      if (!currentJSX) return;

      if (t.isExpression(nodePath.node.expression)) {
        const dependencies: ComponentInfoRenderDependency[] = [];
        extractDependencies(nodePath.node.expression, "child", dependencies);

        for (const dep of dependencies) {
          if (dep.valueId) {
            componentDB.addVariableDependency(fileName, currentJSX, {
              id: dep.valueId,
              name: dep.name,
            });
          } else if (
            dep.value.type === "ref" &&
            dep.value.refType === "named"
          ) {
            const loc = {
              line: nodePath.node.loc?.start.line || 0,
              column: nodePath.node.loc?.start.column || 0,
            };
            const v = componentDB.getHookInfoFromLoc(fileName, loc);
            let isComponent = false;
            const varId = v?.id;

            if (varId) {
              if (v && isBaseFunctionVariable(v)) {
                const targetVar = v.var.getByName(dep.value.name);
                if (
                  targetVar &&
                  (isJSXVariable(targetVar) || isComponentVariable(targetVar))
                ) {
                  isComponent = true;
                }
              }
            }

            if (!isComponent) {
              const resId = componentDB.getVariableID(dep.value.name, fileName);
              if (resId) {
                const file = componentDB.getFile(fileName);
                const v = file.var.get(resId, true);
                if (v && (isJSXVariable(v) || isComponentVariable(v))) {
                  isComponent = true;
                }
              }
            }

            if (isComponent) {
              componentDB.comAddRender(
                fileName,
                dep.value.name,
                [],
                {
                  line: loc.line,
                  column: loc.column,
                },
                "jsx",
                componentDB.getCurrentRenderInstance(),
              );
            }

            const id = getDeterministicId(dep.value.name);
            componentDB.addVariableDependency(fileName, currentJSX, {
              id,
              name: dep.value.name,
            });
          }
        }
      }
    },
    ConditionalExpression: {
      enter(nodePath: traverse.NodePath<t.ConditionalExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        assert(nodePath.node.loc?.start != null);
        const loc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };
        const id = componentDB.comAddRender(
          fileName,
          "Ternary",
          [],
          loc,
          "ternary",
          componentDB.getCurrentRenderInstance(),
        );
        componentDB.pushRenderInstance(id);
      },
      exit(nodePath: traverse.NodePath<t.ConditionalExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        componentDB.popRenderInstance();
      },
    },
    LogicalExpression: {
      enter(nodePath: traverse.NodePath<t.LogicalExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        assert(nodePath.node.loc?.start != null);
        const loc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };
        const id = componentDB.comAddRender(
          fileName,
          nodePath.node.operator === "&&" ? "ShortCircuit" : "Logical",
          [],
          loc,
          "expression",
          componentDB.getCurrentRenderInstance(),
        );
        componentDB.pushRenderInstance(id);
      },
      exit(nodePath: traverse.NodePath<t.LogicalExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        componentDB.popRenderInstance();
      },
    },
    CallExpression: {
      enter(nodePath: traverse.NodePath<t.CallExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        // Check if it's a map (loop)
        let isMap = false;
        if (
          t.isMemberExpression(nodePath.node.callee) &&
          t.isIdentifier(nodePath.node.callee.property, { name: "map" })
        ) {
          isMap = true;
        }

        if (!isMap) return;

        assert(nodePath.node.loc?.start != null);
        const loc = {
          line: nodePath.node.loc.start.line,
          column: nodePath.node.loc.start.column,
        };
        const id = componentDB.comAddRender(
          fileName,
          "Loop",
          [],
          loc,
          "loop",
          componentDB.getCurrentRenderInstance(),
        );
        componentDB.pushRenderInstance(id);
      },
      exit(nodePath: traverse.NodePath<t.CallExpression>) {
        if (!nodePath.parentPath.isJSXExpressionContainer()) return;
        if (
          t.isMemberExpression(nodePath.node.callee) &&
          t.isIdentifier(nodePath.node.callee.property, { name: "map" })
        ) {
          componentDB.popRenderInstance();
        }
      },
    },
  };
}
