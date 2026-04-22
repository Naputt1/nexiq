import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import generate from "@babel/generator";
import type { PropData, PropDataType } from "@nexiq/shared";
import { getDeterministicId } from "../utils/hash.ts";
import { getExpressionData } from "./type/helper.ts";

const generateFn: typeof generate.default = generate.default || generate;

function getPropHash(prop: Omit<PropData, "id" | "hash">): string {
  const { name, type, kind, props, defaultValue } = prop;
  let base = `${name}:${type}:${kind}`;
  if (defaultValue) {
    base += `:${JSON.stringify(defaultValue)}`;
  }
  if (!props || props.length === 0) return getDeterministicId(base);
  return getDeterministicId(
    `${base}[${props.map((p) => getPropHash(p)).join(",")}]`,
  );
}

function resolveTypeMembers(
  typeLiteral: t.TSTypeLiteral | t.TSInterfaceBody,
  _scope: traverse.Scope,
  componentId?: string,
): PropData[] {
  const props: PropData[] = [];
  const members =
    typeLiteral.type === "TSTypeLiteral"
      ? typeLiteral.members
      : typeLiteral.body;

  for (const member of members) {
    if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
      const propBase = {
        name: member.key.name,
        type: generateFn(
          member.typeAnnotation?.typeAnnotation ?? t.anyTypeAnnotation(),
        ).code,
        kind: "prop" as const,
        loc: member.key.loc
          ? {
              line: member.key.loc.start.line,
              column: member.key.loc.start.column,
            }
          : undefined,
      };
      props.push({
        id: componentId
          ? `${componentId}:prop:${propBase.name}`
          : getDeterministicId(propBase.name),
        ...propBase,
        hash: getPropHash(propBase),
      });
    }
  }
  return props;
}

function resolveType(
  typeAnnotation: t.TSType,
  scope: traverse.Scope,
  depth = 0,
  componentId?: string,
): PropData[] {
  if (depth > 5) return []; // Prevent infinite recursion

  if (t.isTSTypeLiteral(typeAnnotation)) {
    return resolveTypeMembers(typeAnnotation, scope, componentId);
  }

  if (t.isTSTypeReference(typeAnnotation)) {
    if (t.isIdentifier(typeAnnotation.typeName)) {
      const name = typeAnnotation.typeName.name;
      let currentScope: traverse.Scope | null = scope;
      let binding: ReturnType<traverse.Scope["getBinding"]> | undefined;

      while (currentScope && !binding) {
        binding = currentScope.getBinding(name);
        currentScope = currentScope.parent;
      }

      if (binding) {
        if (binding.path.isTSTypeAliasDeclaration()) {
          return resolveType(
            binding.path.node.typeAnnotation as t.TSType,
            scope,
            depth + 1,
            componentId,
          );
        } else if (binding.path.isTSInterfaceDeclaration()) {
          // Interfaces might extend others, but let's handle basic body first
          return resolveTypeMembers(binding.path.node.body, scope, componentId);
        }
      }

      let programPath = scope.path;
      while (programPath.parentPath) {
        programPath = programPath.parentPath;
      }

      if (programPath.isProgram()) {
        for (const statement of programPath.get("body")) {
          if (
            statement.isTSTypeAliasDeclaration() &&
            t.isIdentifier(statement.node.id) &&
            statement.node.id.name === name
          ) {
            return resolveType(
              statement.node.typeAnnotation as t.TSType,
              scope,
              depth + 1,
              componentId,
            );
          }

          if (
            statement.isTSInterfaceDeclaration() &&
            t.isIdentifier(statement.node.id) &&
            statement.node.id.name === name
          ) {
            return resolveTypeMembers(statement.node.body, scope, componentId);
          }
        }
      }
    }
  }

  return [];
}

export function extractFromPattern(
  pattern: t.LVal,
  componentId?: string,
): PropData[] {
  const props: PropData[] = [];

  if (t.isAssignmentPattern(pattern)) {
    return extractFromPattern(pattern.left as t.LVal, componentId);
  }

  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isObjectProperty(property)) {
        if (t.isIdentifier(property.key)) {
          const propName = property.key.name;
          let value: t.LVal = property.value as t.LVal;
          let defaultValue: PropDataType | undefined;

          if (t.isAssignmentPattern(value)) {
            defaultValue = getExpressionData(value.right) ?? undefined;
            value = value.left;
          }

          if (t.isIdentifier(value)) {
            const propBase: Omit<PropData, "id" | "hash"> = {
              name: value.name,
              type: "any",
              kind: "prop" as const,
              defaultValue,
              loc: value.loc
                ? {
                    line: value.loc.start.line,
                    column: value.loc.start.column,
                  }
                : undefined,
            };
            props.push({
              id: componentId
                ? `${componentId}:prop:${propBase.name}`
                : getDeterministicId(propBase.name),
              ...propBase,
              hash: getPropHash(propBase),
            });
          } else if (t.isObjectPattern(value) || t.isArrayPattern(value)) {
            const nestedProps = extractFromPattern(value, componentId);
            const propBase: Omit<PropData, "id" | "hash"> = {
              name: propName,
              type: "any",
              kind: "prop" as const,
              props: nestedProps,
              defaultValue,
              loc: property.key.loc
                ? {
                    line: property.key.loc.start.line,
                    column: property.key.loc.start.column,
                  }
                : undefined,
            };
            props.push({
              id: componentId
                ? `${componentId}:prop:${propName}`
                : getDeterministicId(propName),
              ...propBase,
              hash: getPropHash(propBase),
            });
          }
        }
      } else if (t.isRestElement(property)) {
        if (t.isIdentifier(property.argument)) {
          const propBase = {
            name: property.argument.name,
            type: "any",
            kind: "spread" as const,
            loc: property.argument.loc
              ? {
                  line: property.argument.loc.start.line,
                  column: property.argument.loc.start.column,
                }
              : undefined,
          };
          props.push({
            id: componentId
              ? `${componentId}:prop:${propBase.name}`
              : getDeterministicId(propBase.name),
            ...propBase,
            hash: getPropHash(propBase),
          });
        }
      }
    }
  } else if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element && t.isLVal(element)) {
        props.push(...extractFromPattern(element, componentId));
      }
    }
  } else if (t.isIdentifier(pattern)) {
    const propBase = {
      name: pattern.name,
      type: "any",
      kind: "prop" as const,
      loc: pattern.loc
        ? {
            line: pattern.loc.start.line,
            column: pattern.loc.start.column,
          }
        : undefined,
    };
    props.push({
      id: componentId
        ? `${componentId}:prop:${pattern.name}`
        : getDeterministicId(pattern.name),
      ...propBase,
      hash: getPropHash(propBase),
    });
  }

  return props;
}

