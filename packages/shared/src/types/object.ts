import type { TypeData } from "./primitive.js";

export interface FuncParamName {
  type: "named";
  name: string;
}

export interface FuncParamObjectProperty {
  type: "object-property";
  shorthand: boolean;
  key: string;
  value: FuncParam;
}

export type FuncParamObjectPatternProperty =
  | FuncParamObjectProperty
  | FuncParamRestElement;

export interface FuncParamObjectPattern {
  type: "object-pattern";
  property: FuncParamObjectPatternProperty[];
}

export interface FuncParamArrayPattern {
  type: "array-pattern";
  elements: FuncParam[];
}

export interface FuncParamRestElement {
  type: "rest-element";
  name: string;
}

export type FuncParam =
  | FuncParamName
  | FuncParamObjectPattern
  | FuncParamArrayPattern
  | FuncParamRestElement;
