import generate from "@babel/generator";
import traverse from "@babel/traverse";

export const traverseFn: typeof traverse.default = traverse.default || traverse;
export const generateFn: typeof generate.default = generate.default || generate;
