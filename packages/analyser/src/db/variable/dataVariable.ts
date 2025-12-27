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
  }: Omit<ComponentFileVarNormal, "variableType" | "var" | "components">) {
    const scope = options.type === "function" ? options.scope : undefined;
    super(id, name, options.type, dependencies, "normal", loc, scope);
    this.type = options.type;
    this.components = new Map();
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...super.getBaseData(),
      variableType: "normal",
      loc: this.loc,
      components: Object.fromEntries(this.components),
    };
  }
}
