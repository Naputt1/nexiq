import type {
  ComponentFileVarClassComponent,
  ComponentFileVarComponent,
  ComponentFileVarFunctionComponent,
  ComponentFileVarReactFunction,
} from "@nexiq/shared";
import type { TypeData } from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactFunctionVariable } from "./reactFunctionVariable.ts";

export abstract class ComponentVariable<
  TType extends "function" | "class" = "function" | "class",
> extends ReactFunctionVariable<"component", TType> {
  componentType: "Function" | "Class";
  propType: TypeData | undefined;
  contexts: string[];
  forwardRef: boolean;
  memo: boolean;

  constructor(
    options: Omit<
      ComponentFileVarComponent,
      "kind" | "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...(options as unknown as Omit<
          ComponentFileVarReactFunction<"component", TType>,
          "var" | "components" | "file"
        >),
        kind: "component",
      },
      file,
    );
    this.componentType = options.componentType;
    this.propType = options.propType;
    this.contexts = options.contexts;
    this.forwardRef = options.forwardRef ?? false;
    this.memo = options.memo ?? false;
  }

  public load(data: ComponentVariable<TType>) {
    super.load(data);

    this.kind = "component";
    this.componentType = data.componentType || this.componentType;
    this.propType = data.propType || this.propType;

    this.contexts = data.contexts ? [...data.contexts] : this.contexts;
    this.forwardRef = data.forwardRef ?? this.forwardRef;
    this.memo = data.memo ?? this.memo;
  }

  public getData(): ComponentFileVarComponent {
    const data = {
      ...this.getBaseData(),
      componentType: this.componentType,
      contexts: this.contexts,
    } as ComponentFileVarComponent;

    if (this.forwardRef) {
      data.forwardRef = this.forwardRef;
    }

    if (this.memo) {
      data.memo = this.memo;
    }

    if (this.propType) {
      data.propType = this.propType;
    }

    return data;
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      componentType: this.componentType,
      contexts: this.contexts,
      ...(this.forwardRef ? { forwardRef: this.forwardRef } : {}),
      ...(this.memo ? { memo: this.memo } : {}),
    };
  }
}

export class FunctionComponentVariable extends ComponentVariable<"function"> {
  constructor(
    options: Omit<
      ComponentFileVarFunctionComponent,
      "kind" | "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super(options, file);
  }
}

export class ClassComponentVariable extends ComponentVariable<"class"> {
  stateType: TypeData | undefined;

  constructor(
    options: Omit<
      ComponentFileVarClassComponent,
      "kind" | "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super(options, file);
    this.stateType = options.stateType;
  }

  public load(data: ClassComponentVariable) {
    super.load(data);
    this.stateType = data.stateType || this.stateType;
  }

  public getData(): ComponentFileVarClassComponent {
    const data = super.getData() as ComponentFileVarClassComponent;
    if (this.stateType) {
      data.stateType = this.stateType;
    }
    return data;
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      stateType: this.stateType,
    };
  }
}
