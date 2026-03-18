import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.tsx'],
  format: ['esm'],
  clean: true,
  dts: false,
  sourcemap: true,
  minify: false,
  target: 'node20',
  shims: true,
  external: ['ink', 'react', 'ink-select-input', 'ink-spinner', 'ink-gradient', 'ink-big-text', 'openai', 'tiktoken', 'zod', 'open', 'dotenv', '@modelcontextprotocol/sdk', 'react-dom'],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
