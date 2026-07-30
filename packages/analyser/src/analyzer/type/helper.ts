import type {
  PropDataType,
  TypeData,
  TypeDataConstructor,
  TypeDataConditional,
  TypeDataFunction,
  TypeDataFunctionParameter,
  TypeDataImport,
  TypeDataInfer,
  TypeDataLiteralBody,
  TypeDataLiteralBodyMethod,
  TypeDataLiteralBodyProperty,
  TypeDataLiteralTypeLiteral,
  TypeDataMapped,
  TypeDataPredicate,
  TypeDataRef,
  TypeDataTuple,
  TypeDataTypeOperator,
} from "@nexiq/shared";
import * as t from "@babel/types";
import assert from "assert";
import type { FuncParam, TypeDataParamFunction } from "@nexiq/shared";
import { generateFn } from "../../utils/babel.ts";

function getTypeParameter(tsType: t.TSTypeParameter): TypeDataParamFunction {
  const data: TypeDataParamFunction = {
    name: tsType.name,
  };

  if (tsType.constraint) {
    data.constraint = getType(tsType.constraint);
  }

  if (tsType.default) {
    data.default = getType(tsType.default);
  }

  if (tsType.in) {
    data.in = true;
  }

  if (tsType.out) {
    data.out = true;
  }

  return data;
}

function getFuncParam(
  param: t.TSFunctionType["parameters"][number],
): FuncParam {
  switch (param.type) {
    case "Identifier":
      return {
        type: "named",
        name: param.name,
      };
    case "ObjectPattern": {
      const funcParam: FuncParam = {
        type: "object-pattern",
        property: [],
      };

      for (const property of param.properties) {
        if (property.type === "ObjectProperty") {
          assert(property.key.type == "Identifier");

          assert(
            property.value.type == "Identifier" ||
              property.value.type == "ObjectPattern" ||
              property.value.type == "ArrayPattern" ||
              property.value.type == "RestElement",
          );

          funcParam.property.push({
            type: "object-property",
            shorthand: property.shorthand,
            key: property.key.name,
            value: getFuncParam(property.value),
          });
        } else if (property.type == "RestElement") {
          assert(property.argument.type == "Identifier");

          funcParam.property.push({
            type: "rest-element",
            name: property.argument.name,
          });
        } else {
          // debugger;
        }
      }

      return funcParam;
    }
    case "ArrayPattern": {
      const funcParam: FuncParam = {
        type: "array-pattern",
        elements: [],
      };

      for (const element of param.elements) {
        assert(element != null);

        assert(
          element.type == "Identifier" ||
            element.type == "ObjectPattern" ||
            element.type == "ArrayPattern" ||
            element.type == "RestElement",
        );

        funcParam.elements.push(getFuncParam(element));
      }

      return funcParam;
    }
    case "RestElement":
      assert(param.argument.type == "Identifier");

      return {
        type: "rest-element",
        name: param.argument.name,
      };
  }
}

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
    // debugger;
  }

  if (tsType.right.type === "Identifier") {
    id.push(tsType.right.name);
  }

  return id;
}

