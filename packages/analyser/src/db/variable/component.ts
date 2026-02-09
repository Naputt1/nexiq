import type { ComponentFileVarComponent, ComponentInfoRender } from "shared";
import type { TypeData } from "shared";
import type { File } from "../fileDB.js";
import { ReactFunctionVariable } from "./reactFunctionVariable.js";

export class ComponentVariable extends ReactFunctionVariable<"component"> {
  componentType: ComponentFileVarComponent["componentType"];
  propType: TypeData | undefined;
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarComponent,
      "kind" | "var" | "components" | "type" | "hash" | "file"
    >,
    file: File,
  ) {
    super(
      {
        ...options,
        kind: "component",
      },
      file,
    );
    this.componentType = options.componentType;
    this.propType = options.propType;
    this.contexts = options.contexts;
    this.renders = options.renders;
  }

  public load(data: ComponentVariable) {
    super.load(data);

    this.kind = "component";
    this.componentType = data.componentType;
    this.propType = data.propType;

    // TODO: handle merge
    this.contexts = data.contexts;
    this.renders = data.renders;
  }

  public getData(): ComponentFileVarComponent {
    const data: ComponentFileVarComponent = {
      ...this.getBaseData(),
      componentType: this.componentType,
      contexts: this.contexts,
      renders: this.renders,
    };

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
      renders: this.renders,
    };
  }
}
