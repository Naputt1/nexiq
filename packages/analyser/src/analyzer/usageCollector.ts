import * as t from "@babel/types";
import type traverse from "@babel/traverse";
import type { File } from "@babel/types";
import type {
  ComponentRelation,
  UsageOccurrence,
  UsageRelationKind,
  VariableLoc,
} from "@nexiq/shared";
import type { ComponentDB } from "../db/componentDB.ts";
import type { Variable } from "../db/variable/variable.ts";
import { getDeterministicId } from "../utils/hash.ts";
import {
  isClassVariable,
  isComponentVariable,
  isHookVariable,
  isReactFunctionVariable,
  isStateVariable,
  isJSXVariable,
  isScope,
} from "../db/variable/type.ts";
import { traverseFn } from "../utils/babel.ts";
import { Scope } from "../db/variable/scope.ts";

function getStartLoc(node: t.Node): VariableLoc | null {
  if (!node.loc?.start) return null;
  return {
    line: node.loc.start.line,
    column: node.loc.start.column,
  };
}

function getOwnerVariable(
  path: traverse.NodePath,
  fileDb: import("../db/fileDB.ts").File,
): Variable | undefined {
  const jsxPath = path.findParent(
    (candidate) => candidate.isJSXElement() || candidate.isJSXFragment(),
  );
  if (jsxPath?.node.loc?.start) {
    const jsxOwner = fileDb.getVariable({
      line: jsxPath.node.loc.start.line,
      column: jsxPath.node.loc.start.column,
    });
    if (jsxOwner && isJSXVariable(jsxOwner)) {
      return jsxOwner;
    }
  }

  const containingFn = fileDb.getHookInfoFromLoc(
    getStartLoc(path.node) || { line: 0, column: 0 },
  );
  if (
    containingFn &&
    (isComponentVariable(containingFn) || isHookVariable(containingFn))
  ) {
    for (const effect of Object.values(containingFn.effects || {})) {
      if (
        effect.scope &&
        path.node.loc?.start &&
        path.node.loc.start.line >= effect.scope.start.line &&
        path.node.loc.end &&
        path.node.loc.end.line <= effect.scope.end.line
      ) {
        return {
          id: effect.id,
          kind: "effect",
          parent: containingFn,
        } as unknown as Variable;
      }
    }
  }

  const ownerPath = path.findParent((candidate) => {
    return (
      candidate.isVariableDeclarator() ||
      candidate.isFunctionDeclaration() ||
      candidate.isClassMethod() ||
      candidate.isClassPrivateMethod() ||
      candidate.isClassProperty() ||
      candidate.isClassPrivateProperty() ||
      candidate.isClassDeclaration()
    );
  });

  if (ownerPath) {
    let loc: VariableLoc | null = null;
    if (ownerPath.isVariableDeclarator()) {
      loc = getStartLoc(ownerPath.node.id);
    } else if (ownerPath.isFunctionDeclaration()) {
      if (ownerPath.node.id) {
        loc = getStartLoc(ownerPath.node.id);
      }
    } else if (
      ownerPath.isClassMethod() ||
      ownerPath.isClassPrivateMethod() ||
      ownerPath.isClassProperty() ||
      ownerPath.isClassPrivateProperty()
    ) {
      loc = getStartLoc(ownerPath.node.key);
    } else if (ownerPath.isClassDeclaration() && ownerPath.node.id) {
      loc = getStartLoc(ownerPath.node.id);
    }

    if (loc) {
      const owner = fileDb.getVariable(loc);
      if (owner) {
        return owner;
      }
    }
  }

  const fallbackLoc = getStartLoc(path.node);
  if (!fallbackLoc) return undefined;
  return fileDb.getHookInfoFromLoc(fallbackLoc);
}

function findReactStateTarget(owner: Variable | undefined, name: string) {
  let current: Variable | Scope | undefined = owner;
  while (current) {
    if (!isScope(current) && isReactFunctionVariable(current)) {
      for (const stateId of current.states) {
        const state = current.var.get(stateId);
        if (state && isStateVariable(state)) {
          const stateName =
            state.name.type === "identifier" ? state.name.name : undefined;
          if (state.setter === name || stateName === name) {
            return {
              id: state.id,
              hiddenIntermediate:
                state.setter === name ? "state-setter" : undefined,
            };
          }
        }
      }
    }
    current = current.parent;
  }

  return null;
}

