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
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, false, loc, scope);
    this.type = options.type;
    this.components = new Map();
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...super.getBaseData(),
      isComponent: false,
      loc: this.loc,
      components: Object.fromEntries(this.components),
    };
  }
}
