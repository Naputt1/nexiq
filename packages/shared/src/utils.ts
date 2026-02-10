import type { VariableName } from "./component.js";

export type Optional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export const getDisplayName = (name: VariableName | string | undefined): string => {
  if (!name) return "unknown";
  if (typeof name === "string") return name;
  if (name.type === "identifier") return name.name;
  if (name.type === "rest") return `...${getDisplayName(name.argument)}`;
  return name.raw;
};
