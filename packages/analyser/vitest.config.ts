import { defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "shared/db": path.resolve(__dirname, "../shared/src/db/sqlite.ts"),
      shared: path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    server: {
      deps: {
        external: ["@node-rs/xxhash"],
      },
    },
  },
});
