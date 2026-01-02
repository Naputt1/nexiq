import type { FuncParam } from "./object.js";
import type { TypeData, TypeDataLiteralBody } from "./primitive.js";

export interface TypeDataFunctionParameterBase {
  optional?: boolean;
  //TODO: handle rest
  decorator: never;
}

export interface TypeDataFunctionParameterName
  extends TypeDataFunctionParameterBase {
  name: string;
  body: TypeData;
}

export interface TypeDataFunctionParameterObject
  extends TypeDataFunctionParameterBase {
  name: string;
  body: TypeDataLiteralBody[];
  properties: FuncParam[];
}

export interface TypeDataFunctionParameter {
  name: string;
  body: TypeData;
}
