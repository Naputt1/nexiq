import type {
  ComponentFileVarBase,
  ComponentFileVarProperty,
} from "@nexiq/shared";
import type { File } from "../fileDB.js";
import { Variable } from "./variable.js";

export class PropertyVariable extends Variable<"data", "property"> {
  constructor(
    options: Omit<ComponentFileVarProperty, "kind" | "type" | "file" | "hash">,
    file: File,
  ) {
    super(
      { ...options, kind: "property", type: "data" } as Omit<
        ComponentFileVarBase<"data", "property">,
        "file" | "hash"
      >,
      file,
    );
  }

  public load(data: PropertyVariable) {
    super.load(data);
  }

  protected getDataInternal() {
    return {
      name: this.name,
    };
  }

  public getData(): ComponentFileVarProperty {
    return this.getBaseData();
  }
}
