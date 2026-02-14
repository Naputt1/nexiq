import * as t from "@babel/types";
import type {
  VariableNamePattern,
  VariableObjectProperty,
  VariableArrayElement,
} from "shared";
import { generateFn } from "src/utils/babel.js";

export function getPattern(node: t.LVal): VariableNamePattern {
  if (t.isIdentifier(node)) {
    return { type: "identifier", name: node.name };
  } else if (t.isObjectPattern(node)) {
    const properties: VariableObjectProperty[] = [];
    for (const prop of node.properties) {
      if (t.isObjectProperty(prop)) {
        properties.push({
          key: t.isIdentifier(prop.key)
            ? prop.key.name
            : t.isStringLiteral(prop.key)
              ? prop.key.value
              : "computed",
          value: getPattern(prop.value as t.LVal),
        });
      } else if (t.isRestElement(prop)) {
        properties.push({
          key: "rest",
          value: {
            type: "rest",
            argument: getPattern(prop.argument as t.LVal),
          },
        });
      }
    }
    return {
      type: "object",
      properties,
      raw: generateFn(node).code,
    };
  } else if (t.isArrayPattern(node)) {
    const elements: VariableArrayElement[] = node.elements.map((el) => {
      if (el == null) return null;
      if (t.isRestElement(el)) {
        return { type: "rest", value: getPattern(el.argument as t.LVal) };
      }
      return { type: "element", value: getPattern(el as t.LVal) };
    });
    return {
      type: "array",
      elements,
      raw: generateFn(node).code,
    };
  } else if (t.isRestElement(node)) {
    return { type: "rest", argument: getPattern(node.argument as t.LVal) };
  }

  // Fallback
  return { type: "identifier", name: "unknown" };
}

export function getPatternName(pattern: VariableNamePattern): string {
  if (pattern.type === "identifier") {
    return pattern.name;
  }
  if (pattern.type === "rest") {
    return `...${getPatternName(pattern.argument)}`;
  }
  return pattern.raw;
}

export function getVariableNameKey(name: VariableNamePattern): string {
  if (typeof name === "string") return name;
  return getPatternName(name);
}