function findClassMemberTarget(
  path: traverse.NodePath,
  fileDb: import("../db/fileDB.ts").File,
  propertyName: string,
) {
  const classPath = path.findParent(
    (candidate) =>
      candidate.isClassDeclaration() || candidate.isClassExpression(),
  );
  if (!classPath) return null;

  let classLoc: VariableLoc | null = null;
  if (classPath.isClassDeclaration() && classPath.node.id) {
    classLoc = getStartLoc(classPath.node.id);
  } else if (classPath.isClassExpression()) {
    const parent = classPath.parentPath;
    if (parent.isVariableDeclarator()) {
      classLoc = getStartLoc(parent.node.id);
    }
  }

  if (!classLoc) return null;

  const classVar = fileDb.getVariable(classLoc);
  if (!classVar || !isClassVariable(classVar)) {
    return null;
  }

  const targetId = classVar.var.getIdByName(propertyName);
  if (targetId) {
    return { id: targetId, hiddenIntermediate: undefined };
  }

  if (propertyName === "props") {
    return { id: classVar.id, hiddenIntermediate: undefined };
  }

  if (propertyName === "state") {
    return { id: classVar.id, hiddenIntermediate: undefined };
  }

  if (propertyName === "setState") {
    const stateId = classVar.var.getIdByName("state");
    if (stateId) {
      return {
        id: stateId,
        hiddenIntermediate: "state-setter",
      };
    }
    // Fallback if no state property is explicitly defined
    return {
      id: classVar.id,
      hiddenIntermediate: "state-setter",
    };
  }

  return null;
}

function resolveIdentifierTarget(
  fileDb: import("../db/fileDB.ts").File,
  owner: Variable | undefined,
  name: string,
  loc: VariableLoc,
) {
  if (owner) {
    // If it's props or state in a class method or constructor
    if (name === "props" || name === "state") {
      let current: Variable | Scope | undefined = owner;
      while (current) {
        if (!isScope(current) && isComponentVariable(current)) {
          return { id: current.id, hiddenIntermediate: undefined };
        }
        current = current.parent;
      }
    }
  }

  const reactState = findReactStateTarget(owner, name);
  if (reactState) {
    return reactState;
  }

  const id = fileDb.getReferenceId(name, loc);
  if (!id) return null;
  return { id, hiddenIntermediate: undefined };
}

function resolveMemberTarget(
  member: t.MemberExpression | t.OptionalMemberExpression,
  path: traverse.NodePath,
  fileDb: import("../db/fileDB.ts").File,
) {
  const accessPath: string[] = [];
  let current: t.Expression = member;

  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const property = current.property;
    if (!current.computed && t.isIdentifier(property)) {
      accessPath.unshift(property.name);
    } else if (current.computed && t.isStringLiteral(property)) {
      accessPath.unshift(property.value);
    } else {
      break;
    }
    current = current.object as t.Expression;
  }

  const propertyName = accessPath.at(-1);
  if (!propertyName) return null;

  if (t.isThisExpression(current)) {
    const classTarget = findClassMemberTarget(path, fileDb, propertyName);
    if (!classTarget) return null;
    return {
      ...classTarget,
      accessPath,
      isComputed: member.computed,
      isOptional: "optional" in member ? !!member.optional : false,
    };
  }

  return null;
}

function getMemberAccessPath(
  member: t.MemberExpression | t.OptionalMemberExpression,
) {
  const accessPath: string[] = [];
  let current: t.Expression = member;

  while (
    t.isMemberExpression(current) ||
    t.isOptionalMemberExpression(current)
  ) {
    const property = current.property;
    if (!current.computed && t.isIdentifier(property)) {
      accessPath.unshift(property.name);
    } else if (current.computed && t.isStringLiteral(property)) {
      accessPath.unshift(property.value);
    } else {
      break;
    }
    current = current.object as t.Expression;
  }

  return {
    base: current,
    accessPath,
    isOptional: "optional" in member ? !!member.optional : false,
    isComputed: member.computed,
  };
}

function shouldSkipReferencedIdentifier(path: traverse.NodePath<t.Identifier>) {
  const parent = path.parentPath;

  if (
    (parent.isCallExpression() || parent.isOptionalCallExpression()) &&
    parent.get("callee") === path
  ) {
    return true;
  }

  if (parent.isNewExpression() && parent.get("callee") === path) {
    return true;
  }

  if (parent.isJSXOpeningElement() || parent.isJSXClosingElement()) {
    return true;
  }

  if (
    parent.isMemberExpression() &&
    parent.get("property") === path &&
    !parent.node.computed
  ) {
    return true;
  }

  if (
    parent.isOptionalMemberExpression() &&
    parent.get("property") === path &&
    !parent.node.computed
  ) {
    return true;
  }

  if (parent.isAssignmentExpression() && parent.get("left") === path) {
    return true;
  }

  if (parent.isUpdateExpression() && parent.get("argument") === path) {
    return true;
  }

  return false;
}

