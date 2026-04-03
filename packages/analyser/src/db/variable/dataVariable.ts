import type {
  ComponentFileVarNormal,
  ComponentFileVarNormalData,
  ComponentInfoRender,
  VarKind,
} from "@nexiq/shared";
import { Variable } from "./variable.ts";
import type { File } from "../fileDB.ts";

export class DataVariable extends Variable<"data"> {
  children: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarNormal,
      "kind" | "var" | "children" | "file" | "hash"
    > & { kind?: VarKind },
    file: File,
  ) {
    super({ ...options, kind: options.kind ?? "normal", type: "data" }, file);
    this.children = {};
  }

  public load(data: DataVariable) {
    super.load(data);

    this.type = data.type;
    if (data.children) {
      this.children = { ...data.children };
    }
  }

  public getData(): ComponentFileVarNormal {
    return {
      ...this.getBaseData(),
      type: "data",
      kind: this.kind as "normal",
      children: this.children,
    };
  }

  protected getBaseData(): ComponentFileVarNormalData {
    return {
      ...super.getBaseData(),
      children: this.children,
    } as ComponentFileVarNormalData;
  }

  protected getDataInternal() {
    return {
      name: this.name,
      children: this.children,
    };
  }
}
