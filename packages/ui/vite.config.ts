import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import electron from "vite-plugin-electron/simple";
import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import { builtinModules } from "node:module";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        // Shortcut of `build.lib.entry`.
        entry: "electron/main.ts",
        vite: {
          build: {
            rollupOptions: {
              external: [
                "electron",
                "@node-rs/xxhash",
                "analyser",
                "fast-glob",
                "js-yaml",
                "simple-git",
                "tmp",
                "tty",
                "os",
                "util",
                "fs",
                "path",
                "child_process",
                "module",
                "node:tty",
                "node:os",
                "node:util",
                "node:fs",
                "node:path",
                "node:child_process",
                "node:module",
                ...builtinModules,
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
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === "test"
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
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
});
