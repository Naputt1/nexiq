import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { ComponentDB } from "../db/componentDB.ts";
import { returnJSX } from "../utils.ts";
import assert from "assert";
import { getPattern } from "./pattern.ts";
import type { ComponentFileVar, DistributiveOmit } from "@nexiq/shared";
import { generateFn } from "../utils/babel.ts";
import type { TypeData } from "@nexiq/shared";
import { getExpressionData } from "./type/helper.ts";

export function extractStateKeys(
  node: t.Node | null,
  scope: traverse.Scope,
  depth = 0,
): { name: string; type?: TypeData }[] {
  if (!node || depth > 5) return [];
  if (t.isObjectExpression(node)) {
    const keys: { name: string; type?: TypeData }[] = [];
    for (const p of node.properties) {
      if (t.isObjectProperty(p) && !p.computed && t.isIdentifier(p.key)) {
        const typeData = t.isExpression(p.value)
          ? (getExpressionData(p.value) as TypeData)
          : undefined;
        keys.push({ name: p.key.name, type: typeData });
      } else if (t.isSpreadElement(p)) {
        if (t.isIdentifier(p.argument)) {
          const binding = scope.getBinding(p.argument.name);
          if (
            binding &&
            t.isVariableDeclarator(binding.path.node) &&
            binding.path.node.init
          ) {
            keys.push(
              ...extractStateKeys(binding.path.node.init, scope, depth + 1),
            );
          }
        }
      }
    }
    return keys;
  }
  if (t.isArrowFunctionExpression(node) || t.isFunctionExpression(node)) {
    if (t.isObjectExpression(node.body)) {
      return extractStateKeys(node.body, scope, depth + 1);
    }
    if (t.isBlockStatement(node.body)) {
      const lastStatement = node.body.body.at(-1);
      if (t.isReturnStatement(lastStatement) && lastStatement.argument) {
        return extractStateKeys(lastStatement.argument, scope, depth + 1);
      }
    }
  }
  return [];
}

export function getStartLoc(node: t.Node): { line: number; column: number } {
  return {
    line: node.loc!.start.line,
    column: node.loc!.start.column,
  };
}

export const LIFECYCLE_METHODS = [
  "componentDidMount",
  "componentDidUpdate",
  "componentWillUnmount",
  "componentDidCatch",
  "getDerivedStateFromProps",
  "getSnapshotBeforeUpdate",
  "shouldComponentUpdate",
];

export default function ClassDeclaration(
  componentDB: ComponentDB,
  fileName: string,
): traverse.VisitNode<traverse.Node, t.ClassDeclaration | t.ClassExpression> {
  return (nodePath) => {
    const id = nodePath.node.id;
    if (!id && nodePath.isClassDeclaration()) return;

    const pattern = id
      ? getPattern(id)
      : ({
          type: "identifier" as const,
          name: "anonymous",
          loc: { line: 0, column: 0 },
          id: "anonymous",
        } as const);

    const loc = id?.loc
      ? {
          line: id.loc.start.line,
          column: id.loc.start.column,
        }
      : {
          line: nodePath.node.loc!.start.line,
          column: nodePath.node.loc!.start.column,
        };

    assert(nodePath.node.loc != null, "Class loc not found");

    const scope = {
      start: {
        line: nodePath.node.loc.start.line,
        column: nodePath.node.loc.start.column,
      },
      end: {
        line: nodePath.node.loc.end.line,
        column: nodePath.node.loc.end.column,
      },
    };

    const superClassNode = nodePath.node.superClass;
    let superClass: { id?: string; name: string } | undefined;
    if (superClassNode) {
      if (t.isIdentifier(superClassNode)) {
        superClass = { name: superClassNode.name };
      } else {
        superClass = { name: generateFn(superClassNode).code };
      }
    }

    const superTypeParameters = nodePath.node.superTypeParameters;
    let propTypeToResolve: TypeData | undefined;
    let stateType: TypeData | undefined;

    if (
      superTypeParameters &&
      t.isTSTypeParameterInstantiation(superTypeParameters)
    ) {
      const params = superTypeParameters.params;
      if (params.length >= 1) {
        const propsType = params[0];
        if (
          t.isTSTypeReference(propsType) &&
          t.isIdentifier(propsType.typeName)
        ) {
          propTypeToResolve = {
            type: "ref",
            refType: "named",
            name: propsType.typeName.name,
          };
        }
      }
      if (params.length >= 2) {
        const sType = params[1];
        if (t.isTSTypeReference(sType) && t.isIdentifier(sType.typeName)) {
          stateType = {
            type: "ref",
            refType: "named",
            name: sType.typeName.name,
          };
        }
      }
    }

    let isComponent = false;
    // Heuristic: check if it has a render method returning JSX
    for (const member of nodePath.node.body.body) {
      if (
        t.isClassMethod(member) &&
        t.isIdentifier(member.key, { name: "render" })
      ) {
        if (returnJSX(member)) {
          isComponent = true;
          break;
        }
      }
      if (
        t.isClassProperty(member) &&
        t.isIdentifier(member.key, { name: "render" })
      ) {
        if (
          t.isArrowFunctionExpression(member.value) ||
          t.isFunctionExpression(member.value)
        ) {
          if (returnJSX(member.value)) {
            isComponent = true;
            break;
          }
        }
      }
    }

    if (isComponent) {
      componentDB.addClassComponent(fileName, {
        name: pattern,
        type: "class" as const,
        componentType: "Class",
        hooks: [],
        props: [],
        refs: [],
        propName: "this.props",
        propType: propTypeToResolve,
        stateType,
        contexts: [],
        dependencies: {},
        var: {},
        children: {},
        loc,
        scope,
        async: false,
        effects: {},
        forwardRef: false,
        superClass,
      });
    } else {
      // Just register as a variable
      componentDB.addVariable(
        fileName,
        {
          name: pattern,
          dependencies: {},
          type: "class",
          loc,
          scope,
          async: false,
          superClass,
        } as DistributiveOmit<
          ComponentFileVar,
          "id" | "kind" | "var" | "children" | "file" | "hash" | "components"
        >,
        "class",
        "const",
      );
    }
  };
}
