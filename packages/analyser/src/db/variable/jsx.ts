import type { ComponentFileVarJSX, ComponentInfoRender } from "@nexiq/shared";
import { Variable } from "./variable.ts";
import type { File } from "../fileDB.ts";

export class JSXVariable extends Variable<"jsx", "normal"> {
  render: ComponentInfoRender | null;
  children: Record<string, ComponentInfoRender>;
  srcId?: string | undefined;

  constructor(
    options: Omit<ComponentFileVarJSX, "kind" | "type" | "hash" | "file">,
    file: File,
  ) {
    super({ ...options, kind: "normal", type: "jsx" }, file);
    this.render = options.render;
    this.srcId = options.srcId;

    this.children = {};
    if (this.render) {
      this.__loadChildren(this.render);
    }
  }

  private __loadChildren(render: ComponentInfoRender) {
    this.children[render.id] = render;

    if (render.children) {
      for (const child of Object.values(render.children)) {
        this.__loadChildren(child);
      }
    }
  }

  public load(data: JSXVariable) {
    super.load(data);

    this.render = data.render || this.render;
    this.children = data.children ? { ...data.children } : this.children;
    this.srcId = data.srcId || this.srcId;
  }

  public getData(): ComponentFileVarJSX {
    return {
      ...this.getBaseData(),
      type: "jsx",
      kind: "normal",
      render: this.render,
      srcId: this.srcId,
    };
  }

  protected getDataInternal() {
    return {
      render: this.render,
      children: this.children,
      srcId: this.srcId,
    };
  }
}