export function getProps(
  path: traverse.NodePath<
    t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration
  >,
  variableDeclaratorId?: t.Identifier,
  componentId?: string,
): { props: PropData[]; propName?: string | undefined } {
  let propName: string | undefined;
  const props: PropData[] = [];

  // 1. Extract base props from parameters (this gives us the usage locations)
  const params = path.get("params");
  const paramsArray = Array.isArray(params) ? params : [];

  for (const [index, propsParams] of paramsArray.entries()) {
    if (
      propsParams.isIdentifier() ||
      propsParams.isObjectPattern() ||
      propsParams.isAssignmentPattern()
    ) {
      if (index === 0 && propsParams.isIdentifier()) {
        propName = propsParams.node.name;
      }
      props.push(...extractFromPattern(propsParams.node as t.LVal, componentId));
    }
  }

  // 2. Try to enrich with type information
  let resolvedFromType: PropData[] = [];

  // 2a. Check React.FC<Props> on the variable declarator
  if (variableDeclaratorId) {
    const id = variableDeclaratorId;
    if (
      t.isIdentifier(id) &&
      id.typeAnnotation &&
      t.isTSTypeAnnotation(id.typeAnnotation)
    ) {
      const typeRef = id.typeAnnotation.typeAnnotation;
      if (t.isTSTypeReference(typeRef)) {
        let isFC = false;
        if (
          t.isIdentifier(typeRef.typeName) &&
          (typeRef.typeName.name === "FC" ||
            typeRef.typeName.name === "FunctionComponent")
        ) {
          isFC = true;
        } else if (t.isTSQualifiedName(typeRef.typeName)) {
          if (
            t.isIdentifier(typeRef.typeName.left) &&
            typeRef.typeName.left.name === "React" &&
            t.isIdentifier(typeRef.typeName.right) &&
            (typeRef.typeName.right.name === "FC" ||
              typeRef.typeName.right.name === "FunctionComponent")
          ) {
            isFC = true;
          }
        }

        if (
          isFC &&
          typeRef.typeParameters &&
          typeRef.typeParameters.params.length > 0
        ) {
          const propsType = typeRef.typeParameters.params[0];
          resolvedFromType = resolveType(
            propsType as t.TSType,
            path.scope,
            0,
            componentId,
          );
        }
      }
    }
  }

  // 2b. Check inline type on function params if not resolved yet
  if (resolvedFromType.length === 0) {
    for (const propsParams of paramsArray) {
      let node: t.LVal = propsParams.node as t.LVal;
      if (t.isAssignmentPattern(node)) {
        node = node.left;
      }

      if (
        (t.isIdentifier(node) ||
          t.isObjectPattern(node) ||
          t.isArrayPattern(node) ||
          t.isRestElement(node)) &&
        node.typeAnnotation &&
        t.isTSTypeAnnotation(node.typeAnnotation)
      ) {
        resolvedFromType = resolveType(
          node.typeAnnotation.typeAnnotation,
          path.scope,
          0,
          componentId,
        );
        if (resolvedFromType.length > 0) break;
      }
    }
  }

  // 3. Merge resolved types into extracted props (keeping parameter locations)
  if (resolvedFromType.length > 0) {
    // If no props extracted (e.g. `const Comp = (props: Props) => ...`)
    if (props.length === 0) {
      return { props: resolvedFromType, propName };
    }

    // Map of name -> type info
    const typeMap = new Map(resolvedFromType.map((p) => [p.name, p]));

    for (const prop of props) {
      const typeInfo = typeMap.get(prop.name);
      if (typeInfo) {
        prop.type = typeInfo.type;
        if (typeInfo.props) {
          prop.props = typeInfo.props;
        }
        // Update hash after enriching
        prop.hash = getPropHash(prop);
      }
    }
  }

  return { props, propName };
}
