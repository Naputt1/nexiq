import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentInfoRenderDependency, VariableName } from "shared";
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

function getComponentLoc(nodePath: traverse.NodePath<t.Node>) {
  const parentStatement = nodePath.getStatementParent();

  if (parentStatement?.node?.loc?.start.line != null) {
    if (
      parentStatement?.node.type == "VariableDeclaration" &&
      parentStatement?.node.declarations.length != 0
    ) {
      return `${parentStatement?.node.declarations[0]?.id?.loc?.start.line}@${parentStatement?.node.declarations[0]?.id?.loc?.start.column}`;
    } else if (parentStatement?.node.type == "ReturnStatement") {
      if (parentStatement.parentPath.type === "BlockStatement") {
        if (
          parentStatement.parentPath.parent.type === "FunctionDeclaration" &&
          parentStatement.parentPath.parent.id?.loc != null
        ) {
          return `${parentStatement.parentPath.parent.id.loc.start.line}@${parentStatement.parentPath.parent.id.loc.start.column}`;
        } else if (
          parentStatement.parentPath.parent.type == "ArrowFunctionExpression"
        ) {
          if (
            parentStatement.parentPath.parentPath?.type ===
            "ArrowFunctionExpression"
          ) {
            if (
              parentStatement.parentPath.parentPath.parent.type ===
              "VariableDeclarator"
            ) {
              return `${parentStatement.parentPath.parentPath.parent.id.loc?.start.line}@${parentStatement.parentPath.parentPath.parent.id.loc?.start.column}`;
            }
          }
        }
      }
    }
  }

  const parentFunc = nodePath.getFunctionParent();
  if (parentFunc != null) {
    if (parentFunc?.node.type === "ArrowFunctionExpression") {
      if (
        parentFunc?.parent.type === "VariableDeclarator" &&
        parentFunc.parent.id.loc != null
      ) {
        return `${parentFunc.parent.id.loc.start.line}@${parentFunc.parent.id.loc.start.column}`;
      }
    } else if (
      parentFunc?.node.type === "FunctionDeclaration" &&
      parentFunc.node.id?.loc != null
    ) {
      return `${parentFunc.node.id.loc.start.line}@${parentFunc.node.id.loc.start.column}`;
    }
  }

  return null;
}

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

        const hasDynamicProps = nodePath.node.openingElement.attributes.some(
          (attr) =>
            attr.type === "JSXSpreadAttribute" ||
            (attr.type === "JSXAttribute" &&
              attr.value?.type === "JSXExpressionContainer"),
        );
        const isCustom =
          /^[A-Z]/.test(tag) ||
          !!componentDB.getVariableID(tag, fileName) ||
          tag === "Fragment";

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
            renders: {},
          });
        }

        componentDB.pushJSX(id);

        const isNested = componentDB.getCurrentRenderInstance() != null;
        const shouldAddRender = isCustom || hasDynamicProps || isNested;

        if (shouldAddRender) {
          const compLoc = getComponentLoc(nodePath);
          if (compLoc) {
            const instanceId = componentDB.comAddRender(
              compLoc,
              fileName,
              tag,
              dependency,
              loc,
              componentDB.getCurrentRenderInstance(),
            );
            componentDB.pushRenderInstance(instanceId);
          } else {
            componentDB.pushRenderInstance(
              componentDB.getCurrentRenderInstance(),
            );
          }
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
          componentDB.pushRenderInstance(componentDB.getCurrentRenderInstance());
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
          renders: {},
        });

        componentDB.pushJSX(id);

        const compLoc = getComponentLoc(nodePath);
        if (compLoc) {
          const instanceId = componentDB.comAddRender(
            compLoc,
            fileName,
            tag,
            [],
            loc,
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
          } else if (dep.value.type === "ref" && dep.value.refType === "named") {
            const compLoc = getComponentLoc(nodePath);
            let isComponent = false;
            if (compLoc) {
              const parts = compLoc.split("@");
              const line = parseInt(parts[0]!);
              const column = parseInt(parts[1]!);
              const varId = componentDB.getVariableIDFromLoc(fileName, {
                line,
                column,
              });

              if (varId) {
                const file = componentDB.getFile(fileName);
                const v = file.var.get(varId, true);
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
            }

            if (!isComponent) {
              const varId = componentDB.getVariableID(dep.value.name, fileName);
              if (varId) {
                const file = componentDB.getFile(fileName);
                const v = file.var.get(varId, true);
                if (v && (isJSXVariable(v) || isComponentVariable(v))) {
                  isComponent = true;
                }
              }
            }

            if (isComponent) {
              if (compLoc) {
                const loc = nodePath.node.loc?.start || { line: 0, column: 0 };
                componentDB.comAddRender(
                  compLoc,
                  fileName,
                  dep.value.name,
                  [],
                  {
                    line: loc.line,
                    column: loc.column,
                  },
                  componentDB.getCurrentRenderInstance(),
                );
              }
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
  };
}
