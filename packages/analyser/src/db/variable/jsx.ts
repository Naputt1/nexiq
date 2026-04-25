import type {
  ComponentFileVarJSX,
  ComponentInfoRender,
  DBBatch,
  JSXMetadata,
} from "@nexiq/shared";
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

  public load(data: Partial<ComponentFileVarJSX>) {
    super.load(data);

    this.render = data.render ?? this.render;
    this.srcId = data.srcId ?? this.srcId;
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
      srcId: this.srcId,
    };
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({
      srcId: this.srcId,
    } as JSXMetadata);
    batch.entities.add(row);

    if (this.render) {
      this.recursiveInsertRender(batch, this.render, null);
    }
  }

  private recursiveInsertRender(
    batch: DBBatch,
    render: ComponentInfoRender,
    parentRenderId: string | null,
  ) {
    batch.renders.add({
      id: render.id,
      file_id: 0,
      parent_entity_id: this.id,
      parent_render_id: parentRenderId,
      render_index: render.renderIndex,
      tag: render.tag,
      symbol_id: null,
      line: render.loc?.line ?? null,
      column: render.loc?.column ?? null,
      kind: render.kind,
      data_json: JSON.stringify({
        instanceId: render.instanceId,
        dependencies: render.dependencies,
        isDependency: render.isDependency,
      }),
    });

    for (const child of Object.values(render.children)) {
      this.recursiveInsertRender(batch, child, render.id);
    }
  }
}
