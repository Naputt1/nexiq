import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import electron from "vite-plugin-electron/simple";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { builtinModules } from "node:module";
import { devtools } from "@tanstack/devtools-vite";
import istanbul from "vite-plugin-istanbul";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    mode === "development" && devtools(),
    process.env.VITE_COVERAGE === "true" &&
      istanbul({
        include: "src/**/*.{ts,tsx}",
        exclude: ["node_modules", "test/**/*", "e2e/**/*"],
        extension: [".ts", ".tsx"],
        requireEnv: false,
        checkProd: false,
        forceBuildInstrument: true,
      }),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          build: {
            target: "node18",
            rollupOptions: {
              external: [
                "electron",
                "@parcel/watcher",
                "@node-rs/xxhash",
                "analyser",
                "shared",
                "fast-glob",
                "js-yaml",
                "simple-git",
                "tmp",
                "ws",
                ...builtinModules,
                ...builtinModules.map((m) => `node:${m}`),
              ],
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, "electron/preload.ts"),
      },
    }),
  ],
  optimizeDeps: {
    include: ["tslib"],
    exclude: ["@node-rs/xxhash"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
