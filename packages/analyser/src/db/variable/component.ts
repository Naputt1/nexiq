import type { ComponentFileVarComponent, ComponentInfoRender } from "shared";
import type { TypeData } from "shared/src/types/primitive.js";
import { ReactVariable } from "./reactVariable.js";

export class ComponentVariable extends ReactVariable {
  componentType: ComponentFileVarComponent["componentType"];
  propType: TypeData | undefined;
  contexts: string[];
  renders: Record<string, ComponentInfoRender>;

  constructor(options: Omit<ComponentFileVarComponent, "variableType">) {
    super({
      variableType: "component",
      ...options,
    } as ComponentFileVarComponent);
    this.componentType = options.componentType;
    this.propType = options.propType;
    this.contexts = options.contexts;
    this.renders = options.renders;
  }

  public load(data: ComponentVariable) {
    super.load(data);

    this.variableType = "component";
    this.componentType = data.componentType;
    this.propType = data.propType;

    // TODO: handle merge
    this.contexts = data.contexts;
    this.renders = data.renders;
  }

  public getData(): ComponentFileVarComponent {
    const data: ComponentFileVarComponent = {
      ...this.getReactVariable(),
      variableType: "component",
      componentType: this.componentType,
      contexts: this.contexts,
      renders: this.renders,
    };

    if (this.propType) {
      data.propType = this.propType;
    }

    return data;
  }
}
