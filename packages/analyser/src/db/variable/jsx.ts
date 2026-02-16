import type { ComponentFileVarJSX, ComponentInfoRender, ComponentInfoRenderDependency } from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export class JSXVariable extends Variable<"jsx", "normal"> {
  tag: string;
  props: ComponentInfoRenderDependency[];
  renders: Record<string, ComponentInfoRender>;

  constructor(
    options: Omit<
      ComponentFileVarJSX,
      "kind" | "type" | "hash" | "file"
    >,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "jsx" }, file);
    this.tag = options.tag;
    this.props = options.props;
    this.renders = options.renders || {};
  }

  public load(data: JSXVariable) {
    super.load(data);
    this.tag = data.tag;
    this.props = data.props;
    this.renders = data.renders;
  }

  public getData(): ComponentFileVarJSX {
    return {
      ...this.getBaseData(),
      type: "jsx",
      kind: "normal",
      tag: this.tag,
      props: this.props,
      renders: this.renders,
    };
  }

  protected getDataInternal() {
    return {
      tag: this.tag,
      props: this.props,
      renders: this.renders,
    };
  }
}
