import type {
  ComponentFileVarCallHook,
  DBBatch,
  CallHookMetadata,
} from "@nexiq/shared";
import type { File } from "../fileDB.ts";
import { ReactVariable } from "./reactVariable.ts";

export class CallHookVariable extends ReactVariable<"data", "hook"> {
  call: {
    id: string;
    name: string;
    resolvedId?: string | undefined;
    unresolvedWorkspace?: boolean | undefined;
  };

  constructor(
    options: Omit<ComponentFileVarCallHook, "kind" | "file" | "type">,
    file: File,
  ) {
    super({ ...options, kind: "hook", type: "data" }, file);

    this.call = options.call;
  }

  public load(data: Partial<ComponentFileVarCallHook>) {
    super.load(data);
    this.call = data.call || this.call;
    this.kind = "hook";
  }

  public getData(): ComponentFileVarCallHook {
    return {
      ...super.getBaseData(),
      call: this.call,
    };
  }

  protected getDataInternal() {
    return {
      name: this.name,
      call: this.call,
    };
  }

  public toDBRow(batch: DBBatch, scopeId: string): void {
    const row = this.getBaseRow(scopeId);
    row.data_json = JSON.stringify({
      call: this.call,
    } as CallHookMetadata);
    batch.entities.add(row);
  }
}
