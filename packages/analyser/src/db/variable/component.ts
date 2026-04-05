import type {
  ComponentFileVarClassComponent,
  ComponentFileVarComponent,
  ComponentFileVarFunctionComponent,
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

  constructor(
    options: Omit<
      ComponentFileVarComponent,
      "kind" | "var" | "components" | "hash" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...(options as any), // eslint-disable-line @typescript-eslint/no-explicit-any
        kind: "component",
      },
      file,
    );
    this.componentType = options.componentType;
    this.propType = options.propType;
    this.contexts = options.contexts;
    this.forwardRef = options.forwardRef ?? false;
  }

  public load(data: ComponentVariable<TType>) {
    super.load(data);

    this.kind = "component";
    this.componentType = data.componentType || this.componentType;
    this.propType = data.propType || this.propType;

    this.contexts = data.contexts ? [...data.contexts] : this.contexts;
    this.forwardRef = data.forwardRef ?? this.forwardRef;
  }

  public getData(): ComponentFileVarComponent {
    const data: ComponentFileVarComponent = {
      ...this.getBaseData(),
      componentType: this.componentType,
      contexts: this.contexts,
      forwardRef: this.forwardRef,
    } as any; // eslint-disable-line @typescript-eslint/no-explicit-any

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
      forwardRef: this.forwardRef,
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
