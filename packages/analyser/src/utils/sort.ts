type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type DeepSort<T> = T extends Primitive
  ? T
  : T extends (...args: unknown[]) => unknown
    ? T
    : T extends Array<infer U>
      ? DeepSort<U>[]
      : T extends object
        ? { [K in keyof T]: DeepSort<T[K]> }
        : T;

export const deepSort = <T>(obj: T): DeepSort<T> => {
  if (obj === null || typeof obj !== "object") {
    return obj as DeepSort<T>;
  }

  if (typeof obj === "function") {
    return obj as DeepSort<T>;
  }

  if (Array.isArray(obj)) {
    return obj.map(deepSort) as DeepSort<T>;
  }

  const typedObj = obj as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(typedObj).sort()) {
    result[key] = deepSort(typedObj[key]);
  }

  return result as DeepSort<T>;
};
