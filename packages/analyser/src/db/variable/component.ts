import type {
  ComponentFileVarClassComponent,
  ComponentFileVarComponent,
  ComponentFileVarFunctionComponent,
  ComponentFileVarReactFunction,
  ComponentMetadata,
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

  public load(
    data: Partial<ComponentFileVarReactFunction<"component", TType>>,
  ) {
    super.load(data);

    this.kind = "component";
    const d = data as Partial<
      ComponentFileVarFunctionComponent | ComponentFileVarClassComponent
    >;
    if (d.componentType) this.componentType = d.componentType;
    if (d.propType) this.propType = d.propType;
    if (d.contexts) this.contexts = [...d.contexts];
    if (d.forwardRef !== undefined) this.forwardRef = d.forwardRef;
    if (d.memo !== undefined) this.memo = d.memo;
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

  protected getMetadata(): ComponentMetadata {
    const meta = {
      ...super.getMetadata(),
      componentType: this.componentType,
      contexts: this.contexts,
    } as ComponentMetadata;
    if (this.forwardRef !== undefined) meta.forwardRef = this.forwardRef;
    if (this.memo !== undefined) meta.memo = this.memo;
    if (this.propType !== undefined) meta.propType = this.propType;
    return meta;
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      componentType: this.componentType,
      contexts: this.contexts,
      forwardRef: this.forwardRef,
      memo: this.memo,
      propType: this.propType,
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

  public load(data: Partial<ComponentFileVarClassComponent>) {
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

  protected getMetadata(): ComponentMetadata {
    return {
      ...super.getMetadata(),
      ...(this.stateType ? { stateType: this.stateType } : {}),
    };
  }

  protected getDataInternal() {
    return {
      ...super.getDataInternal(),
      stateType: this.stateType,
    };
  }
}
