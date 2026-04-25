import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: [
    "src/analyzer.ts",
    "src/index.ts",
    "src/worker.ts",
    "src/db/sqlite.ts",
    "src/analyze-project.ts",
  ],
  format: ["esm"],
  target: "node18",
  clean: true,
  sourcemap: true,
  minify: true,
  dts: true, // Generate declaration files in case it is used as a library
  splitting: false,
  external: ["@node-rs/xxhash", "better-sqlite3", "@nexiq/shared"],
  define: {
    "process.env.MODE": JSON.stringify(options.env?.MODE || "production"),
  },
}));
