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
  | TypeDataLiteralType;

export interface TypeDataArray {
  type: "array";
  element: TypeData;
}

export interface TypeDataLiteralBodyBase {
  signatureType: "property" | "index";
  type: TypeData;
}

export interface TypeDataLiteralBodyIndexPrarameter {
  name: string;
  type: TypeData;
}

export interface TypeDataLiteralBodyIndex extends TypeDataLiteralBodyBase {
  signatureType: "index";
  parameter: TypeDataLiteralBodyIndexPrarameter;
}

export interface TypeDataLiteralBodyProperty extends TypeDataLiteralBodyBase {
  signatureType: "property";
  optional?: boolean;
  computed?: boolean;
  name: string;
}

export type TypeDataLiteralBody =
  | TypeDataLiteralBodyProperty
  | TypeDataLiteralBodyIndex;

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
  | TypeDataTypeBodyLiteral
  | TypeDataTypeBodyUnion
  | TypeDataTypeBodyIntersection
  | TypeDataTypeBodyParathesis;
