import type { ComponentFile, JsonData, Optional } from "@nexu/shared";

export type SnapshotData = Omit<Optional<JsonData, "src">, "files"> & {
  files: Record<string, Optional<ComponentFile, "fingerPrint">>;
};
