import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.js";
import type { ComponentInfoRenderDependency } from "shared";
import assert from "assert";
import { fullDebug } from "../utils/debug.js";
import generate from "@babel/generator";
import { getDeterministicId } from "../utils/hash.js";
import { getExpressionData } from "./type/helper.js";

const generateFn: typeof generate.default = generate.default || generate;

function getComponentLoc(nodePath: traverse.NodePath<t.JSXElement>) {
  const parentFunc = nodePath.getFunctionParent();
  const parentStatement = nodePath.getStatementParent();

  let compLoc = null;
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
            } else if (
              parentStatement.parentPath.parentPath.parentPath?.type ===
              "CallExpression"
            ) {
              if (
                parentStatement.parentPath.parentPath.parentPath.parent.type ===
                "VariableDeclarator"
              ) {
                return `${parentStatement.parentPath.parentPath.parentPath.parent.id.loc?.start.line}@${parentStatement.parentPath.parentPath.parentPath.parent.id.loc?.start.column}`;
              } else {
                fullDebug();
              }
            } else if (
              parentStatement.parentPath.parentPath.parentPath?.type ===
              "JSXExpressionContainer"
            ) {
              // intentionally empty
            } else {
              fullDebug();
            }
          } else {
            fullDebug();
          }
        } else {
          fullDebug();
        }
      } else {
        fullDebug();
      }
    } else if (parentStatement?.node.type == "ExpressionStatement") {
      //TODO: handle expression statement like ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
    } else {
      fullDebug();
    }
  }

  if (compLoc == null && parentFunc != null) {
    if (parentFunc?.node.type === "ArrowFunctionExpression") {
      if (
        parentFunc?.parent.type === "VariableDeclarator" &&
        parentFunc.parent.id.loc != null
      ) {
        compLoc = `${parentFunc.parent.id.loc.start.line}@${parentFunc.parent.id.loc.start.column}`;
      } else if (
        parentFunc?.parent.type === "CallExpression" &&
        parentFunc.parentPath.parent.type === "VariableDeclarator"
      ) {
        compLoc = `${parentFunc.parentPath.parent.id.loc?.start.line}@${parentFunc.parentPath.parent.id.loc?.start.column}`;
      } else {
        if (process.env.ANALYSER_DEBUG) {
          fullDebug();
        }
      }
    } else if (
      parentFunc?.node.type === "FunctionDeclaration" &&
      parentFunc.node.id?.loc != null
    ) {
      compLoc = `${parentFunc.node.id.loc.start.line}@${parentFunc.node.id.loc.start.column}`;
    } else {
      fullDebug();
    }
  }

  return compLoc;
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
): traverse.VisitNode<traverse.Node, t.JSXElement> {
  return (nodePath) => {
    const opening = nodePath.node.openingElement.name;
    if (opening.type === "JSXIdentifier") {
      const tag = opening.name;
      const parentFunc = nodePath.getFunctionParent();

      let compName = null;
      const compLoc = getComponentLoc(nodePath);

      assert(nodePath.node.loc?.start != null);
      const loc = {
        line: nodePath.node.loc.start.line,
        column: nodePath.node.loc.start.column,
      };

      if (parentFunc?.node.type === "FunctionDeclaration") {
        // function MyComponent() {}
        compName = parentFunc.node.id?.name;
      } else if (
        parentFunc?.node.type === "ArrowFunctionExpression" ||
        parentFunc?.node.type === "FunctionExpression"
      ) {
        // const MyComponent = () => {}
        const parent = parentFunc.parentPath?.node;
        if (parent?.type === "VariableDeclarator") {
          const id = parent.id;

          if (id.type === "Identifier") {
            compName = id.name;
          }
        }
      } else {
        compName = parentFunc?.node.type;
      }

      if (compName == null) {
        return;
      }

      // TODO: handle ObjectMethod
      if (compName == "ObjectMethod") {
        return;
      }

      // const key = getComponentKey(compName, file);
      // let id = componentIds.get(key);

      // if (id == null) {
      //   id = "placeholder-id";
      //   componentIds.set(key, id);
      // }

      if (/^[A-Z]/.test(tag)) {
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
            } else {
              dependency.push({
                id: getDeterministicId(prop.name.name),
                name: prop.name.name,
                value: {
                  type: "literal-type",
                  literal: { type: "string", value: "" },
                },
              });
            }
          } else if (prop.type === "JSXSpreadAttribute") {
            extractDependencies(prop.argument, "...", dependency);
          }
        }

        if (compLoc != null) {
          componentDB.comAddRender(compLoc, fileName, tag, dependency, loc);
        }
      }
    }
  };
}
