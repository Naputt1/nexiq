import type { FuncParam, TypeDataParamFunction } from "./index.ts";

export interface TypeDataString {
  type: "string";
}

export interface TypeDataNumber {
  type: "number";
}

export interface TypeDataBigInt {
  type: "bigint";
}

export interface TypeDataBoolean {
  type: "boolean";
}

export interface TypeDataNull {
  type: "null";
}

export interface TypeDataUndefined {
  type: "undefined";
}

export interface TypeDataAny {
  type: "any";
}

export interface TypeDataVoid {
  type: "void";
}

export interface TypeDataUnknown {
  type: "unknown";
}

export interface TypeDataNever {
  type: "never";
}

export interface TypeDataLiteralTypeBigInt {
  type: "bigint";
  value: string;
}

export interface TypeDataLiteralTypeString {
  type: "string";
  value: string;
}

export interface TypeDataLiteralTypeNumber {
  type: "number";
  value: number;
}

export interface TypeDataLiteralTypeBoolean {
  type: "boolean";
  value: boolean;
}

export interface TypeDataLiteralTypeTemplate {
  type: "template";
  expression: TypeData[];
  quasis: string[];
}

export interface TypeDataLiteralTypeUnary {
  type: "unary";
  operator: "void" | "throw" | "delete" | "!" | "+" | "-" | "~" | "typeof";
  prefix: boolean;
  argument: TypeDataLiteralTypeLiteral;
}

export type TypeDataLiteralTypeLiteral =
  | TypeDataLiteralTypeBoolean
  | TypeDataLiteralTypeNumber
  | TypeDataLiteralTypeString
  | TypeDataLiteralTypeUnary
  | TypeDataLiteralTypeBigInt
  | TypeDataLiteralTypeTemplate;

// string, number, boolean
export interface TypeDataLiteralType {
  type: "literal-type";
  literal: TypeDataLiteralTypeLiteral;
}

export type TypeDataRef = {
  type: "ref";
  params?: TypeData[];
  resolvedId?: string | undefined;
  unresolvedWorkspace?: boolean | undefined;
} & (
  | {
      refType: "named";
      name: string;
    }
  | {
      refType: "qualified";
      names: string[];
    }
);

export interface TypeDataLiteralArray {
  type: "literal-array";
  elements: PropDataType[];
}

export interface TypeDataLiteralObject {
  type: "literal-object";
  properties: Record<string, PropDataType>;
}

export type PropDataType =
  | TypeDataLiteralType
  | TypeDataRef
  | TypeDataNull
  | TypeDataUndefined
  | TypeDataLiteralArray
  | TypeDataLiteralObject;

export type TypeDataFunctionParameter = {
  param: FuncParam;
  typeData?: TypeData;
  optional?: boolean;
};

export type TypeDataFunction = {
  type: "function";
  // generic
  params: TypeDataParamFunction[];
  // function parameters
  parameters: TypeDataFunctionParameter[];
  return: TypeData;
};

export type TypeDataPrimitive =
  | TypeDataString
  | TypeDataNumber
  | TypeDataBigInt
  | TypeDataBoolean
  | TypeDataNull
  | TypeDataUndefined
  | TypeDataAny
  | TypeDataVoid
  | TypeDataUnknown
  | TypeDataNever
  | TypeDataRef
  | TypeDataLiteralType
  | TypeDataFunction;

export interface TypeDataArray {
  type: "array";
  element: TypeData;
}
export interface TypeDataTupleElementBase {
  type: "named" | "unnamed";
  typeData: TypeData;
}

export interface TypeDataTupleElementNamed extends TypeDataTupleElementBase {
  type: "named";
  name: string;
  optional: boolean;
}

export interface TypeDataTupleElementUnNamed extends TypeDataTupleElementBase {
  type: "unnamed";
}

export type TypeDataTupleElement =
  | TypeDataTupleElementNamed
  | TypeDataTupleElementUnNamed;

export interface TypeDataTuple {
  type: "tuple";
  elements: TypeDataTupleElement[];
}

export interface TypeDataIndexAccess {
  type: "index-access";
  indexType: TypeData;
  objectType: TypeData;
}

export interface TypeDataQuery {
  type: "query";
  expr: TypeData;
}

export interface TypeDataImport {
  type: "import";
  name: string;
  qualifier?: string;
  resolvedId?: string | undefined;
  unresolvedWorkspace?: boolean | undefined;
}

export interface TypeDataLiteralBodyBase {
  signatureType: "property" | "index" | "method";
}

export interface TypeDataLiteralBodyIndexPrarameter {
  name: string;
  type: TypeData;
}

export interface TypeDataLiteralBodyIndex extends TypeDataLiteralBodyBase {
  signatureType: "index";
  type: TypeData;
  parameter: TypeDataLiteralBodyIndexPrarameter;
}

export interface TypeDataLiteralBodyProperty extends TypeDataLiteralBodyBase {
  signatureType: "property";
  type: TypeData;
  optional?: boolean;
  computed?: boolean;
  name: string;
  loc?: { line: number; column: number };
}

export interface TypeDataLiteralBodyMethod extends TypeDataLiteralBodyBase {
  signatureType: "method";
  name: string;
  optional?: boolean;
  computed?: boolean;
  params: TypeDataParamFunction[];
  parameters: TypeDataFunctionParameter[];
  return: TypeData;
  loc?: { line: number; column: number };
}

export type TypeDataLiteralBody =
  | TypeDataLiteralBodyProperty
  | TypeDataLiteralBodyIndex
  | TypeDataLiteralBodyMethod;

// object
export interface TypeDataTypeBodyLiteral {
  type: "type-literal";
  members: TypeDataLiteralBody[];
}

export interface TypeDataTypeBodyParathesis {
  type: "parenthesis";
  members: TypeData;
}

export interface TypeDataTypeBodyUnion {
  type: "union";
  members: TypeData[];
}

export interface TypeDataTypeBodyIntersection {
  type: "intersection";
  members: TypeData[];
}

export type TypeData =
  | TypeDataPrimitive
  | TypeDataArray
  | TypeDataTuple
  | TypeDataIndexAccess
  | TypeDataQuery
  | TypeDataImport
  | TypeDataTypeBodyLiteral
  | TypeDataTypeBodyUnion
  | TypeDataTypeBodyIntersection
  | TypeDataTypeBodyParathesis
  | TypeDataLiteralArray
  | TypeDataLiteralObject;
