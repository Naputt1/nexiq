import { defineConfig } from "tsup";
import pkg from "./package.json" with { type: "json" };

export default defineConfig({
  entry: ["src/analyzer.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  dts: true, // Generate declaration files in case it is used as a library
  splitting: false,
  external: [
    "@node-rs/xxhash",
    ...Object.keys(pkg.dependencies || {}),
    ...Object.keys(pkg.devDependencies || {}),
  ],
});
