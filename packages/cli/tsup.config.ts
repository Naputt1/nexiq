import { defineConfig } from "tsup";

export default defineConfig((options) => ({
  entry: ["src/cli.tsx"],
  format: ["esm"],
  target: "node18",
  clean: true,
  minify: true,
  dts: false,
  define: {
    "process.env.MODE": JSON.stringify(options.env?.MODE || "production"),
  },
  banner: {
    js: `#!/usr/bin/env node
import { createRequire as __createRequire } from 'node:module';
const require = __createRequire(import.meta.url);
`,
  },
  // Bundle only the ones that cause version conflicts or need to be standalone
  noExternal: [
    "ink",
    "ink-spinner",
    "react",
    "react-dom",
    "react-reconciler",
    "meow",
    "signal-exit",
  ],
  // Exclude node built-ins and problematic native/peer deps
  external: [
    "ws",
    "react-devtools-core",
    "yoga-layout",
    "yoga-wasm-web",
    "assert",
    "buffer",
    "child_process",
    "crypto",
    "events",
    "fs",
    "module",
    "net",
    "os",
    "path",
    "stream",
    "url",
    "util",
  ],
}));
