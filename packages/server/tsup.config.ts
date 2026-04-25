import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  dts: false,
  clean: true,
  sourcemap: true,
  minify: true,
  define: {
    "process.env.MODE": JSON.stringify(options.env?.MODE || "production"),
  },
}));