export function getMember(member: t.TSTypeElement): TypeDataLiteralBody | null {
  if (member.type === "TSPropertySignature") {
    if (
      member.key.type !== "Identifier" ||
      member.typeAnnotation?.type !== "TSTypeAnnotation"
    ) {
      return null;
    }

    const body: TypeDataLiteralBodyProperty = {
      signatureType: "property",
      name: member.key.name,
      type: getType(member.typeAnnotation.typeAnnotation),
    };

    if (member.loc) {
      body.loc = {
        line: member.loc.start.line,
        column: member.loc.start.column,
      };
    }

    if (member.optional) {
      body.optional = true;
    }

    if (member.computed) {
      body.computed = true;
    }

    return body;
  } else if (member.type === "TSIndexSignature") {
    if (
      member.typeAnnotation?.type !== "TSTypeAnnotation" ||
      member.parameters.length !== 1 ||
      member.parameters[0]!.typeAnnotation?.type !== "TSTypeAnnotation"
    ) {
      return null;
    }

    return {
      signatureType: "index",
      type: getType(member.typeAnnotation.typeAnnotation),
      parameter: {
        name: member.parameters[0]!.name,
        type: getType(member.parameters[0]!.typeAnnotation.typeAnnotation),
      },
    };
  } else if (member.type === "TSMethodSignature") {
    if (member.key.type !== "Identifier") {
      return null;
    }

    const body: TypeDataLiteralBodyMethod = {
      signatureType: "method",
      name: member.key.name,
      params: [],
      parameters: [],
      return: member.typeAnnotation
        ? getType(member.typeAnnotation.typeAnnotation)
        : { type: "void" },
    };

    if (member.loc) {
      body.loc = {
        line: member.loc.start.line,
        column: member.loc.start.column,
      };
    }

    if (member.optional) {
      body.optional = true;
    }

    if (member.computed) {
      body.computed = true;
    }

    if (member.typeParameters) {
      for (const param of member.typeParameters.params) {
        body.params.push(getTypeParameter(param));
      }
    }

    for (const param of member.parameters) {
      const parameter: TypeDataFunctionParameter = {
        param: getFuncParam(param),
      };

      if (param.typeAnnotation) {
        assert(t.isTSTypeAnnotation(param.typeAnnotation));
        parameter.typeData = getType(param.typeAnnotation);
      }

      if ("optional" in param && param.optional) {
        parameter.optional = true;
      }

      body.parameters.push(parameter);
    }

    return body;
  } else if (member.type === "TSCallSignatureDeclaration") {
    assert(member.typeAnnotation?.type === "TSTypeAnnotation");
    const body: TypeDataLiteralBodyMethod = {
      signatureType: "method",
      name: "",
      params: [],
      parameters: [],
      return: getType(member.typeAnnotation.typeAnnotation),
    };

    if (member.typeParameters) {
      for (const param of member.typeParameters.params) {
        body.params.push(getTypeParameter(param));
      }
    }

    for (const param of member.parameters) {
      const parameter: TypeDataFunctionParameter = {
        param: getFuncParam(param),
      };

      if (param.typeAnnotation) {
        assert(t.isTSTypeAnnotation(param.typeAnnotation));
        parameter.typeData = getType(param.typeAnnotation);
      }

      if ("optional" in param && param.optional) {
        parameter.optional = true;
      }

      body.parameters.push(parameter);
    }

    return body;
  } else if (member.type === "TSConstructSignatureDeclaration") {
    assert(member.typeAnnotation?.type === "TSTypeAnnotation");
    const body: TypeDataLiteralBodyMethod = {
      signatureType: "method",
      name: "",
      params: [],
      parameters: [],
      return: getType(member.typeAnnotation.typeAnnotation),
    };

    if (member.typeParameters) {
      for (const param of member.typeParameters.params) {
        body.params.push(getTypeParameter(param));
      }
    }

    for (const param of member.parameters) {
      const parameter: TypeDataFunctionParameter = {
        param: getFuncParam(param),
      };

      if (param.typeAnnotation) {
        assert(t.isTSTypeAnnotation(param.typeAnnotation));
        parameter.typeData = getType(param.typeAnnotation);
      }

      if ("optional" in param && param.optional) {
        parameter.optional = true;
      }

      body.parameters.push(parameter);
    }

    return body;
  }

  return null;
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
        // debugger;
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
    case "TSObjectKeyword":
      return {
        type: "object",
      };
    case "TSSymbolKeyword":
      return {
        type: "symbol",
      };
    case "TSThisType":
      return {
        type: "this",
      };
    case "TSExpressionWithTypeArguments": {
      let typeData: TypeDataRef;
      const expr = tsType.expression;
      if (expr.type === "Identifier") {
        typeData = {
          type: "ref",
          refType: "named",
          name: expr.name,
        };
      } else if (expr.type === "TSQualifiedName") {
        typeData = {
          type: "ref",
          refType: "qualified",
          names: getQualifiedName(expr),
        };
      } else {
        assert(false, "invlid type reference");
      }

      if (tsType.typeParameters) {
        typeData.params = [];
        for (const param of tsType.typeParameters.params) {
          typeData.params.push(getType(param));
        }
      }

      return typeData;
    }
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
        const memberData = getMember(member);
        if (memberData) {
          typeData.members.push(memberData);
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
    case "TSFunctionType": {
      assert(tsType.typeAnnotation != null);

      const typeData: TypeDataFunction = {
        type: "function",
        params: [],
        parameters: [],
        return: getType(tsType.typeAnnotation),
      };

      if (tsType.typeParameters) {
        typeData.params = [];
        for (const param of tsType.typeParameters.params) {
          typeData.params.push(getTypeParameter(param));
        }
      }

      if (tsType.parameters) {
        typeData.parameters = [];
        for (const param of tsType.parameters) {
          const parameter: TypeDataFunctionParameter = {
            param: getFuncParam(param),
          };

          if (param.typeAnnotation) {
            assert(t.isTSTypeAnnotation(param.typeAnnotation));

            parameter.typeData = getType(param.typeAnnotation);
          }

          if ("optional" in param && param.optional) {
            parameter.optional = true;
          }

          typeData.parameters.push(parameter);
        }
      }

      return typeData;
    }
    case "TSTupleType": {
      const typeData: TypeDataTuple = {
        type: "tuple",
        elements: [],
      };

      for (const element of tsType.elementTypes) {
        if (element.type === "TSNamedTupleMember") {
          typeData.elements.push({
            type: "named",
            name: element.label.name,
            optional: element.optional,
            typeData: getType(element.elementType),
          });
        } else if (element.type === "TSOptionalType") {
          typeData.elements.push({
            type: "unnamed",
            optional: true,
            typeData: getType(element.typeAnnotation),
          });
        } else if (element.type === "TSRestType") {
          typeData.elements.push({
            type: "unnamed",
            rest: true,
            typeData: getType(element.typeAnnotation),
          });
        } else {
          typeData.elements.push({
            type: "unnamed",
            typeData: getType(element),
          });
        }
      }

      return typeData;
    }
    case "TSIndexedAccessType":
      return {
        type: "index-access",
        indexType: getType(tsType.indexType),
        objectType: getType(tsType.objectType),
      };
    case "TSTypeQuery":
      if (tsType.exprName.type == "Identifier") {
        return {
          type: "query",
          expr: {
            type: "ref",
            refType: "named",
            name: tsType.exprName.name,
          },
        };
      } else if (tsType.exprName.type == "TSQualifiedName") {
        return {
          type: "query",
          expr: {
            type: "ref",
            refType: "qualified",
            names: getQualifiedName(tsType.exprName),
          },
        };
      } else if (tsType.exprName.type == "TSImportType") {
        const expr: TypeDataImport = {
          type: "import",
          name: tsType.exprName.argument.value,
        };

        if (tsType.exprName.qualifier) {
          assert(tsType.exprName.qualifier.type == "Identifier");

          expr.qualifier = tsType.exprName.qualifier.name;
        }

        return {
          type: "query",
          expr,
        };
      } else {
        return { type: "any" };
      }
    case "TSImportType": {
      const typeData: TypeDataImport = {
        type: "import",
        name: tsType.argument.value,
      };

      if (tsType.qualifier) {
        if (tsType.qualifier.type === "Identifier") {
          typeData.qualifier = tsType.qualifier.name;
        } else {
          return { type: "any" };
        }
      }

      return typeData;
    }
    case "TSTemplateLiteralType": {
      return {
        type: "literal-type",
        literal: {
          type: "template",
          quasis: tsType.quasis.map((q: t.TemplateElement) => q.value.raw),
          expression: tsType.types.map((t: t.TSType) => getType(t)),
        },
      };
    }
    case "TSIntrinsicKeyword":
      return { type: "intrinsic" };
    case "TSTypeOperator": {
      return {
        type: "type-operator",
        operator: tsType.operator,
        typeAnnotation: getType(tsType.typeAnnotation),
      };
    }
    case "TSConstructorType": {
      assert(tsType.typeAnnotation != null);

      const typeData: TypeDataConstructor = {
        type: "constructor",
        params: [],
        parameters: [],
        return: getType(tsType.typeAnnotation),
      };

      if (tsType.abstract) {
        typeData.abstract = true;
      }

      if (tsType.typeParameters) {
        typeData.params = [];
        for (const param of tsType.typeParameters.params) {
          typeData.params.push(getTypeParameter(param));
        }
      }

      if (tsType.parameters) {
        typeData.parameters = [];
        for (const param of tsType.parameters) {
          const parameter: TypeDataFunctionParameter = {
            param: getFuncParam(param),
          };

          if (param.typeAnnotation) {
            assert(t.isTSTypeAnnotation(param.typeAnnotation));
            parameter.typeData = getType(param.typeAnnotation);
          }

          if ("optional" in param && param.optional) {
            parameter.optional = true;
          }

          typeData.parameters.push(parameter);
        }
      }

      return typeData;
    }
    case "TSTypePredicate": {
      let parameterName: string | { type: "this" };
      if (tsType.parameterName.type === "Identifier") {
        parameterName = tsType.parameterName.name;
      } else {
        parameterName = { type: "this" };
      }

      const typeData: TypeDataPredicate = {
        type: "type-predicate",
        parameterName,
      };

      if (tsType.asserts) {
        typeData.asserts = true;
      }

      if (tsType.typeAnnotation) {
        typeData.typeAnnotation = getType(tsType.typeAnnotation);
      }

      return typeData;
    }
    case "TSConditionalType": {
      return {
        type: "conditional-type",
        checkType: getType(tsType.checkType),
        extendsType: getType(tsType.extendsType),
        trueType: getType(tsType.trueType),
        falseType: getType(tsType.falseType),
      };
    }
    case "TSInferType": {
      const typeData: TypeDataInfer = {
        type: "infer-type",
        name: tsType.typeParameter.name,
      };

      if (tsType.typeParameter.constraint) {
        typeData.constraint = getType(tsType.typeParameter.constraint);
      }

      return typeData;
    }
    case "TSMappedType": {
      const typeData: TypeDataMapped = {
        type: "mapped-type",
        typeParameter: getTypeParameter(tsType.typeParameter),
      };

      if (tsType.readonly != null) {
        typeData.readonly = tsType.readonly;
      }

      if (tsType.optional != null) {
        typeData.optional = tsType.optional;
      }

      if (tsType.nameType) {
        typeData.nameType = getType(tsType.nameType);
      }

      if (tsType.typeAnnotation) {
        typeData.typeAnnotation = getType(tsType.typeAnnotation);
      }

      return typeData;
    }
    default:
      return { type: "any" };
  }
}

