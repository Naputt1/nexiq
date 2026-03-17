import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nexu/shared/db": path.resolve(__dirname, "../shared/src/db/sqlite.ts"),
      "@nexu/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "analyser/db/sqlite": path.resolve(__dirname, "../analyser/src/db/sqlite.ts"),
      analyser: path.resolve(__dirname, "../analyser/src/index.ts"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      thresholds: {
        lines: 99,
        functions: 100,
        branches: 60,
        statements: 99,
      },
      exclude: [
        "node_modules",
        "dist",
        "src/index.ts",
        "**/*.test.ts",
        "eslint.config.js",
        "vitest.config.ts",
      ],
    },
  },
});
