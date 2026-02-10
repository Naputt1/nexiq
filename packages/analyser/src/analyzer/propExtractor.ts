import * as t from "@babel/types";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import type { PropData } from "shared";
import { getDeterministicId } from "../utils/hash.js";

const generateFn: typeof generate.default = generate.default || generate;

function getPropHash(prop: Omit<PropData, "id" | "hash">): string {
  const { name, type, kind, props } = prop;
  const base = `${name}:${type}:${kind}`;
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
      const binding = scope.getBinding(name);

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
    }
  }

  return [];
}

function extractFromPattern(pattern: t.LVal, componentId?: string): PropData[] {
  const props: PropData[] = [];

  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isObjectProperty(property)) {
        if (t.isIdentifier(property.key)) {
          const propName = property.key.name;
          if (t.isIdentifier(property.value)) {
            const propBase = {
              name: property.value.name,
              type: "any",
              kind: "prop" as const,
            };
            props.push({
              id: componentId
                ? `${componentId}:prop:${propBase.name}`
                : getDeterministicId(propBase.name),
              ...propBase,
              hash: getPropHash(propBase),
            });
          } else if (
            t.isObjectPattern(property.value) ||
            t.isArrayPattern(property.value)
          ) {
            const nestedProps = extractFromPattern(property.value, componentId);
            const propBase = {
              name: propName,
              type: "any",
              kind: "prop" as const,
              props: nestedProps,
            };
            props.push({
              id: componentId
                ? `${componentId}:prop:${propBase.name}`
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
    };
    props.push({
      id: componentId
        ? `${componentId}:prop:${propBase.name}`
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
): PropData[] {
  // 1. Check React.FC<Props> on the variable declarator (if provided)
  if (variableDeclaratorId) {
    const id = variableDeclaratorId;
    if (
      t.isIdentifier(id) &&
      id.typeAnnotation &&
      t.isTSTypeAnnotation(id.typeAnnotation)
    ) {
      const typeRef = id.typeAnnotation.typeAnnotation;
      if (t.isTSTypeReference(typeRef)) {
        // Check for FC or React.FC
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
          const resolved = resolveType(
            propsType as t.TSType,
            path.scope,
            0,
            componentId,
          );
          if (resolved.length > 0) return resolved;
        }
      }
    }
  }

  // 2. Check inline type on function param
  const propsParams = path.get("params")[0];
  if (propsParams == null) return [];

  if (propsParams.isIdentifier() || propsParams.isObjectPattern()) {
    const typeAnnotation = propsParams.node.typeAnnotation;
    if (t.isTSTypeAnnotation(typeAnnotation)) {
      const resolved = resolveType(
        typeAnnotation.typeAnnotation,
        path.scope,
        0,
        componentId,
      );
      if (resolved.length > 0) return resolved;
    }
  }

  // 3. Fallback: Destructured names with 'any'
  // (Only if we failed to solve types above)
  if (propsParams.isObjectPattern() || propsParams.isIdentifier()) {
    return extractFromPattern(propsParams.node as t.LVal, componentId);
  }

  return [];
}