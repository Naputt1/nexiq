import { defineConfig } from "vitest/config";

export default defineConfig({
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
