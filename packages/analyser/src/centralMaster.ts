import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ComponentDBResolve,
  ComponentFile,
  ComponentFileVar,
  ComponentInfoRender,
  DataEdge,
  JsonData,
  TypeData,
  TypeDataDeclare,
  WorkspacePackageRow,
} from "@nexiq/shared";
import { discoverWorkspacePackages } from "./workspace.ts";
import { getFiles, getViteConfig } from "./analyzer/utils.ts";
import { PackageJson } from "./db/packageJson.ts";
import { SqliteDB } from "./db/sqlite.ts";
import { PackageMaster } from "./packageMaster.ts";
import type {
  AnalyzeProjectOptions,
  PackageAnalysisSummary,
  ResolvedCrossPackageRelation,
  WorkspaceAnalysisHandoff,
  WorkspaceExternalImport,
  WorkspacePackageExport,
} from "./types.ts";
import { WorkspaceSqliteDB } from "./workspaceSqlite.ts";
import { resolvePath } from "./utils/path.ts";

function getWorkspaceRunId(rootDir: string) {
  return `workspace:${rootDir.replace(/[^a-zA-Z0-9_-]/g, "_")}:${Date.now()}`;
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) {
        return;
      }
      await worker(item);
    }
  });
  await Promise.all(runners);
}

function getEffectiveFileWorkerThreads(
  requestedThreads: number | undefined,
  packageConcurrency: number,
) {
  const cpuCount = Math.max(1, os.cpus().length);
  const requested = requestedThreads ?? cpuCount;
  const concurrencyCap = Math.max(1, Math.floor(cpuCount / packageConcurrency));
  return Math.max(1, Math.min(requested, concurrencyCap));
}

function getPackageDbPath(packageDbDir: string, packagePath: string) {
  const safe = packagePath.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(packageDbDir, `${safe}.sqlite`);
}

function getWorkspaceScopes(packageNames: string[]) {
  const scopes = new Set<string>();
  for (const packageName of packageNames) {
    if (packageName.startsWith("@")) {
      const [scope] = packageName.split("/");
      if (scope) {
        scopes.add(scope);
      }
    }
  }
  return scopes;
}

function getPackageNameFromModule(sourceModule: string) {
  if (sourceModule.startsWith("@")) {
    const parts = sourceModule.split("/");
    return parts.slice(0, 2).join("/");
  }
  return sourceModule.split("/")[0] || sourceModule;
}

function stripExtension(filePath: string) {
  return filePath.replace(/\.(tsx?|jsx?|mjs|cjs)$/, "");
}

