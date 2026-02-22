import type {
  ComponentFileVarJSX,
  ComponentInfoRender,
  ComponentInfoRenderDependency,
} from "shared";
import { Variable } from "./variable.js";
import type { File } from "../fileDB.js";

export class JSXVariable extends Variable<"jsx", "normal"> {
  tag: string;
  props: ComponentInfoRenderDependency[];
  children: Record<string, ComponentInfoRender>;
  srcId?: string | undefined;

  constructor(
    options: Omit<ComponentFileVarJSX, "kind" | "type" | "hash" | "file">,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "jsx" }, file);
    this.tag = options.tag;
    this.props = options.props;
    this.children = options.children || {};
    this.srcId = options.srcId;
  }

  public load(data: JSXVariable) {
    super.load(data);
    this.tag = data.tag;
    this.props = data.props;
    this.children = data.children;
    this.srcId = data.srcId;
  }

  public getData(): ComponentFileVarJSX {
    return {
      ...this.getBaseData(),
      type: "jsx",
      kind: "normal",
      tag: this.tag,
      props: this.props,
      children: this.children,
      srcId: this.srcId,
    };
  }

  protected getDataInternal() {
    return {
      tag: this.tag,
      props: this.props,
      children: this.children,
      srcId: this.srcId,
    };
  }
}
