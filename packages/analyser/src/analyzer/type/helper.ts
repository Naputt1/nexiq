import type {
  TypeData,
  TypeDataLiteralBody,
  TypeDataLiteralTypeLiteral,
  TypeDataRef,
} from "shared/src/types/primitive.js";
import * as t from "@babel/types";
import assert from "assert";

function getLiteralType(literal: t.TSLiteralType): TypeDataLiteralTypeLiteral {
  switch (literal.literal.type) {
    case "BooleanLiteral":
      return {
        type: "boolean",
        value: literal.literal.value,
      };
    case "NumericLiteral":
      return {
        type: "number",
        value: literal.literal.value,
      };
    case "StringLiteral":
      return {
        type: "string",
        value: literal.literal.value,
      };
    case "BigIntLiteral":
      return {
        type: "bigint",
        value: literal.literal.value,
      };
    case "TemplateLiteral": {
      const literalType: TypeDataLiteralTypeLiteral = {
        type: "template",
        expression: [],
        quasis: [],
      };

      for (const quasi of literal.literal.quasis) {
        literalType.quasis.push(quasi.value.raw);
      }

      for (const expr of literal.literal.expressions) {
        assert(!t.isExpression(expr));

        literalType.expression.push(getType(expr));
      }

      return literalType;
    }
    case "UnaryExpression": {
      const arg = literal.literal.argument;

      if (t.isNumericLiteral(arg)) {
        return {
          type: "unary",
          operator: literal.literal.operator,
          prefix: literal.literal.prefix,
          argument: {
            type: "number",
            value: arg.value,
          },
        };
      } else if (t.isBigIntLiteral(arg)) {
        return {
          type: "unary",
          operator: literal.literal.operator,
          prefix: literal.literal.prefix,
          argument: {
            type: "bigint",
            value: arg.value,
          },
        };
      }

      assert(false, "invlid unary literal type");
    }
  }

  assert(false, "invlid literal type");
}

function getQualifiedName(tsType: t.TSQualifiedName): string[] {
  const id: string[] = [];

  if (tsType.left.type === "Identifier") {
    id.push(tsType.left.name);
  } else if (tsType.left.type === "TSQualifiedName") {
    id.push(...getQualifiedName(tsType.left));
  } else {
    debugger;
  }

  if (tsType.right.type === "Identifier") {
    id.push(tsType.right.name);
  }

  return id;
}

export function getType(tsType: t.TSType | t.TSTypeAnnotation): TypeData {
  if (tsType.type === "TSTypeAnnotation") {
    return getType(tsType.typeAnnotation);
  }

  switch (tsType.type) {
    case "TSStringKeyword":
      return {
        type: "string",
      };
    case "TSNumberKeyword":
      return {
        type: "number",
      };
    case "TSBooleanKeyword":
      return {
        type: "boolean",
      };
    case "TSLiteralType":
      return {
        type: "literal-type",
        literal: getLiteralType(tsType),
      };
    case "TSNullKeyword":
      return {
        type: "null",
      };
    case "TSUndefinedKeyword":
      return {
        type: "undefined",
      };
    case "TSVoidKeyword":
      return {
        type: "void",
      };
    case "TSUnknownKeyword":
      return {
        type: "unknown",
      };
    case "TSNeverKeyword":
      return {
        type: "never",
      };
    case "TSBigIntKeyword":
      return {
        type: "bigint",
      };
    case "TSTypeReference": {
      let typeData: TypeDataRef;
      if (tsType.typeName.type === "Identifier") {
        typeData = {
          type: "ref",
          refType: "named",
          name: tsType.typeName.name,
        };
      } else if (tsType.typeName.type === "TSQualifiedName") {
        typeData = {
          type: "ref",
          refType: "qualified",
          names: getQualifiedName(tsType.typeName),
        };
      } else {
        debugger;
        assert(false, "invlid type reference");
      }

      if (tsType.typeParameters) {
        typeData.params = [];
        for (const param of tsType.typeParameters.params) {
          typeData.params!.push(getType(param));
        }
      }

      return typeData;
    }
    case "TSArrayType": {
      return {
        type: "array",
        element: getType(tsType.elementType),
      };
    }
    case "TSAnyKeyword":
      return {
        type: "any",
      };
    case "TSUnionType": {
      const typeData: TypeData = {
        type: "union",
        members: [],
      };

      for (const member of tsType.types) {
        typeData.members.push(getType(member));
      }

      return typeData;
    }
    case "TSIntersectionType": {
      const typeData: TypeData = {
        type: "intersection",
        members: [],
      };

      for (const member of tsType.types) {
        typeData.members.push(getType(member));
      }

      return typeData;
    }
    case "TSTypeLiteral": {
      const typeData: TypeData = {
        type: "type-literal",
        members: [],
      };

      for (const member of tsType.members) {
        if (member.type === "TSPropertySignature") {
          // TODO: handle other type
          if (
            member.key.type != "Identifier" ||
            member.typeAnnotation?.type != "TSTypeAnnotation"
          )
            continue;
          assert(member.key.type == "Identifier");
          assert(member.typeAnnotation?.type == "TSTypeAnnotation");

          const body: TypeDataLiteralBody = {
            signatureType: "property",
            name: member.key.name,
            type: getType(member.typeAnnotation.typeAnnotation),
          };

          if (member.optional) {
            body.optional = true;
          }

          if (member.computed) {
            body.computed = true;
          }

          typeData.members.push(body);
        } else if (member.type === "TSIndexSignature") {
          assert(member.typeAnnotation?.type == "TSTypeAnnotation");
          assert(member.parameters.length == 1);
          assert(
            member.parameters[0]!.typeAnnotation?.type == "TSTypeAnnotation"
          );

          typeData.members.push({
            signatureType: "index",
            type: getType(member.typeAnnotation.typeAnnotation),
            parameter: {
              name: member.parameters[0]!.name,
              type: getType(
                member.parameters[0]!.typeAnnotation.typeAnnotation
              ),
            },
          });
        } else {
          debugger;
        }
      }

      return typeData;
    }
    case "TSParenthesizedType": {
      return {
        type: "parenthesis",
        members: getType(tsType.typeAnnotation),
      };
    }
    default: {
      debugger;
    }
  }

  return {
    type: "any",
  };
}