function toRootRelativePath(
  workspaceRoot: string,
  packageDir: string,
  filePath: string,
) {
  const withoutLeadingSlash = filePath.replace(/^\//, "");
  return path
    .relative(workspaceRoot, path.join(packageDir, withoutLeadingSlash))
    .replaceAll(path.sep, "/");
}

function createCrossPackageResolveTask(
  externalImport: WorkspaceExternalImport,
  message: string,
): ComponentDBResolve {
  return {
    type: "crossPackageImport",
    fileName: externalImport.filePath,
    source: externalImport.sourceModule,
    localName: externalImport.localName,
    importedName: externalImport.importedName,
    importType: externalImport.importType,
    importKind: externalImport.importKind,
    message,
  };
}

function getImportSymbolId(filePath: string, localName: string) {
  return `symbol:import:${filePath}:${localName}`;
}

function getCrossPackageErrorId(
  runId: string,
  externalImport: WorkspaceExternalImport,
) {
  return `${runId}:${externalImport.packageId}:${externalImport.filePath}:${externalImport.localName}:${externalImport.sourceModule}`;
}

function matchesEntryCandidate(filePath: string, entryCandidates: string[]) {
  const normalized = stripExtension(filePath.replace(/^\//, ""));
  return entryCandidates.some((candidate) => {
    const candidateNoExt = stripExtension(
      candidate.replace(/^\.\//, "").replace(/^\//, ""),
    );
    return (
      normalized === candidateNoExt || normalized.endsWith(`/${candidateNoExt}`)
    );
  });
}

function matchesSubpath(filePath: string, subpath?: string) {
  if (!subpath) {
    return true;
  }

  const normalizedFile = stripExtension(filePath.replace(/^\//, ""));
  const normalizedSubpath = stripExtension(subpath.replace(/^\//, ""));
  return (
    normalizedFile.endsWith(`/${normalizedSubpath}`) ||
    normalizedFile.endsWith(`/${normalizedSubpath}/index`) ||
    normalizedFile.endsWith(`/src/${normalizedSubpath}`) ||
    normalizedFile.endsWith(`/src/${normalizedSubpath}/index`)
  );
}

function resolveImportAgainstExports(
  externalImport: WorkspaceExternalImport,
  targetExports: WorkspacePackageExport[],
  entryCandidates: string[],
): {
  relation?: ResolvedCrossPackageRelation;
  error?: string;
} {
  const scopedExports = targetExports.filter((candidate) =>
    matchesSubpath(candidate.filePath, externalImport.sourceSubpath),
  );

  let candidates = scopedExports;
  if (externalImport.importType === "default") {
    candidates = candidates.filter((candidate) => candidate.isDefault);
  } else if (
    externalImport.importType === "named" ||
    externalImport.importType === "type"
  ) {
    const importedName =
      externalImport.importedName || externalImport.localName;
    candidates = candidates.filter(
      (candidate) => candidate.exportName === importedName,
    );
  } else {
    return {
      error: `Unsupported workspace import type ${externalImport.importType}`,
    };
  }

  if (candidates.length === 0) {
    return {
      error: `No matching export found for ${externalImport.sourceModule}`,
    };
  }

  if (candidates.length > 1) {
    const preferred = candidates.filter((candidate) =>
      matchesEntryCandidate(candidate.filePath, entryCandidates),
    );
    if (preferred.length === 1) {
      candidates = preferred;
    }
  }

  if (candidates.length > 1) {
    return {
      error: `Ambiguous export match for ${externalImport.sourceModule}`,
    };
  }

  const match = candidates[0]!;
  return {
    relation: {
      fromPackageId: externalImport.packageId,
      fromPackageName: externalImport.packageName,
      toPackageId: match.packageId,
      toPackageName: match.packageName,
      sourceFilePath: externalImport.filePath,
      targetFilePath: match.filePath,
      sourceLocalName: externalImport.localName,
      targetExportName: match.exportName,
      targetExportId: match.exportId,
      sourceImportId: getImportSymbolId(
        externalImport.filePath,
        externalImport.localName,
      ),
      relationKind: "import",
    },
  };
}

function cloneFile(file: ComponentFile): ComponentFile {
  return JSON.parse(JSON.stringify(file)) as ComponentFile;
}

type StringReplacement = {
  from: string;
  to: string;
};

type PackageGraphRemapContext = {
  canonicalPathByFile: Map<string, string>;
  globalIdMap: Map<string, string>;
  fileReplacementsByPath: Map<string, StringReplacement[]>;
};

type CanonicalImportResolution = {
  canonicalFilePath: string;
  localName: string;
  sourceImportId: string;
  targetExportId: string;
};

type NamespaceBinding = {
  externalImport: WorkspaceExternalImport;
  targetPackageName: string;
};

type WorkspacePackageBinding = {
  packageId: string;
  handoff: WorkspaceAnalysisHandoff;
  srcDir: string;
  remapContext?: PackageGraphRemapContext;
};

type TypeRewriteContext = {
  resolvedImportTargets: Map<string, string>;
  namespaceBindings: Map<string, NamespaceBinding>;
  packageByName: Map<string, WorkspacePackageBinding>;
  workspaceScopes: Set<string>;
  sourceFilePath: string;
  sourcePackageId: string;
  sourcePackageName: string;
  onUnresolved: (
    sourceModule: string,
    exportName: string,
    message: string,
  ) => void;
};

function qualifyGraphId(filePath: string, id: string) {
  return `workspace:${filePath}:${id}`;
}

function sortReplacements(replacements: Iterable<StringReplacement>) {
  return Array.from(replacements).sort((a, b) => b.from.length - a.from.length);
}

function applyStringReplacements(
  value: string,
  replacements: StringReplacement[],
) {
  if (replacements.length === 0) {
    return value;
  }
  const map = new Map<string, string>();
  for (const r of replacements) {
    map.set(r.from, r.to);
  }

  // Create a regex that matches any of the 'from' strings, escaped for regex
  // Sort by length descending to match longest possible string first (standard for ID remapping)
  const sortedKeys = replacements
    .map((r) => r.from)
    .sort((a, b) => b.length - a.length);
  const pattern = sortedKeys
    .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const regex = new RegExp(`"(${pattern})"`, "g");

  return value.replace(regex, (match, p1) => {
    const to = map.get(p1);
    return to ? JSON.stringify(to) : match;
  });
}

function remapJsonValue<T>(value: T, replacements: StringReplacement[]): T {
  return JSON.parse(
    applyStringReplacements(JSON.stringify(value), replacements),
  ) as T;
}

function collectFileLocalGraphIds(file: ComponentFile) {
  const ids = new Set<string>();

  ids.add(`scope:module:${file.path}`);
  for (const fileImport of Object.values(file.import)) {
    ids.add(`entity:import:${file.path}:${fileImport.localName}`);
    ids.add(`symbol:import:${file.path}:${fileImport.localName}`);
  }

  const walk = (value: unknown, parentKey?: string) => {
    if (!value) {
      return;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        walk(item, parentKey);
      }
      return;
    }

    if (typeof value !== "object") {
      return;
    }

    const record = value as Record<string, unknown>;
    if (typeof record.id === "string") {
      ids.add(record.id);
    }
    if (typeof record.instanceId === "string") {
      ids.add(record.instanceId);
    }
    if (typeof record.parentId === "string") {
      ids.add(record.parentId);
    }

    for (const [key, child] of Object.entries(record)) {
      if (
        child &&
        typeof child === "object" &&
        !Array.isArray(child) &&
        ["var", "children", "dependencies", "effects", "tsTypes"].includes(key)
      ) {
        for (const nestedKey of Object.keys(child as Record<string, unknown>)) {
          ids.add(nestedKey);
        }
      }
      walk(child, key);
    }
  };

  walk(file);
  return ids;
}

function buildPackageGraphRemapContext(
  workspaceRoot: string,
  packageDir: string,
  summary: PackageAnalysisSummary,
): PackageGraphRemapContext {
  const canonicalPathByFile = new Map<string, string>();
  const fileReplacementsByPath = new Map<string, StringReplacement[]>();
  const globalIdMap = new Map<string, string>();
  const ambiguousGlobalIds = new Set<string>();

  const addGlobalId = (oldId: string, newId: string) => {
    if (ambiguousGlobalIds.has(oldId)) {
      return;
    }
    const existing = globalIdMap.get(oldId);
    if (!existing) {
      globalIdMap.set(oldId, newId);
      return;
    }
    if (existing !== newId) {
      globalIdMap.delete(oldId);
      ambiguousGlobalIds.add(oldId);
    }
  };

  for (const file of Object.values(summary.graph.files)) {
    const canonicalPath = toRootRelativePath(
      workspaceRoot,
      packageDir,
      file.path,
    );
    canonicalPathByFile.set(file.path, canonicalPath);

    const fileLocalIds = collectFileLocalGraphIds(file);
    const replacements = new Map<string, string>();
    replacements.set(file.path, canonicalPath);
    addGlobalId(file.path, canonicalPath);

    for (const oldId of fileLocalIds) {
      const qualifiedId = qualifyGraphId(canonicalPath, oldId);
      replacements.set(oldId, qualifiedId);
      addGlobalId(oldId, qualifiedId);
    }

    fileReplacementsByPath.set(
      file.path,
      sortReplacements(
        Array.from(replacements.entries()).map(([from, to]) => ({ from, to })),
      ),
    );
  }

  return {
    canonicalPathByFile,
    globalIdMap,
    fileReplacementsByPath,
  };
}

function remapResolveTask(
  task: ComponentDBResolve,
  context: PackageGraphRemapContext,
): ComponentDBResolve {
  const fileReplacements =
    context.fileReplacementsByPath.get(task.fileName) || [];
  const globalReplacements = sortReplacements(
    Array.from(context.globalIdMap.entries()).map(([from, to]) => ({
      from,
      to,
    })),
  );
  return remapJsonValue(
    task,
    sortReplacements([...fileReplacements, ...globalReplacements]),
  );
}

function edgeKey(edge: DataEdge) {
  return `${edge.label}:${edge.from}:${edge.to}`;
}

function collectCrossPackageUsageEdges(
  file: ComponentFile,
  canonicalFilePath: string,
  resolvedImportTargets: Map<string, string>,
): DataEdge[] {
  const edges: DataEdge[] = [];
  const seen = new Set<string>();

  const pushEdge = (edge: DataEdge) => {
    const key = edgeKey(edge);
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(edge);
    }
  };

  const getResolvedImportId = (name?: string) => {
    if (!name) {
      return undefined;
    }
    return resolvedImportTargets.get(`${canonicalFilePath}:${name}`);
  };

  const walkRenderChildren = (
    children: Record<string, ComponentInfoRender> | undefined,
    ownerId: string,
  ) => {
    if (!children) {
      return;
    }

    for (const child of Object.values(children)) {
      const targetExportId = child.isDependency
        ? getResolvedImportId(child.tag)
        : undefined;

      if (targetExportId) {
        pushEdge({
          from: targetExportId,
          to: ownerId,
          label: "render",
        });
      }
      walkRenderChildren(child.children, ownerId);
    }
  };

  //TODO: test and replace
  const walkRenderChildren2 = (
    child: ComponentInfoRender | null,
    ownerId: string,
  ) => {
    if (!child) {
      return;
    }

    const targetExportId = child.isDependency
      ? getResolvedImportId(child.tag)
      : undefined;

    if (targetExportId) {
      pushEdge({
        from: targetExportId,
        to: ownerId,
        label: "render",
      });
    }

    for (const grandChild of Object.values(child.children)) {
      walkRenderChildren2(grandChild, ownerId);
    }
  };

  const walkVariable = (variable: ComponentFileVar, ownerId?: string) => {
    const currentOwnerId =
      variable.kind === "component" || variable.kind === "hook"
        ? variable.id
        : ownerId;

    if ("hooks" in variable && Array.isArray(variable.hooks)) {
      for (const hookId of variable.hooks) {
        const targetExportId = getResolvedImportId(hookId);
        if (targetExportId) {
          pushEdge({
            from: variable.id,
            to: targetExportId,
            label: "hook",
          });
        }
      }
    }

    if (
      "return" in variable &&
      variable.return &&
      typeof variable.return !== "string"
    ) {
      const returnValue = variable.return;
      if (returnValue.type === "jsx" && currentOwnerId) {
        const targetExportId = getResolvedImportId(returnValue.srcId);

        if (targetExportId) {
          pushEdge({
            from: targetExportId,
            to: currentOwnerId,
            label: "render",
          });
        }
        walkRenderChildren2(returnValue.render, currentOwnerId);
      }
    }

    if ("call" in variable && variable.call) {
      const targetExportId =
        getResolvedImportId(variable.call.resolvedId || variable.call.id) ||
        getResolvedImportId(variable.call.name);
      if (targetExportId) {
        pushEdge({
          from: variable.id,
          to: targetExportId,
          label: "hook",
        });
      }
    }

    for (const dependency of Object.values(variable.dependencies || {})) {
      const targetExportId = getResolvedImportId(dependency.id);
      if (targetExportId) {
        pushEdge({
          from: variable.id,
          to: targetExportId,
          label: "hook",
        });
      }
    }

    if (currentOwnerId) {
      if ("render" in variable && variable.render) {
        walkRenderChildren(
          { [variable.render.instanceId]: variable.render },
          currentOwnerId,
        );
      } else if ("children" in variable && variable.children) {
        walkRenderChildren(variable.children, currentOwnerId);
      }
    }

    if ("var" in variable && variable.var) {
      for (const nested of Object.values(variable.var)) {
        walkVariable(nested, currentOwnerId);
      }
    }
  };

  for (const variable of Object.values(file.var)) {
    walkVariable(variable);
  }

  return edges;
}

function getSourceSubpath(sourceModule: string) {
  const packageName = getPackageNameFromModule(sourceModule);
  if (!sourceModule.startsWith(packageName)) {
    return undefined;
  }
  const subpath = sourceModule.slice(packageName.length).replace(/^\//, "");
  return subpath || undefined;
}

function resolveCanonicalWorkspaceExport(
  sourceModule: string,
  exportName: string,
  context: TypeRewriteContext,
): { exportId?: string; message?: string } {
  const targetPackageName = getPackageNameFromModule(sourceModule);
  const targetPackage = context.packageByName.get(targetPackageName);
  const isWorkspaceCandidate =
    targetPackage != null ||
    (targetPackageName.startsWith("@") &&
      context.workspaceScopes.has(targetPackageName.split("/")[0] || ""));

  if (!isWorkspaceCandidate) {
    return {};
  }

  if (!targetPackage) {
    return {
      message: `Failed to resolve workspace package import ${sourceModule}`,
    };
  }

  const resolution = resolveImportAgainstExports(
    {
      packageId: context.sourcePackageId,
      packageName: context.sourcePackageName,
      filePath: context.sourceFilePath,
      sourceModule,
      sourcePackageName: targetPackageName,
      sourceSubpath: getSourceSubpath(sourceModule),
      localName: exportName,
      importedName: exportName,
      importType: "type",
      importKind: "type",
    },
    targetPackage.handoff.exports,
    targetPackage.handoff.entryCandidates,
  );

  if (!resolution.relation) {
    return {
      message: resolution.error || `Failed to resolve import ${sourceModule}`,
    };
  }

  const canonicalTargetExportId =
    targetPackage.remapContext?.globalIdMap.get(
      resolution.relation.targetExportId,
    ) || resolution.relation.targetExportId;

  return {
    exportId: canonicalTargetExportId,
  };
}

function rewriteTypeDataRefTargets(
  typeData: TypeData | undefined,
  context: TypeRewriteContext,
) {
  if (!typeData) {
    return;
  }

  const rewriteRef = (ref: Extract<TypeData, { type: "ref" }>) => {
    if (
      ref.refType === "qualified" &&
      ref.unresolvedWorkspace &&
      ref.names.length === 2
    ) {
      const [namespaceId, exportName] = ref.names;
      if (!namespaceId || !exportName) {
        return;
      }

      const namespaceBinding = context.namespaceBindings.get(namespaceId);
      if (!namespaceBinding) {
        return;
      }

      const resolution = resolveCanonicalWorkspaceExport(
        namespaceBinding.externalImport.sourceModule,
        exportName,
        context,
      );
      if (!resolution.exportId) {
        if (resolution.message) {
          context.onUnresolved(
            namespaceBinding.externalImport.sourceModule,
            exportName,
            resolution.message,
          );
        }
        return;
      }

      const namedRef = ref as unknown as Record<string, unknown>;
      namedRef.refType = "named";
      namedRef.name = resolution.exportId;
      delete namedRef.names;
      namedRef.resolvedId = resolution.exportId;
      delete namedRef.unresolvedWorkspace;
      return;
    }

    const currentRef =
      ref.resolvedId || (ref.refType === "named" ? ref.name : ref.names[0]);
    if (!currentRef) {
      return;
    }

    const targetExportId = context.resolvedImportTargets.get(currentRef);
    if (!targetExportId) {
      return;
    }

    if (ref.refType === "named") {
      ref.name = targetExportId;
    } else if (ref.names.length > 0) {
      ref.names[0] = targetExportId;
    }
    ref.resolvedId = targetExportId;
    delete ref.unresolvedWorkspace;
  };

  const rewriteImport = (importType: Extract<TypeData, { type: "import" }>) => {
    if (!importType.qualifier) {
      return;
    }

    if (importType.unresolvedWorkspace || importType.name.startsWith("@")) {
      const resolution = resolveCanonicalWorkspaceExport(
        importType.name,
        importType.qualifier,
        context,
      );
      if (!resolution.exportId) {
        if (resolution.message) {
          context.onUnresolved(
            importType.name,
            importType.qualifier,
            resolution.message,
          );
        }
        return;
      }

      importType.name = resolution.exportId;
      importType.resolvedId = resolution.exportId;
      delete importType.unresolvedWorkspace;
    }
  };

  const rewriteLiteralType = (
    literal: Extract<TypeData, { type: "literal-type" }>["literal"],
  ) => {
    if (literal.type === "template") {
      for (const expression of literal.expression) {
        rewriteTypeDataRefTargets(expression, context);
      }
      return;
    }

    if (literal.type === "unary") {
      rewriteLiteralType(literal.argument);
    }
  };

  switch (typeData.type) {
    case "ref":
      rewriteRef(typeData);
      for (const param of typeData.params || []) {
        rewriteTypeDataRefTargets(param, context);
      }
      return;
    case "import":
      rewriteImport(typeData);
      return;
    case "union":
    case "intersection":
      for (const member of typeData.members) {
        rewriteTypeDataRefTargets(member, context);
      }
      return;
    case "array":
      rewriteTypeDataRefTargets(typeData.element, context);
      return;
    case "parenthesis":
      rewriteTypeDataRefTargets(typeData.members, context);
      return;
    case "type-literal":
      for (const member of typeData.members) {
        if (member.signatureType === "method") {
          for (const parameter of member.parameters) {
            rewriteTypeDataRefTargets(parameter.typeData, context);
          }
          for (const param of member.params) {
            rewriteTypeDataRefTargets(param.constraint, context);
            rewriteTypeDataRefTargets(param.default, context);
          }
          rewriteTypeDataRefTargets(member.return, context);
        } else if (member.signatureType === "index") {
          rewriteTypeDataRefTargets(member.parameter.type, context);
          rewriteTypeDataRefTargets(member.type, context);
        } else {
          rewriteTypeDataRefTargets(member.type, context);
        }
      }
      return;
    case "literal-type":
      rewriteLiteralType(typeData.literal);
      return;
    case "function":
      for (const parameter of typeData.parameters) {
        rewriteTypeDataRefTargets(parameter.typeData, context);
      }
      for (const param of typeData.params) {
        rewriteTypeDataRefTargets(param.constraint, context);
        rewriteTypeDataRefTargets(param.default, context);
      }
      rewriteTypeDataRefTargets(typeData.return, context);
      return;
    case "tuple":
      for (const element of typeData.elements) {
        rewriteTypeDataRefTargets(element.typeData, context);
      }
      return;
    case "index-access":
      rewriteTypeDataRefTargets(typeData.indexType, context);
      rewriteTypeDataRefTargets(typeData.objectType, context);
      return;
    case "query":
      if (typeData.expr.type === "ref") {
        rewriteRef(typeData.expr);
      } else if (typeData.expr.type === "import") {
        const originalName = typeData.expr.name;
        rewriteImport(typeData.expr);
        if (typeData.expr.resolvedId) {
          typeData.expr = {
            type: "ref",
            refType: "named",
            name: typeData.expr.resolvedId,
            resolvedId: typeData.expr.resolvedId,
          };
        } else {
          typeData.expr.name = originalName;
        }
      }
      return;
    default:
      return;
  }
}

function rewriteFileEntityData(
  file: ComponentFile,
  context: TypeRewriteContext,
) {
  // 1. Remap imports
  for (const imp of Object.values(file.import || {})) {
    const targetExportId = context.resolvedImportTargets.get(
      `${context.sourceFilePath}:${imp.localName}`,
    );
    if (targetExportId) {
      imp.resolvedId = targetExportId;
    }
  }

  // 2. Recursively remap hook calls in variables
  const walk = (v: ComponentFileVar) => {
    if (v.kind === "hook" && "call" in v && v.call) {
      const targetExportId = context.resolvedImportTargets.get(
        `${context.sourceFilePath}:${v.call.name}`,
      );
      if (targetExportId) {
        v.call.resolvedId = targetExportId;
      }
    }
    if ("var" in v && v.var) {
      for (const nested of Object.values(v.var)) {
        walk(nested);
      }
    }
  };

  for (const variable of Object.values(file.var || {})) {
    walk(variable);
  }
}

function rewriteFileTypeRefTargets(
  file: ComponentFile,
  context: TypeRewriteContext,
) {
  const rewriteTypeDeclare = (typeDeclare: TypeDataDeclare) => {
    if (typeDeclare.type === "interface") {
      if (typeDeclare.extends) {
        typeDeclare.extends = typeDeclare.extends.map(
          (value) => context.resolvedImportTargets.get(value) || value,
        );
      }
      if (typeDeclare.params) {
        for (const param of Object.values(typeDeclare.params)) {
          rewriteTypeDataRefTargets(param.constraint, context);
          rewriteTypeDataRefTargets(param.default, context);
        }
      }
      rewriteTypeDataRefTargets(
        { type: "type-literal", members: typeDeclare.body },
        context,
      );
      return;
    }

    if (typeDeclare.params) {
      for (const param of typeDeclare.params) {
        rewriteTypeDataRefTargets(param.constraint, context);
        rewriteTypeDataRefTargets(param.default, context);
      }
    }
    rewriteTypeDataRefTargets(typeDeclare.body, context);
  };

  const walkVariable = (variable: ComponentFileVar) => {
    if ("propType" in variable && variable.propType) {
      rewriteTypeDataRefTargets(variable.propType, context);
    }

    if ("var" in variable && variable.var) {
      for (const nested of Object.values(variable.var)) {
        walkVariable(nested);
      }
    }
  };

  for (const typeDeclare of Object.values(file.tsTypes || {})) {
    rewriteTypeDeclare(typeDeclare);
  }

  for (const variable of Object.values(file.var || {})) {
    walkVariable(variable);
  }
}

export interface CentralMasterOptions extends AnalyzeProjectOptions {
  srcDir: string;
  cacheData?: JsonData;
}

export class CentralMaster {
  private readonly srcDir: string;
  private readonly options: CentralMasterOptions;

  constructor(options: CentralMasterOptions) {
    this.srcDir = options.srcDir;
    this.options = options;
  }

  private mergePackageGraphs(
    summaries: PackageAnalysisSummary[],
    packageDirById: Map<string, string>,
  ) {
    const merged: JsonData = {
      src: this.srcDir,
      files: {},
      edges: [],
      resolve: [],
    };

    for (const summary of summaries) {
      const packageDir =
        packageDirById.get(summary.packageId) || summary.srcDir;
      const remapContext = buildPackageGraphRemapContext(
        this.srcDir,
        packageDir,
        summary,
      );
      const globalReplacements = sortReplacements(
        Array.from(remapContext.globalIdMap.entries()).map(([from, to]) => ({
          from,
          to,
        })),
      );

      for (const file of Object.values(summary.graph.files)) {
        const mergedKey =
          remapContext.canonicalPathByFile.get(file.path) || file.path;
        const fileReplacements =
          remapContext.fileReplacementsByPath.get(file.path) || [];
        merged.files[mergedKey] = remapJsonValue(cloneFile(file), [
          ...fileReplacements,
          ...globalReplacements,
        ]);
      }

      merged.edges.push(
        ...summary.graph.edges.map((edge) => ({
          ...edge,
          from: remapContext.globalIdMap.get(edge.from) || edge.from,
          to: remapContext.globalIdMap.get(edge.to) || edge.to,
        })),
      );
      merged.resolve.push(
        ...summary.graph.resolve.map((task) =>
          remapResolveTask(task, remapContext),
        ),
      );
    }

    return merged;
  }

  public async analyzeWorkspace(): Promise<JsonData> {
    const rootDir = resolvePath(this.srcDir).replace(/[/\\]$/, "");
    const discoveredPackages = (await discoverWorkspacePackages(rootDir)).sort(
      (a, b) => (a.path || "").localeCompare(b.path || ""),
    );

    const normalize = (p: string) => {
      if (!p) {
        console.warn("normalize called with undefined/empty path");
        return "";
      }
      try {
        // Use realpath if possible to resolve symlinks
        return fs.realpathSync(resolvePath(rootDir, p)).replace(/[/\\]$/, "");
      } catch {
        return resolvePath(rootDir, p).replace(/[/\\]$/, "");
      }
    };

    const analysisPaths = this.options.analysisPaths?.map(normalize);

    const packages = analysisPaths
      ? discoveredPackages.filter((p) => {
          const normalizedP = normalize(p.path);
          // Case-insensitive check for macOS/Windows
          return analysisPaths!.some(
            (ap) => ap.toLowerCase() === normalizedP.toLowerCase(),
          );
        })
      : discoveredPackages;

    if (packages.length === 0) {
      console.warn(
        `No workspace packages matching [${
          this.options.analysisPaths?.join(", ") || ""
        }] found in ${rootDir}. ` +
          `Discovered: [${discoveredPackages
            .map((p) => p.path)
            .join(", ")}]. ` +
          `Falling back to single package analysis.`,
      );
      const packageJson = new PackageJson(rootDir);
      const sqlite = this.options.sqlitePath
        ? new SqliteDB(this.options.sqlitePath)
        : undefined;
      try {
        const master = new PackageMaster({
          srcDir: rootDir,
          viteConfigPath: getViteConfig(rootDir),
          files: getFiles(rootDir, this.options.ignorePatterns || []),
          packageJson,
          cacheData: this.options.cacheData,
          sqlite,
          threads: this.options.fileWorkerThreads,
        });
        const summary = await master.analyzePackage();
        return summary.graph;
      } finally {
        sqlite?.close();
      }
    }

    const packageDbDir =
      this.options.packageDbDir || path.join(rootDir, ".nexiq", "packages");
    const centralDbPath =
      this.options.sqlitePath ||
      this.options.centralSqlitePath ||
      path.join(rootDir, ".nexiq", "workspace.sqlite");

    const workspaceDb = new WorkspaceSqliteDB(centralDbPath);
    const runId = getWorkspaceRunId(rootDir);
    const summaries: (PackageAnalysisSummary & { dbPath: string })[] = [];
    const packageDirById = new Map<string, string>();
    const packageByName = new Map<
      string,
      {
        packageId: string;
        handoff: WorkspaceAnalysisHandoff;
        srcDir: string;
        remapContext?: PackageGraphRemapContext;
      }
    >();
    const workspaceScopes = getWorkspaceScopes(packages.map((pkg) => pkg.name));
    const packageConcurrency =
      this.options.packageConcurrency ||
      Math.max(1, Math.floor(os.cpus().length / 2));
    const effectiveFileWorkerThreads = getEffectiveFileWorkerThreads(
      this.options.fileWorkerThreads,
      packageConcurrency,
    );

    workspaceDb.beginWorkspaceRun({
      id: runId,
      root_dir: rootDir,
      status: "running",
      started_at: new Date().toISOString(),
    });

    try {
      await runWithConcurrency(packages, packageConcurrency, async (pkg) => {
        const packageJson = new PackageJson(pkg.path);
        const dbPath = getPackageDbPath(packageDbDir, pkg.path);
        const sqlite = new SqliteDB(dbPath);
        try {
          const master = new PackageMaster({
            srcDir: pkg.path,
            viteConfigPath: getViteConfig(pkg.path),
            files: getFiles(pkg.path, this.options.ignorePatterns || []),
            packageJson,
            cacheData: undefined,
            sqlite,
            threads: effectiveFileWorkerThreads,
          });
          const summary = await master.analyzePackage();
          summaries.push({
            ...summary,
            dbPath,
          });
          packageDirById.set(summary.packageId, pkg.path);
          packageByName.set(summary.packageName, {
            packageId: summary.packageId,
            handoff: summary.workspaceHandoff,
            srcDir: pkg.path,
          });
        } finally {
          sqlite.close();
        }
      });

      // Sequential database updates to avoid better-sqlite3 transaction conflicts
      for (const summary of summaries) {
        const pkgPath = packageDirById.get(summary.packageId)!;
        const workspacePackage: WorkspacePackageRow = {
          package_id: summary.packageId,
          name: summary.packageName,
          path: pkgPath,
          db_path: summary.dbPath,
          version: null,
        };
        const originalPkg = packages.find((p) => p.path === pkgPath);
        if (originalPkg?.version) {
          workspacePackage.version = originalPkg.version;
        }

        try {
          workspaceDb.db.transaction(() => {
            workspaceDb.upsertWorkspacePackage(workspacePackage);
            workspaceDb.clearPackageDependencies(summary.packageId);
            for (const dep of summary.workspaceHandoff.dependencies) {
              workspaceDb.insertPackageDependency({
                package_id: summary.packageId,
                dependency_name: dep.name,
                dependency_version: dep.version,
                is_dev: dep.isDev,
              });
            }
          })();
        } catch (err: unknown) {
          console.error(
            `Error updating workspace DB for package ${summary.packageId}:`,
            err,
          );
          throw err;
        }

        workspaceDb.insertPackageRunSummary({
          id: `${runId}:${summary.packageId}`,
          workspace_run_id: runId,
          package_id: summary.packageId,
          analysis_run_id: summary.runId,
          status:
            summary.filesFailed > 0 || summary.resolveErrors > 0
              ? "completed_with_errors"
              : "completed",
          files_total: summary.filesTotal,
          files_succeeded: summary.filesSucceeded,
          files_failed: summary.filesFailed,
          resolve_errors: summary.resolveErrors,
        });

        for (const pkgExport of summary.workspaceHandoff.exports) {
          workspaceDb.insertPackageExport({
            id: `${runId}:${pkgExport.packageId}:${pkgExport.filePath}:${pkgExport.exportName}:${pkgExport.exportType}`,
            run_id: runId,
            package_id: pkgExport.packageId,
            package_name: pkgExport.packageName,
            file_path: pkgExport.filePath,
            export_name: pkgExport.exportName,
            export_type: pkgExport.exportType,
            export_kind: pkgExport.exportKind,
            export_id: pkgExport.exportId,
            is_default: pkgExport.isDefault,
          });
        }

        for (const externalImport of summary.workspaceHandoff.externalImports) {
          workspaceDb.insertDeferredExternalImport({
            id: `${runId}:${externalImport.packageId}:${externalImport.filePath}:${externalImport.localName}:${externalImport.sourceModule}`,
            run_id: runId,
            package_id: externalImport.packageId,
            package_name: externalImport.packageName,
            file_path: externalImport.filePath,
            source_module: externalImport.sourceModule,
            source_package_name: externalImport.sourcePackageName,
            source_subpath: externalImport.sourceSubpath,
            local_name: externalImport.localName,
            imported_name: externalImport.importedName,
            import_type: externalImport.importType,
            import_kind: externalImport.importKind,
          });
        }
      }

      const merged = this.mergePackageGraphs(summaries, packageDirById);
      for (const summary of summaries) {
        const pkg = packageByName.get(summary.packageName);
        const packageDir =
          packageDirById.get(summary.packageId) || summary.srcDir;
        if (pkg) {
          pkg.remapContext = buildPackageGraphRemapContext(
            rootDir,
            packageDir,
            summary,
          );
        }
      }
      const crossPackageErrorsByPackage = new Map<string, number>();
      const canonicalImportResolutions = new Map<string, string>();
      const namespaceBindings = new Map<string, NamespaceBinding>();
      const canonicalFileOwners = new Map<
        string,
        { packageId: string; packageName: string }
      >();
      let totalCrossPackageErrors = 0;
      const totalPackageErrors = summaries.reduce(
        (count, summary) => count + summary.filesFailed + summary.resolveErrors,
        0,
      );

      for (const summary of summaries) {
        const pkg = packageByName.get(summary.packageName);
        for (const file of Object.values(summary.graph.files)) {
          const canonicalFilePath =
            pkg?.remapContext?.canonicalPathByFile.get(file.path) || file.path;
          canonicalFileOwners.set(canonicalFilePath, {
            packageId: summary.packageId,
            packageName: summary.packageName,
          });
        }
      }

      for (const summary of summaries) {
        for (const externalImport of summary.workspaceHandoff.externalImports) {
          const targetPackageName = getPackageNameFromModule(
            externalImport.sourceModule,
          );
          const targetPackage = packageByName.get(targetPackageName);
          const sourceRemapContext = packageByName.get(
            summary.packageName,
          )?.remapContext;
          const isWorkspaceCandidate =
            targetPackage != null ||
            (targetPackageName.startsWith("@") &&
              workspaceScopes.has(targetPackageName.split("/")[0] || ""));
          if (!isWorkspaceCandidate) {
            continue;
          }
          if (externalImport.importType === "namespace") {
            const canonicalSourceImportId =
              sourceRemapContext?.globalIdMap.get(
                getImportSymbolId(
                  externalImport.filePath,
                  externalImport.localName,
                ),
              ) ||
              getImportSymbolId(
                externalImport.filePath,
                externalImport.localName,
              );
            namespaceBindings.set(canonicalSourceImportId, {
              externalImport,
              targetPackageName,
            });
            continue;
          }
          if (!targetPackage) {
            const message = `Failed to resolve workspace package import ${externalImport.sourceModule}`;
            workspaceDb.insertCrossPackageResolveError({
              id: getCrossPackageErrorId(runId, externalImport),
              run_id: runId,
              from_package_id: summary.packageId,
              file_path: externalImport.filePath,
              source_name: externalImport.localName,
              source_module: externalImport.sourceModule,
              relation_kind: "import",
              message,
            });
            merged.resolve.push(
              sourceRemapContext
                ? remapResolveTask(
                    createCrossPackageResolveTask(externalImport, message),
                    sourceRemapContext,
                  )
                : createCrossPackageResolveTask(externalImport, message),
            );
            crossPackageErrorsByPackage.set(
              summary.packageId,
              (crossPackageErrorsByPackage.get(summary.packageId) || 0) + 1,
            );
            totalCrossPackageErrors++;
            continue;
          }

          const resolution = resolveImportAgainstExports(
            externalImport,
            targetPackage.handoff.exports,
            targetPackage.handoff.entryCandidates,
          );

          if (!resolution.relation) {
            const message =
              resolution.error ||
              `Failed to resolve import ${externalImport.sourceModule}`;
            workspaceDb.insertCrossPackageResolveError({
              id: getCrossPackageErrorId(runId, externalImport),
              run_id: runId,
              from_package_id: summary.packageId,
              file_path: externalImport.filePath,
              source_name: externalImport.localName,
              source_module: externalImport.sourceModule,
              relation_kind: "import",
              message,
            });
            merged.resolve.push(
              sourceRemapContext
                ? remapResolveTask(
                    createCrossPackageResolveTask(externalImport, message),
                    sourceRemapContext,
                  )
                : createCrossPackageResolveTask(externalImport, message),
            );
            crossPackageErrorsByPackage.set(
              summary.packageId,
              (crossPackageErrorsByPackage.get(summary.packageId) || 0) + 1,
            );
            totalCrossPackageErrors++;
            continue;
          }

          const relation = resolution.relation;
          workspaceDb.insertPackageRelation({
            from_package_id: relation.fromPackageId,
            to_package_id: relation.toPackageId,
            relation_kind: relation.relationKind,
            source_file_path: relation.sourceFilePath,
            target_file_path: relation.targetFilePath,
            source_symbol: relation.sourceLocalName,
            target_symbol: relation.targetExportName,
            run_id: runId,
          });

          const targetRemapContext =
            packageByName.get(targetPackageName)?.remapContext;
          const canonicalSourceImportId =
            sourceRemapContext?.globalIdMap.get(relation.sourceImportId) ||
            relation.sourceImportId;
          const canonicalTargetExportId =
            targetRemapContext?.globalIdMap.get(relation.targetExportId) ||
            relation.targetExportId;
          const canonicalSourceFilePath =
            sourceRemapContext?.canonicalPathByFile.get(
              relation.sourceFilePath,
            ) || relation.sourceFilePath;
          const importResolution: CanonicalImportResolution = {
            canonicalFilePath: canonicalSourceFilePath,
            localName: relation.sourceLocalName,
            sourceImportId: canonicalSourceImportId,
            targetExportId: canonicalTargetExportId,
          };
          canonicalImportResolutions.set(
            `${importResolution.canonicalFilePath}:${importResolution.localName}`,
            importResolution.targetExportId,
          );
          canonicalImportResolutions.set(
            importResolution.sourceImportId,
            importResolution.targetExportId,
          );
          merged.edges.push({
            from: canonicalTargetExportId,
            to: canonicalSourceImportId,
            label: "import",
          });
        }
      }

      const existingEdgeKeys = new Set(
        merged.edges.map((edge) => edgeKey(edge)),
      );
      for (const file of Object.values(merged.files)) {
        const owner = canonicalFileOwners.get(file.path);
        if (!owner) {
          continue;
        }

        const seenTypeErrors = new Set<string>();
        rewriteFileEntityData(file, {
          resolvedImportTargets: canonicalImportResolutions,
          namespaceBindings,
          packageByName,
          workspaceScopes,
          sourceFilePath: file.path,
          sourcePackageId: owner.packageId,
          sourcePackageName: owner.packageName,
          onUnresolved: () => {},
        });

        rewriteFileTypeRefTargets(file, {
          resolvedImportTargets: canonicalImportResolutions,
          namespaceBindings,
          packageByName,
          workspaceScopes,
          sourceFilePath: file.path,
          sourcePackageId: owner.packageId,
          sourcePackageName: owner.packageName,
          onUnresolved: (sourceModule, exportName, message) => {
            const key = `${file.path}:${sourceModule}:${exportName}`;
            if (seenTypeErrors.has(key)) {
              return;
            }
            seenTypeErrors.add(key);

            workspaceDb.insertCrossPackageResolveError({
              id: `${runId}:${owner.packageId}:${file.path}:${exportName}:${sourceModule}:type`,
              run_id: runId,
              from_package_id: owner.packageId,
              file_path: file.path,
              source_name: exportName,
              source_module: sourceModule,
              relation_kind: "import",
              message,
            });
            merged.resolve.push({
              type: "crossPackageImport",
              fileName: file.path,
              source: sourceModule,
              localName: exportName,
              importedName: exportName,
              importType: "type",
              importKind: "type",
              message,
            });
            crossPackageErrorsByPackage.set(
              owner.packageId,
              (crossPackageErrorsByPackage.get(owner.packageId) || 0) + 1,
            );
            totalCrossPackageErrors++;
          },
        });
      }
      for (const summary of summaries) {
        const pkg = packageByName.get(summary.packageName);
        if (!pkg || !pkg.remapContext) {
          continue;
        }

        for (const file of Object.values(summary.graph.files)) {
          const canonicalFilePath =
            pkg.remapContext.canonicalPathByFile.get(file.path) || file.path;
          for (const edge of collectCrossPackageUsageEdges(
            file,
            canonicalFilePath,
            canonicalImportResolutions,
          )) {
            const canonicalEdge = {
              ...edge,
              from: pkg.remapContext.globalIdMap.get(edge.from) || edge.from,
              to: pkg.remapContext.globalIdMap.get(edge.to) || edge.to,
            };

            const key = edgeKey(canonicalEdge);
            if (!existingEdgeKeys.has(key)) {
              existingEdgeKeys.add(key);
              merged.edges.push(canonicalEdge);
            }
          }
        }
      }

      for (const summary of summaries) {
        const summaryId = `${runId}:${summary.packageId}`;
        const hasErrors =
          summary.filesFailed > 0 ||
          summary.resolveErrors > 0 ||
          (crossPackageErrorsByPackage.get(summary.packageId) || 0) > 0;
        workspaceDb.updatePackageRunSummaryStatus(
          summaryId,
          hasErrors ? "completed_with_errors" : "completed",
        );
      }

      workspaceDb.finishWorkspaceRun(
        runId,
        totalCrossPackageErrors > 0 || totalPackageErrors > 0
          ? "completed_with_errors"
          : "completed",
      );
      return merged;
    } catch (err: unknown) {
      workspaceDb.finishWorkspaceRun(runId, "failed");
      throw err;
    } finally {
      workspaceDb.close();
    }
  }
}
