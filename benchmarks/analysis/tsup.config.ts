import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/run.ts', 'src/case.ts'],
  format: ['esm'],
  clean: true,
  dts: false,
  sourcemap: true,
  minify: false,
  target: 'node20',
  shims: true,
  external: ['@nexiq/analyser'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