function getMemberExpressionNames(
  expr: t.Expression | t.Super,
): string[] | null {
  if (t.isIdentifier(expr)) {
    return [expr.name];
  }
  if (t.isThisExpression(expr)) {
    return ["this"];
  }
  if (t.isSuper(expr)) {
    return ["super"];
  }
  if (t.isTSNonNullExpression(expr) || t.isTSAsExpression(expr) || t.isTSSatisfiesExpression(expr) || t.isParenthesizedExpression(expr) || t.isTSInstantiationExpression(expr) || t.isTSTypeAssertion(expr)) {
    return getMemberExpressionNames(expr.expression);
  }
  if (t.isCallExpression(expr) || t.isOptionalCallExpression(expr)) {
    if (t.isIdentifier(expr.callee)) {
      return [expr.callee.name];
    }
    if (t.isMemberExpression(expr.callee)) {
      return getMemberExpressionNames(expr.callee);
    }
    return null;
  }
  if (t.isMemberExpression(expr) || t.isOptionalMemberExpression(expr)) {
    if (t.isIdentifier(expr.property)) {
      const left = getMemberExpressionNames(expr.object);
      if (left) {
        return [...left, expr.property.name];
      }
    }
    if (t.isPrivateName(expr.property)) {
      const left = getMemberExpressionNames(expr.object);
      if (left) {
        return [...left, `#${expr.property.id.name}`];
      }
    }
  }
  return null;
}

