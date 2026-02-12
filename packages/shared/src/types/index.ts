import type { ComponentLoc, VariableName } from "../component.js";
import type { TypeData, TypeDataLiteralBody } from "./primitive.js";
export * from "./primitive.js";
export * from "./object.js";
export * from "./git.js";
export * from "./config.js";

export interface TypeDataParam {
  name: string;
  default?: TypeData;
  constraint?: TypeData;
}

export interface TypeDataParamFunction extends TypeDataParam {
  const?: boolean;
  in?: boolean;
  out?: boolean;
}

export interface TypeDataDeclareBase {
  id: string;
  type: "interface" | "type";
  name: VariableName;
}

export interface TypeDataDeclareInterface
  extends TypeDataDeclareBase,
    ComponentLoc {
  type: "interface";
  extends?: string[];
  body: TypeDataLiteralBody[];
  params?: Record<string, TypeDataParam>;
}

export interface TypeDataDeclareType extends TypeDataDeclareBase, ComponentLoc {
  type: "type";
  body: TypeData;
  params?: TypeDataParam[];
}

export type TypeDataDeclare = TypeDataDeclareInterface | TypeDataDeclareType;

export type ComponentTypeData =
  | {
      type: "name";
      name: string;
    }
  | {
      type: "inline";
      body: TypeData;
    };
