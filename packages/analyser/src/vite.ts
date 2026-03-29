import fs from "fs";
import path from "path";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import type { CallExpression, ObjectProperty } from "@babel/types";
import { traverseFn } from "./utils/babel.js";

export function getViteAliases(
  viteConfigFile?: string | null,
): Record<string, string> {
  if (!viteConfigFile) {
    return {};
  }

  const code = fs.readFileSync(viteConfigFile, "utf-8");

  const ast = parser.parse(code, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });

  const aliases: Record<string, string> = {};

  traverseFn(ast, {
    ObjectProperty(path: traverse.NodePath<ObjectProperty>) {
      const key = path.node.key;
      if (
        (key.type === "Identifier" && key.name === "alias") ||
        (key.type === "StringLiteral" && key.value === "alias")
      ) {
        const value = path.node.value;
        if (value?.type === "ObjectExpression") {
          value.properties.forEach((prop) => {
            let key = "";
            let replacement = "";
            if (prop.type === "ObjectProperty") {
              const k = prop.key;
              const val = prop.value;

              if (k.type === "StringLiteral") {
                key = k.value;
              } else if (k.type === "Identifier") {
                key = k.name;
              } else {
                return;
              }

              let argument: CallExpression["arguments"] | null = null;
              if (val.type === "CallExpression") {
                if (val.callee.type === "Identifier") {
                  if (val.callee.name === "resolve") {
                    argument = val.arguments;
                  }
                } else if (val.callee.type === "MemberExpression") {
                  if (
                    val.callee.object.type === "Identifier" &&
                    val.callee.object.name === "path" &&
                    val.callee.property.type === "Identifier" &&
                    val.callee.property.name === "resolve"
                  ) {
                    argument = val.arguments;
                  }
                }
              }

              if (argument == null || argument.length < 2) {
                console.error("Invalid alias format", val);
                return;
              }

              if (argument[1]?.type === "StringLiteral") {
                replacement = argument[1].value;
              }

              aliases[key] = replacement;
            }
          });
        }
      }
    },
  });

  return aliases;
}

export function getTsConfigAliases(dir: string): Record<string, string> {
  const tsconfigPath = path.join(dir, "tsconfig.json");
  if (!fs.existsSync(tsconfigPath)) {
    return {};
  }

  try {
    const code = fs.readFileSync(tsconfigPath, "utf-8");
    // Strip comments and trailing commas before parsing
    // Match strings or comments, only keep strings
    const cleanedCode = code
      .replace(/("(?:\\.|[^\\"])*")|(\/\*[\s\S]*?\*\/|\/\/.*)/g, (match, string) => string || "")
      .replace(/,\s*([}\]])/g, "$1");

    const tsconfig = JSON.parse(cleanedCode);
    const paths = tsconfig?.compilerOptions?.paths;
    if (!paths) return {};

    const aliases: Record<string, string> = {};
    for (const [key, value] of Object.entries(paths)) {
      const aliasKey = key.replace("/*", "");
      const replacement = (value as string[])[0]?.replace("/*", "");
      if (aliasKey && replacement) {
        aliases[aliasKey] = replacement;
      }
    }
    return aliases;
  } catch (e) {
    console.warn("Failed to parse tsconfig.json", e);
    return {};
  }
}
