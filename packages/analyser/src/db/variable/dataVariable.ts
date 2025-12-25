import type { ComponentFileVarNormal, ComponentInfoRender } from "shared";
import { Variable } from "./variable.js";

export class DataVariable extends Variable {
  type: "function" | "data";
  components: Map<string, ComponentInfoRender>;

  constructor({
    id,
    name,
    dependencies,
    loc,
    ...options
  }: Omit<ComponentFileVarNormal, "isComponent" | "var" | "components">) {
    super(id, name, dependencies, false, loc);
    this.type = options.type;
    this.components = new Map();
  }

  public getData(): ComponentFileVarNormal {
    return {
      id: this.id,
      name: this.name,
      isComponent: false,
      dependencies: this.dependencies,
      var: Object.fromEntries(
        Object.entries(Object.fromEntries(this.var)).map(([k, value]) => [
          k,
          value.getData(),
        ])
      ),
      type: this.type,
      loc: this.loc,
      components: Object.fromEntries(this.components),
    };
  }
}