export function getExpressionData(expr: t.Expression): PropDataType | null {
  switch (expr.type) {
    case "BooleanLiteral":
      return {
        type: "literal-type",
        literal: {
          type: "boolean",
          value: expr.value,
        },
      };
    case "NumericLiteral":
      return {
        type: "literal-type",
        literal: {
          type: "number",
          value: expr.value,
        },
      };
    case "StringLiteral":
      return {
        type: "literal-type",
        literal: {
          type: "string",
          value: expr.value,
        },
      };
    case "BigIntLiteral":
      return {
        type: "literal-type",
        literal: {
          type: "bigint",
          value: expr.value,
        },
      };
    case "NullLiteral":
      return {
        type: "null",
      };
    case "RegExpLiteral":
      return {
        type: "literal-type",
        literal: { type: "string", value: expr.pattern },
      };
    case "Identifier":
      if (expr.name === "undefined") {
        return {
          type: "undefined",
        };
      }
      return {
        type: "ref",
        refType: "named",
        name: expr.name,
      };
    case "MemberExpression":
    case "OptionalMemberExpression": {
      const names = getMemberExpressionNames(expr);
      if (names) {
        return {
          type: "ref",
          refType: "qualified",
          names,
        };
      }
      break;
    }
    case "BinaryExpression":
    case "NewExpression": {
      return {
        type: "literal-type",
        literal: {
          type: "string",
          value: generateFn(expr).code,
        },
      };
    }
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
    case "TSInstantiationExpression":
    case "TSTypeAssertion":
      return getExpressionData(expr.expression);
    case "UnaryExpression":
      return getExpressionData(expr.argument);
    case "TemplateLiteral": {
      const elements: PropDataType[] = [];
      for (const ex of expr.expressions) {
        if (t.isExpression(ex)) {
          const data = getExpressionData(ex);
          if (data) {
            elements.push(data);
          }
        }
      }
      if (elements.length === 1) return elements[0];
      if (elements.length > 1) return { type: "literal-array", elements };
      return { type: "literal-type", literal: { type: "string", value: "" } };
    }
    case "ArrayExpression": {
      const elements: PropDataType[] = [];
      for (const element of expr.elements) {
        if (t.isExpression(element)) {
          const data = getExpressionData(element);
          if (data) {
            elements.push(data);
          }
        } else if (t.isSpreadElement(element) && t.isExpression(element.argument)) {
          const data = getExpressionData(element.argument);
          if (data) {
            elements.push(data);
          }
        }
      }
      return {
        type: "literal-array",
        elements,
      };
    }
    case "ParenthesizedExpression":
      return getExpressionData(expr.expression);
    case "ThisExpression":
      return { type: "this" };
    case "ConditionalExpression": {
      const data = getExpressionData(expr.test);
      const consequentData = getExpressionData(expr.consequent);
      const alternateData = getExpressionData(expr.alternate);
      return data || consequentData || alternateData || {
        type: "literal-type",
        literal: { type: "string", value: generateFn(expr).code },
      };
    }
    case "LogicalExpression": {
      const leftData = getExpressionData(expr.left);
      const rightData = getExpressionData(expr.right);
      return leftData || rightData || {
        type: "literal-type",
        literal: { type: "string", value: generateFn(expr).code },
      };
    }
    case "CallExpression":
    case "OptionalCallExpression": {
      return {
        type: "literal-type",
        literal: { type: "string", value: generateFn(expr).code },
      };
    }
    case "AssignmentExpression":
      return getExpressionData(expr.right);
    case "SequenceExpression":
      return getExpressionData(
        expr.expressions[expr.expressions.length - 1]!,
      );
    case "AwaitExpression":
      return getExpressionData(expr.argument);
    case "YieldExpression":
      if (expr.argument) return getExpressionData(expr.argument);
      return { type: "undefined" };
    case "MetaProperty":
    case "ImportExpression": {
      return {
        type: "literal-type",
        literal: { type: "string", value: generateFn(expr).code },
      };
    }
    case "ObjectExpression": {
      const properties: Record<string, PropDataType> = {};
      for (const prop of expr.properties) {
        if (t.isObjectProperty(prop)) {
          if (prop.computed && t.isExpression(prop.key)) {
            const keyData = getExpressionData(prop.key);
            if (keyData && keyData.type === "ref" && "name" in keyData) {
              properties[keyData.name as string] = keyData;
            }
            if (t.isExpression(prop.value)) {
              const data = getExpressionData(prop.value);
              if (data && data.type === "ref" && "name" in data) {
                properties[data.name as string] = data;
              }
            }
          } else {
            let key: string | null = null;
            if (t.isIdentifier(prop.key)) {
              key = prop.key.name;
            } else if (t.isStringLiteral(prop.key)) {
              key = prop.key.value;
            }

            if (key && t.isExpression(prop.value)) {
              const data = getExpressionData(prop.value);
              if (data) {
                properties[key] = data;
              }
            }
          }
        } else if (t.isSpreadElement(prop) && t.isExpression(prop.argument)) {
          const data = getExpressionData(prop.argument);
          if (data) {
            properties["..."] = data;
          }
        } else if (t.isObjectMethod(prop)) {
          if (t.isIdentifier(prop.key)) {
            properties[prop.key.name] = { type: "function" };
          }
        }
      }
      return {
        type: "literal-object",
        properties,
      };
    }
    default:
      break;
  }
  return null;
}
