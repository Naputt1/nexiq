import type { ComponentLoc } from "../component.js";
import type { TypeData, TypeDataLiteralBody } from "./primitive.js";
export * from "./primitive.js";

export interface TypeDataParam {
  name: string;
  default?: TypeData;
  constraint?: TypeData;
}

export interface TypeDataDeclareBase {
  id: string;
  type: "interface" | "type";
  name: string;
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
