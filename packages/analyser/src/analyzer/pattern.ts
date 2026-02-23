import * as t from "@babel/types";
import type {
  VariableNamePattern,
  VariableObjectProperty,
  VariableArrayElement,
} from "shared";
import { generateFn } from "../utils/babel.js";
import { getDeterministicId } from "../utils/hash.js";

export function getPattern(
  node: t.LVal | t.VoidPattern,
  parentPath?: string,
): VariableNamePattern {
  const getLoc = (n: t.Node) => {
    return {
      line: n.loc?.start.line ?? 0,
      column: n.loc?.start.column ?? 0,
    };
  };

  if (t.isIdentifier(node)) {
    const id = parentPath ? `${parentPath}-${node.name}` : node.name;
    return {
      type: "identifier",
      name: node.name,
      loc: getLoc(node),
      id: getDeterministicId(id),
    };
  } else if (t.isObjectPattern(node)) {
    const properties: VariableObjectProperty[] = [];
    const raw = generateFn(node).code;
    const patternId = parentPath ? `${parentPath}-obj` : "obj";

    for (const prop of node.properties) {
      if (t.isObjectProperty(prop)) {
        const key = t.isIdentifier(prop.key)
          ? prop.key.name
          : t.isStringLiteral(prop.key)
            ? prop.key.value
            : "computed";

        properties.push({
          key,
          value: getPattern(prop.value as t.LVal, `${patternId}-${key}`),
          loc: getLoc(prop.key),
        });
      } else if (t.isRestElement(prop)) {
        properties.push({
          key: "rest",
          value: {
            type: "rest",
            argument: getPattern(prop.argument as t.LVal, `${patternId}-rest`),
            loc: getLoc(prop.argument),
            id: getDeterministicId(`${patternId}-rest`),
          },
          loc: getLoc(prop),
        });
      }
    }
    return {
      type: "object",
      properties,
      raw,
      loc: getLoc(node),
      id: getDeterministicId(patternId),
    };
  } else if (t.isArrayPattern(node)) {
    const patternId = parentPath ? `${parentPath}-arr` : "arr";
    const elements: VariableArrayElement[] = node.elements.map((el, i) => {
      if (el == null) return null;
      if (t.isRestElement(el)) {
        return {
          type: "rest",
          value: getPattern(el.argument as t.LVal, `${patternId}-${i}`),
          loc: getLoc(el),
        };
      }
      return {
        type: "element",
        value: getPattern(el as t.LVal, `${patternId}-${i}`),
        loc: getLoc(el),
      };
    });
    return {
      type: "array",
      elements,
      raw: generateFn(node).code,
      loc: getLoc(node),
      id: getDeterministicId(patternId),
    };
  } else if (t.isRestElement(node)) {
    const patternId = parentPath ? `${parentPath}-rest` : "rest";
    return {
      type: "rest",
      argument: getPattern(node.argument as t.LVal, patternId),
      loc: getLoc(node),
      id: getDeterministicId(patternId),
    };
  } else if (t.isVoidPattern(node)) {
    return {
      type: "void",
      loc: getLoc(node),
      id: getDeterministicId(parentPath || "void"),
    };
  }

  // Fallback
  return {
    type: "identifier",
    name: "unknown",
    loc: { line: 0, column: 0 },
    id: getDeterministicId(parentPath || "unknown"),
  };
}

export function getPatternName(pattern: VariableNamePattern): string {
  if (pattern.type === "identifier") {
    return pattern.name;
  } else if (pattern.type === "rest") {
    return `...${getPatternName(pattern.argument)}`;
  } else if (pattern.type === "void") {
    return "void";
  }

  return pattern.raw;
}

export function getVariableNameKey(name: VariableNamePattern): string {
  if (typeof name === "string") return name;
  return getPatternName(name);
}

export function getPatternIdentifiers(
  pattern: VariableNamePattern,
  baseId?: string,
): { name: string; id: string }[] {
  const ids: { name: string; id: string }[] = [];

  const traverse = (p: VariableNamePattern, parentId?: string) => {
    const currentId = parentId ? `${parentId}:${p.id}` : p.id;
    if (p.type === "identifier") {
      ids.push({ name: p.name, id: currentId });
    } else if (p.type === "object") {
      for (const prop of p.properties) {
        traverse(prop.value, currentId);
      }
    } else if (p.type === "array") {
      for (const el of p.elements) {
        if (el) {
          traverse(el.value, currentId);
        }
      }
    } else if (p.type === "rest") {
      traverse(p.argument, currentId);
    }
  };

  traverse(pattern, baseId);
  return ids;
}
