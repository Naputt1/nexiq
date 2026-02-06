import * as t from "@babel/types";
import traverse from "@babel/traverse";
import generate from "@babel/generator";
import type { PropData } from "shared";
import { newUUID } from "../utils/uuid.js";

const generateFn: typeof generate.default = generate.default || generate;

function resolveTypeMembers(
  typeLiteral: t.TSTypeLiteral | t.TSInterfaceBody,
  _scope: traverse.Scope,
): PropData[] {
  const props: PropData[] = [];
  const members =
    typeLiteral.type === "TSTypeLiteral"
      ? typeLiteral.members
      : typeLiteral.body;

  for (const member of members) {
    if (t.isTSPropertySignature(member) && t.isIdentifier(member.key)) {
      props.push({
        id: newUUID(),
        name: member.key.name,
        type: generateFn(
          member.typeAnnotation?.typeAnnotation ?? t.anyTypeAnnotation(),
        ).code,
        kind: "prop",
      });
    }
  }
  return props;
}

function resolveType(
  typeAnnotation: t.TSType,
  scope: traverse.Scope,
  depth = 0,
): PropData[] {
  if (depth > 5) return []; // Prevent infinite recursion

  if (t.isTSTypeLiteral(typeAnnotation)) {
    return resolveTypeMembers(typeAnnotation, scope);
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
          );
        } else if (binding.path.isTSInterfaceDeclaration()) {
          // Interfaces might extend others, but let's handle basic body first
          return resolveTypeMembers(binding.path.node.body, scope);
        }
      }
    }
  }

  return [];
}

function extractFromPattern(pattern: t.LVal): PropData[] {
  const props: PropData[] = [];

  if (t.isObjectPattern(pattern)) {
    for (const property of pattern.properties) {
      if (t.isObjectProperty(property)) {
        if (t.isIdentifier(property.key)) {
          const propName = property.key.name;
          if (t.isIdentifier(property.value)) {
            props.push({
              id: newUUID(),
              name: property.value.name,
              type: "any",
              kind: "prop",
            });
          } else if (
            t.isObjectPattern(property.value) ||
            t.isArrayPattern(property.value)
          ) {
            props.push({
              id: newUUID(),
              name: propName,
              type: "any",
              kind: "prop",
              props: extractFromPattern(property.value),
            });
          }
        }
      } else if (t.isRestElement(property)) {
        if (t.isIdentifier(property.argument)) {
          props.push({
            id: newUUID(),
            name: property.argument.name,
            type: "any",
            kind: "spread",
          });
        }
      }
    }
  } else if (t.isArrayPattern(pattern)) {
    for (const element of pattern.elements) {
      if (element && t.isLVal(element)) {
        props.push(...extractFromPattern(element));
      }
    }
  } else if (t.isIdentifier(pattern)) {
    props.push({
      id: newUUID(),
      name: pattern.name,
      type: "any",
      kind: "prop",
    });
  }

  return props;
}

export function getProps(
  path: traverse.NodePath<
    t.ArrowFunctionExpression | t.FunctionExpression | t.FunctionDeclaration
  >,
  variableDeclaratorId?: t.Identifier,
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
          const resolved = resolveType(propsType as t.TSType, path.scope);
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
      const resolved = resolveType(typeAnnotation.typeAnnotation, path.scope);
      if (resolved.length > 0) return resolved;
    }
  }

  // 3. Fallback: Destructured names with 'any'
  // (Only if we failed to solve types above)
  if (propsParams.isObjectPattern() || propsParams.isIdentifier()) {
    return extractFromPattern(propsParams.node as t.LVal);
  }

  return [];
}
