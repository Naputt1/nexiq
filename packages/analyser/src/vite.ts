import fs from "fs";
import * as parser from "@babel/parser";
import traverse from "@babel/traverse";
import type { CallExpression } from "@babel/types";

export function getViteAliases(
  viteConfigFile?: string | null
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

  traverse.default(ast, {
    ObjectProperty(path) {
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
