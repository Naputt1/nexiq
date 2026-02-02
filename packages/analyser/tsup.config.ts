import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/analyzer.ts", "src/index.ts"],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  dts: true, // Generate declaration files in case it is used as a library
  splitting: false,
});
