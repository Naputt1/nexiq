import type { ComponentFileVarComponent } from "shared";
import type { TypeData } from "shared";
import type { File } from "../fileDB.js";
import { ReactFunctionVariable } from "./reactFunctionVariable.js";

export class ComponentVariable<
  TType extends "function" | "class" = "function" | "class",
> extends ReactFunctionVariable<"component", TType> {
  componentType: ComponentFileVarComponent["componentType"];
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
    this.componentType = data.componentType;
    this.propType = data.propType;

    // TODO: handle merge
    this.contexts = data.contexts;
    this.forwardRef = data.forwardRef;
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
