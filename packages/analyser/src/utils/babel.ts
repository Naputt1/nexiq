import generate from "@babel/generator";
import traverse, { visitors as traverseVisitors } from "@babel/traverse";

export const traverseFn: typeof traverse.default = traverse.default || traverse;
export const generateFn: typeof generate.default = generate.default || generate;

/**
 * Merge several visitor maps into one. Unlike a plain object spread, this
 * COMBINES handlers for colliding node types (both run), rather than letting
 * the last spread overwrite earlier ones.
 */
export function mergeVisitors(
  ...visitorMaps: Record<string, unknown>[]
): ReturnType<typeof traverseVisitors.merge> {
  return traverseVisitors.merge(
    visitorMaps as unknown as Parameters<typeof traverseVisitors.merge>[0],
  );
}
