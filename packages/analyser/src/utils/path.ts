import path from "node:path";

export function cleanPath(filePath: string) {
  return path.isAbsolute(filePath) ? filePath.slice(1) : filePath;
}

export function resolvePath(...paths: string[]) {
  const len = paths.length;
  if (len === 0) return "";

  const args = new Array(len);

  args[0] = paths[0];

  for (let i = 1; i < len; i++) {
    args[i] = cleanPath(paths[i]!);
  }

  return path.resolve(...args);
}
