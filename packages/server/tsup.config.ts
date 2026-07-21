import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts", "src/analysis-worker.ts"],
  format: ["esm"],
  target: "node18",
  dts: { entry: "src/index.ts" },
  clean: true,
  sourcemap: true,
  minify: true,
  define: {
    "process.env.MODE": JSON.stringify(options.env?.MODE || "production"),
  },
}));