export function extractFileUsages(
  ast: File,
  componentDB: ComponentDB,
  fileName: string,
) {
  const fileDb = componentDB.getFile(fileName);
  const seen = new Set<string>();

  const emitRelation = (
    kind: UsageRelationKind,
    fromId: string,
    toId: string,
    loc: VariableLoc,
    owner: Variable,
    extras: Partial<UsageOccurrence> = {},
  ) => {
    const usage: UsageOccurrence = {
      usageId: getDeterministicId(
        fileName,
        owner.id,
        fromId,
        toId,
        kind,
        `${loc.line}:${loc.column}`,
        JSON.stringify(extras),
      ),
      filePath: fileName,
      line: loc.line,
      column: loc.column,
      ownerId: owner.id,
      ownerKind: owner.kind,
      accessPath: extras.accessPath,
      isOptional: extras.isOptional,
      isComputed: extras.isComputed,
      hiddenIntermediate: extras.hiddenIntermediate,
      displayLabel: extras.displayLabel,
    };

    const dedupeKey = `${usage.usageId}:${kind}`;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);

    const relation: ComponentRelation = {
      from_id: fromId,
      to_id: toId,
      kind,
      line: loc.line,
      column: loc.column,
      data_json: usage,
    };

    fileDb.addRelation(relation);
  };

  traverseFn(ast, {
    Identifier(path) {
      if (!path.isReferencedIdentifier()) return;
      if (shouldSkipReferencedIdentifier(path)) return;

      const loc = getStartLoc(path.node);
      if (!loc) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      const target = resolveIdentifierTarget(
        fileDb,
        owner,
        path.node.name,
        loc,
      );
      if (!target || target.id === owner.id) return;

      const parent = path.parentPath;
      if (parent.isMemberExpression() && parent.get("object") === path) {
        const memberData = getMemberAccessPath(parent.node);
        emitRelation("usage-read", target.id, owner.id, loc, owner, {
          accessPath: memberData.accessPath,
          isOptional: memberData.isOptional,
          isComputed: memberData.isComputed,
          hiddenIntermediate: target.hiddenIntermediate,
          displayLabel: [path.node.name, ...memberData.accessPath].join("."),
        });
        return;
      }

      if (
        parent.isOptionalMemberExpression() &&
        parent.get("object") === path
      ) {
        const memberData = getMemberAccessPath(parent.node);
        emitRelation("usage-read", target.id, owner.id, loc, owner, {
          accessPath: memberData.accessPath,
          isOptional: memberData.isOptional,
          isComputed: memberData.isComputed,
          hiddenIntermediate: target.hiddenIntermediate,
          displayLabel: [path.node.name, ...memberData.accessPath].join("."),
        });
        return;
      }

      emitRelation("usage-read", target.id, owner.id, loc, owner, {
        hiddenIntermediate: target.hiddenIntermediate,
        displayLabel: path.node.name,
      });
    },

    JSXOpeningElement(path) {
      const nameNode = path.node.name;
      if (!t.isJSXIdentifier(nameNode)) return;
      if (!/^[A-Z]/.test(nameNode.name)) return;

      const loc = getStartLoc(nameNode);
      if (!loc) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      const target = resolveIdentifierTarget(fileDb, owner, nameNode.name, loc);
      if (!target || target.id === owner.id) return;

      emitRelation("usage-render-call", owner.id, target.id, loc, owner, {
        hiddenIntermediate: target.hiddenIntermediate,
        displayLabel: nameNode.name,
      });
    },

    CallExpression(path) {
      const loc = getStartLoc(path.node);
      if (!loc) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      const callee = path.node.callee;
      if (t.isIdentifier(callee)) {
        const target = resolveIdentifierTarget(fileDb, owner, callee.name, loc);
        if (!target || target.id === owner.id) return;
        emitRelation("usage-call", owner.id, target.id, loc, owner, {
          hiddenIntermediate: target.hiddenIntermediate,
          displayLabel: callee.name,
        });
        return;
      }

      if (
        t.isMemberExpression(callee) ||
        t.isOptionalMemberExpression(callee)
      ) {
        const target = resolveMemberTarget(callee, path, fileDb);
        if (!target || target.id === owner.id) return;

        // Special handling for setState functional update parameters
        if (target.hiddenIntermediate === "state-setter") {
          const firstArg = path.get("arguments")[0];
          if (
            firstArg &&
            (firstArg.isArrowFunctionExpression() ||
              firstArg.isFunctionExpression())
          ) {
            const params = firstArg.get("params");

            if (Array.isArray(params)) {
              // First parameter is 'state'
              if (params.length >= 1 && params[0]?.isIdentifier()) {
                const paramName = params[0].node.name;
                const paramLoc = getStartLoc(params[0].node);
                if (paramLoc) {
                  const paramVar = fileDb.getVariable(paramLoc);
                  if (paramVar) {
                    componentDB.addVariableDependency(fileName, paramVar.id, {
                      id: target.id,
                      name: paramName,
                    });
                  }
                }
              }
              // Second parameter is 'props'
              if (params.length >= 2 && params[1]?.isIdentifier()) {
                const paramName = params[1].node.name;
                const paramLoc = getStartLoc(params[1].node);
                if (paramLoc) {
                  const paramVar = fileDb.getVariable(paramLoc);
                  if (paramVar) {
                    // Link props parameter to the component itself (since component ID is also used for this.props)
                    let current: Variable | Scope | undefined = owner;
                    while (current) {
                      if (!isScope(current) && isComponentVariable(current)) {
                        componentDB.addVariableDependency(
                          fileName,
                          paramVar.id,
                          {
                            id: current.id,
                            name: paramName,
                          },
                        );
                        break;
                      }
                      current = current.parent;
                    }
                  }
                }
              }
            }
          }

          // Emit usage-write for each key in the setState argument
          if (firstArg) {
            let stateNode: t.Node | null = firstArg.node;
            if (
              t.isArrowFunctionExpression(stateNode) ||
              t.isFunctionExpression(stateNode)
            ) {
              if (t.isObjectExpression(stateNode.body)) {
                stateNode = stateNode.body;
              } else if (t.isBlockStatement(stateNode.body)) {
                const lastStatement = stateNode.body.body.at(-1);
                if (
                  t.isReturnStatement(lastStatement) &&
                  lastStatement.argument
                ) {
                  stateNode = lastStatement.argument;
                }
              }
            }

            if (t.isObjectExpression(stateNode)) {
              for (const prop of stateNode.properties) {
                if (
                  t.isObjectProperty(prop) &&
                  !prop.computed &&
                  t.isIdentifier(prop.key)
                ) {
                  const stateName = prop.key.name;
                  // Resolve stateName to individual state variable
                  let current: Variable | Scope | undefined = owner;
                  while (current) {
                    if (!isScope(current) && isComponentVariable(current)) {
                      const stateId = current.var.getIdByName(stateName);
                      if (stateId) {
                        emitRelation(
                          "usage-write",
                          owner.id,
                          stateId,
                          getStartLoc(prop.key)!,
                          owner,
                          {
                            displayLabel: stateName,
                            hiddenIntermediate: "state-setter",
                          },
                        );
                      }
                      break;
                    }
                    current = current.parent;
                  }
                }
              }
            }
          }
        }

        emitRelation("usage-call", owner.id, target.id, loc, owner, {
          accessPath: target.accessPath,
          isOptional: target.isOptional,
          isComputed: target.isComputed,
          hiddenIntermediate: target.hiddenIntermediate,
          displayLabel: target.accessPath?.join("."),
        });
      }
    },

    NewExpression(path) {
      const loc = getStartLoc(path.node);
      if (!loc) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      const callee = path.node.callee;
      if (!t.isIdentifier(callee)) return;

      const target = resolveIdentifierTarget(fileDb, owner, callee.name, loc);
      if (!target || target.id === owner.id) return;
      emitRelation("usage-call", owner.id, target.id, loc, owner, {
        hiddenIntermediate: target.hiddenIntermediate,
        displayLabel: callee.name,
      });
    },

    AssignmentExpression(path) {
      const loc = getStartLoc(path.node.left);
      if (!loc) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      let target: {
        id: string;
        accessPath?: string[];
        isOptional?: boolean;
        isComputed?: boolean;
        hiddenIntermediate?: string | undefined;
      } | null = null;

      if (t.isIdentifier(path.node.left)) {
        target = resolveIdentifierTarget(
          fileDb,
          owner,
          path.node.left.name,
          loc,
        );
      } else if (
        t.isMemberExpression(path.node.left) ||
        t.isOptionalMemberExpression(path.node.left)
      ) {
        target = resolveMemberTarget(path.node.left, path, fileDb);
      }

      if (!target || target.id === owner.id) return;

      emitRelation("usage-write", owner.id, target.id, loc, owner, {
        accessPath: target.accessPath,
        isOptional: target.isOptional,
        isComputed: target.isComputed,
        hiddenIntermediate: target.hiddenIntermediate,
        displayLabel:
          target.accessPath?.join(".") ||
          (t.isIdentifier(path.node.left) ? path.node.left.name : undefined),
      });
    },

    UpdateExpression(path) {
      const loc = getStartLoc(path.node.argument);
      if (!loc || !t.isIdentifier(path.node.argument)) return;

      const owner = getOwnerVariable(path, fileDb);
      if (!owner) return;

      const target = resolveIdentifierTarget(
        fileDb,
        owner,
        path.node.argument.name,
        loc,
      );
      if (!target || target.id === owner.id) return;

      emitRelation("usage-write", owner.id, target.id, loc, owner, {
        hiddenIntermediate: target.hiddenIntermediate,
        displayLabel: path.node.argument.name,
      });
    },
  });
}
