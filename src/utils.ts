import path from "path";

export function isHook(filePath: string) {
  return path.basename(filePath).startsWith("use");
}
