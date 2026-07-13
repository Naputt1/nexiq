import fs from "fs";
import path from "path";
import { glob } from "glob";
import * as parser from "@babel/parser";
import type { File } from "@babel/types";

const VITE_CONFIG_FILE = "vite.config.ts";

export function getViteConfig(dir: string): string | null {
  const configPath = path.join(dir, VITE_CONFIG_FILE);
  if (fs.existsSync(configPath)) {
    return configPath;
  }

  return null;
}

export function getFiles(dir: string, customIgnore: string[] = []): string[] {
  const allFiles = glob.sync("**/*.{js,jsx,ts,tsx}", {
    cwd: dir,
    absolute: false,
    ignore: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/.next/**",
      "**/out/**",
      "**/coverage/**",
      "**/public/**",
      "**/vite.config.ts",
      "**/*.d.ts",
      ...customIgnore,
    ],
  });

  // Safety filter: only return actual files, not directories that matched by name
  return allFiles.filter((f) => {
    const fullPath = path.join(dir, f);
    try {
      return fs.statSync(fullPath).isFile();
    } catch {
      return false;
    }
  });
}

export function parseCode(code: string): File {
  return parser.parse(code, {
    sourceType: "module",
    plugins: ["jsx", "typescript", "classProperties"],
  });
}
