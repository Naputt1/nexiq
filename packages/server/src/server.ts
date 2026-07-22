import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import {
  ProjectManager,
  SymbolInfo,
  type SymbolSearchResult,
} from "./projectManager.js";
import {
  getDisplayName,
  type BackendRequestMap,
  type BackendMessageType,
} from "@nexiq/shared";
import { WebSocketServer, WebSocket } from "ws";
import { minimatch } from "minimatch";
import path from "node:path";

export interface GetSymbolInfoArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  strict?: boolean;
  props?: boolean;
  usages?: boolean;
  loc?: boolean;
  contextLines?: number;
  exclude?: string[];
  fields?: string[];
}

export interface GetFieldAccessesArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  fieldPath: string;
  contextLines?: number;
  fields?: string[];
}

export interface FindFilesArgs {
  projectPath: string;
  subProject?: string;
  pattern: string;
  fields?: string[];
}

export interface GetFileImportsArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  fields?: string[];
}

export interface GetProjectTreeArgs {
  projectPath: string;
  subProject?: string;
  maxDepth?: number;
  fields?: string[];
}

export interface GetComponentHierarchyArgs {
  projectPath: string;
  subProject?: string;
  componentName: string;
  depth?: number;
  fields?: string[];
}

export interface GetSymbolLocationArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  fields?: string[];
}

export interface GetSymbolContentArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  contextLines?: number;
  fields?: string[];
}

export interface AddLabelArgs {
  projectPath: string;
  subProject?: string;
  id: string;
  label: string;
}

export interface ListLabelsArgs {
  projectPath: string;
  subProject?: string;
}

export interface SearchByLabelArgs {
  projectPath: string;
  subProject?: string;
  label: string;
}

export interface ListDirectoryArgs {
  projectPath: string;
  subProject?: string;
  dirPath: string;
}

export interface GetFileOutlineArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  fields?: string[];
}

export interface ReadFileArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
}

export interface GrepSearchArgs {
  projectPath: string;
  subProject?: string;
  pattern: string;
  exclude?: string[];
}

export interface RunShellCommandArgs {
  projectPath: string;
  subProject?: string;
  command: string;
}

export interface ListFilesArgs {
  projectPath: string;
  subProject?: string;
  fields?: string[];
  exclude?: string[];
}

export interface GetPropDefinitionsArgs {
  projectPath: string;
  subProject?: string;
  componentName: string;
  fields?: string[];
}

export interface WriteFileArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  content: string;
}

export interface ReplaceFileContentArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  oldString: string;
  newString: string;
}

export interface MultiReplaceFileContentArgs {
  projectPath: string;
  subProject?: string;
  filePath: string;
  replacements: { oldString: string; newString: string }[];
}

export interface ToolArgsMap {
  get_symbol_info: GetSymbolInfoArgs;
  get_field_accesses: GetFieldAccessesArgs;
  get_prop_definitions: GetPropDefinitionsArgs;
  find_files: FindFilesArgs;
  get_file_imports: GetFileImportsArgs;
  get_project_tree: GetProjectTreeArgs;
  list_files: ListFilesArgs;
  get_component_hierarchy: GetComponentHierarchyArgs;
  get_symbol_location: GetSymbolLocationArgs;
  get_symbol_content: GetSymbolContentArgs;
  add_label: AddLabelArgs;
  list_labels: ListLabelsArgs;
  search_by_label: SearchByLabelArgs;
  list_directory: ListDirectoryArgs;
  get_file_outline: GetFileOutlineArgs;
  read_file: ReadFileArgs;
  grep_search: GrepSearchArgs;
  run_shell_command: RunShellCommandArgs;
  write_file: WriteFileArgs;
  replace_file_content: ReplaceFileContentArgs;
  multi_replace_file_content: MultiReplaceFileContentArgs;
}

type KnownToolCall = {
  [K in keyof ToolArgsMap]: {
    name: K;
    args: ToolArgsMap[K];
  };
}[keyof ToolArgsMap];

type UnknownToolCall = {
  name: Exclude<string, keyof ToolArgsMap>;
  args: Record<string, unknown>;
};

type ToolCall = KnownToolCall | UnknownToolCall;

export type SymbolInfoResult =
  | {
      type: "definition";
      kind: string;
      name: string;
      file: string;
      loc: { line: number; column: number };
      props?: unknown[];
      in?: string;
    }
  | {
      type: "usage";
      kind: string;
      name: string;
      in: string;
      file: string;
      loc: { line: number; column: number };
    };

type WsMessage = {
  [K in BackendMessageType]: {
    type: K;
    payload: BackendRequestMap[K]["payload"];
    requestId?: string;
  };
}[BackendMessageType];

const DEFAULT_EXCLUDES = [
  "**/node_modules/**",
  "**/dist/**",
  "**/build/**",
  "**/test/**",
  "**/__tests__/**",
  "**/*.test.*",
  "**/__snapshots__/**",
  "**/.nexiq/**",
];

export class BackendServer {
  private mcpServer: Server;
  private wss: WebSocketServer | null = null;
  private uiConnections = 0;
  private mcpConnected = false;
  private exitTimeout: NodeJS.Timeout | null = null;

  constructor(
    private projectManager: ProjectManager,
    private port: number = 3030,
  ) {
    this.mcpServer = new Server(
      {
        name: "nexiq-mcp",
        version: "0.2.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.setupMcpHandlers();
  }

  private setupMcpHandlers() {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      const baseTools = [
        {
          name: "get_symbol_info",
          description: "Get symbol definitions and usages.",
          outputSchema: {
            type: "object",
            properties: {
              definitions: { type: "array", items: { type: "object" } },
              externalUsages: { type: "array", items: { type: "object" } },
            },
          },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              query: { type: "string", description: "Symbol name" },
              strict: { type: "boolean" },
              props: { type: "boolean" },
              usages: { type: "boolean" },
              contextLines: { type: "number", description: "Context lines around usages" },
              exclude: { type: "array", items: { type: "string" } },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_field_accesses",
          description: "Find field accesses on a hook/component.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              query: { type: "string", description: "Hook/component name" },
              fieldPath: { type: "string", description: "Dot-separated field path" },
              contextLines: { type: "number" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "query", "fieldPath"],
          },
        },
        {
          name: "get_prop_definitions",
          description: "Get component prop definitions.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              componentName: { type: "string" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "componentName"],
          },
        },
        {
          name: "find_files",
          description: "Find files by glob pattern.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              pattern: { type: "string", description: "Glob or filename pattern" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "pattern"],
          },
        },
        {
          name: "get_file_imports",
          description: "Get a file's imports.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "get_project_tree",
          description: "Get project directory tree.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              maxDepth: { type: "number" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "list_files",
          description: "List project files.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              fields: { type: "array", items: { type: "string" } },
              exclude: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "get_component_hierarchy",
          description: "Get component render hierarchy.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              componentName: { type: "string" },
              depth: { type: "number" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "componentName"],
          },
        },
        {
          name: "get_symbol_location",
          description: "Get symbol file and position.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              query: { type: "string", description: "Symbol name" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_symbol_content",
          description: "Get symbol source code.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              query: { type: "string", description: "Symbol name" },
              contextLines: { type: "number" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "add_label",
          description: "Tag a file or entity.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              id: { type: "string", description: "File path or graph ID" },
              label: { type: "string" },
            },
            required: ["projectPath", "id", "label"],
          },
        },
        {
          name: "list_labels",
          description: "List all labels.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "search_by_label",
          description: "Find entities by label.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              label: { type: "string" },
            },
            required: ["projectPath", "label"],
          },
        },
        {
          name: "list_directory",
          description: "List files in a folder.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              dirPath: { type: "string", description: "Relative path from project root" },
            },
            required: ["projectPath", "dirPath"],
          },
        },
        {
          name: "get_file_outline",
          description: "Get structured file outline.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              fields: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "read_file",
          description: "Read file content with optional range.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              startLine: { type: "number" },
              endLine: { type: "number" },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "grep_search",
          description: "Search files by regex pattern.",
          outputSchema: { type: "object", properties: { items: { type: "array", items: { type: "object" } } } },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              pattern: { type: "string", description: "Regex pattern" },
              exclude: { type: "array", items: { type: "string" } },
            },
            required: ["projectPath", "pattern"],
          },
        },
        {
          name: "run_shell_command",
          description: "Execute a shell command.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              command: { type: "string" },
            },
            required: ["projectPath", "command"],
          },
        },
        {
          name: "write_file",
          description: "Write content to a file.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              content: { type: "string" },
            },
            required: ["projectPath", "filePath", "content"],
          },
        },
        {
          name: "replace_file_content",
          description: "Replace text in a file.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              oldString: { type: "string" },
              newString: { type: "string" },
            },
            required: ["projectPath", "filePath", "oldString", "newString"],
          },
        },
        {
          name: "multi_replace_file_content",
          description: "Multiple replacements in one file.",
          outputSchema: { type: "object" },
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
              replacements: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    oldString: { type: "string" },
                    newString: { type: "string" },
                  },
                  required: ["oldString", "newString"],
                },
              },
            },
            required: ["projectPath", "filePath", "replacements"],
          },
        },
      ];

      const extensions = this.projectManager.getAllExtensions();
      const extensionTools = extensions.flatMap((ext) =>
        (ext.mcpTools || []).map((tool) => ({
          name: `${ext.id}_${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
          ...(tool.outputSchema ? { outputSchema: tool.outputSchema } : {}),
        })),
      );

      return {
        tools: [...baseTools, ...extensionTools],
      };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        const result = await this.handleCallTool({
          name: name as keyof ToolArgsMap,
          args: args as unknown as ToolArgsMap[keyof ToolArgsMap],
        } as ToolCall);
        return result;
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`Tool "${name}" failed:`, errorMessage);
        return {
          isError: true,
          content: [{ type: "text", text: errorMessage }],
        };
      }
    });
  }

  public async handleCallTool(toolCall: ToolCall) {
    // Handle extension tools
    const extensions = this.projectManager.getAllExtensions();
    for (const ext of extensions) {
      if (toolCall.name.startsWith(`${ext.id}_`)) {
        const toolName = toolCall.name.replace(`${ext.id}_`, "");
        const tool = (ext.mcpTools || []).find((t) => t.name === toolName);
        if (tool) {
          const result = await tool.handler({
            ...toolCall.args,
            projectManager: this.projectManager,
          });
          return this.toStructuredResult(result);
        }
      }
    }

    return await this.handleKnownToolCall(toolCall as KnownToolCall);
  }

  private async handleKnownToolCall(knownCall: KnownToolCall) {
    switch (knownCall.name) {
      case "get_symbol_info": {
        const {
          projectPath,
          subProject,
          query,
          strict,
          props,
          usages,
          contextLines,
          exclude,
          fields,
        } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);

        const includeContext = (contextLines ?? 0) > 0;

        // When contextLines is set, return flat usage results with source context
        if (includeContext) {
          const results = await this.projectManager.getSymbolUsagesWithContext(
            resolvedPath,
            query,
            subProject,
            strict !== false,
            contextLines ?? 2,
            exclude || DEFAULT_EXCLUDES,
          );
          return this.toStructuredResult(results);
        }

        const includeUsage = usages === true;
        const results = await this.projectManager.findSymbol(
          resolvedPath,
          query,
          subProject,
          strict !== false,
          props === true,
          includeUsage,
          exclude || DEFAULT_EXCLUDES,
        );

        const processItem = (item: SymbolSearchResult) => {
          const processed = { ...item };
          if (processed.props) {
            processed.props = this.sanitizeProps(processed.props);
          }
          if (processed.usages) {
            processed.usages = processed.usages.map((u) => {
              const { loc: _loc, ...rest } = u;
              return rest as SymbolSearchResult;
            });
          }

          return processed;
        };

        const result: SymbolInfo = {
          definitions: results.definitions.map((d) => processItem(d)),
        };

        if (includeUsage) {
          result.externalUsages = (results.externalUsages ?? []).map((u) => {
            const { loc: _loc, ...rest } = u;
            return rest as SymbolSearchResult;
          });
        }

        // Map 'usages' field request to 'definitions' (usages are nested inside definitions)
        const effectiveFields = fields?.map((f) =>
          f === "usages" ? "definitions" : f,
        );
        return this.toStructuredResult(this.filterFields(result, effectiveFields));
      }
      case "get_field_accesses": {
        const {
          projectPath,
          subProject,
          query,
          fieldPath,
          contextLines,
          fields,
        } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getFieldAccesses(
          resolvedPath,
          query,
          fieldPath,
          subProject,
          contextLines ?? 2,
        );

        return this.toStructuredResult(this.filterFields(results, fields));
      }
      case "get_prop_definitions": {
        const { projectPath, subProject, componentName, fields } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getPropDefinitions(
          resolvedPath,
          componentName,
          subProject,
        );

        const sanitized = results.map((r) => ({
          ...r,
          props: this.sanitizeProps(r.props || []),
        }));

        return this.toStructuredResult(this.filterFields(sanitized, fields));
      }
      case "find_files": {
        const { projectPath, subProject, pattern, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.findFiles(
          resolvedPath,
          pattern,
          subProject,
        );

        return this.toStructuredResult(this.filterFields(results, fields));
      }

      case "get_file_imports": {
        const { projectPath, subProject, filePath, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getFileImports(
          resolvedPath,
          filePath,
          subProject,
        );

        return this.toStructuredResult(this.filterFields(results, fields));
      }

      case "get_project_tree": {
        const { projectPath, subProject, maxDepth, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getProjectTree(
          resolvedPath,
          subProject,
          maxDepth,
        );

        return this.toStructuredResult(this.filterFields(results, fields));
      }

      case "list_files": {
        const { projectPath, subProject, exclude, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const project = await this.projectManager.openProject(
          resolvedPath,
          subProject,
        );

        const excludePatterns = exclude || DEFAULT_EXCLUDES;
        const isExcluded = (filePath: string) => {
          return excludePatterns.some(
            (pattern) =>
              minimatch(filePath, pattern, { dot: true, nocase: true }) ||
              minimatch(path.basename(filePath), pattern, {
                dot: true,
                nocase: true,
              }),
          );
        };

        const rows = project.db
          ? (project
              .db!.db.prepare("SELECT path FROM files ORDER BY path")
              .all() as { path: string }[])
          : [];
        const allPaths =
          rows.length > 0
            ? rows.map((r) => r.path)
            : Object.keys(project.graph?.files || {});
        const filteredPaths = allPaths.filter((p) => !isExcluded(p));
        const totalFiles = filteredPaths.length;
        const MAX_FILES = 50;
        const displayedPaths = filteredPaths.slice(0, MAX_FILES);

        let fileSummary: {
          path: string;
          exports?: { name: string; kind: string }[];
        }[];

        if (totalFiles > MAX_FILES) {
          fileSummary = displayedPaths.map((path) => ({ path }));
        } else {
          fileSummary = displayedPaths.map((path) => {
            const exportRows = project.db
              ? (project
                  .db!.db.prepare(
                    `SELECT e.name, e.kind
                     FROM entities e
                     JOIN scopes s ON e.scope_id = s.id
                     JOIN files f ON s.file_id = f.id
                     WHERE f.path = ? AND e.kind IN ('component', 'function', 'hook', 'class') AND e.name IS NOT NULL
                     ORDER BY e.line ASC`,
                  )
                  .all(path) as { name: string; kind: string }[])
              : [];
            if (exportRows.length > 0) {
              return {
                path,
                exports: exportRows
                  .filter(
                    (r) => !getDisplayName(r.name).startsWith("jsx@"),
                  )
                  .map((r) => ({
                    name: getDisplayName(r.name),
                    kind: r.kind,
                  })),
              };
            }
            // Fallback: read from graph
            const file = project.graph?.files?.[path];
            const graphExports = file
              ? Object.values(file.var || {})
                  .filter((v) => !getDisplayName(v.name).startsWith("jsx@"))
                  .map((v) => ({
                    name: getDisplayName(v.name),
                    kind: v.kind,
                  }))
              : undefined;
            return { path, exports: graphExports };
          });
        }

        const listResult = {
          totalFiles,
          displayedCount: fileSummary.length,
          files: this.filterFields(fileSummary, fields),
          hint:
            totalFiles > MAX_FILES
              ? `Project has ${totalFiles} files. Showing first ${MAX_FILES}. Use 'list_directory' to explore folders or 'find_files' to search for specific files.`
              : undefined,
        };
        return this.toStructuredResult(listResult);
      }

      case "get_component_hierarchy": {
        const { projectPath, subProject, componentName, depth, fields } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getComponentHierarchy(
          resolvedPath,
          componentName,
          subProject,
          depth,
        );
        return this.toStructuredResult(this.stripIds(this.filterFields(result, fields)));
      }

      case "get_symbol_location": {
        const { projectPath, subProject, query, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getSymbolLocation(
          resolvedPath,
          query,
          subProject,
        );
        return this.toStructuredResult(this.stripIds(this.filterFields(result, fields)));
      }

      case "get_symbol_content": {
        const { projectPath, subProject, query, contextLines, fields } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getSymbolContent(
          resolvedPath,
          query,
          subProject,
          contextLines ?? 5,
        );
        return this.toStructuredResult(this.stripIds(this.filterFields(result, fields)));
      }

      case "add_label": {
        const { projectPath, subProject, id, label } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.addLabel(
          resolvedPath,
          id,
          label,
          subProject,
        );
        return this.toStructuredResult(result);
      }

      case "list_labels": {
        const { projectPath, subProject } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getLabels(
          resolvedPath,
          subProject,
        );
        return this.toStructuredResult(result);
      }

      case "search_by_label": {
        const { projectPath, subProject, label } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.findEntitiesByLabel(
          resolvedPath,
          label,
          subProject,
        );
        return this.toStructuredResult(result);
      }

      case "list_directory": {
        const { projectPath, subProject, dirPath } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.listDirectory(
          resolvedPath,
          dirPath,
          subProject,
        );
        return this.toStructuredResult(result);
      }

      case "get_file_outline": {
        const { projectPath, subProject, filePath, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getFileOutline(
          resolvedPath,
          filePath,
          subProject,
        );
        return this.toStructuredResult(this.stripIds(this.filterFields(result, fields)));
      }

      case "read_file": {
        const { projectPath, subProject, filePath, startLine, endLine } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.readFile(
          resolvedPath,
          filePath,
          subProject,
          startLine,
          endLine,
        );
        return {
          content: [{ type: "text", text: result }],
          structuredContent: { content: result },
        };
      }

      case "grep_search": {
        const { projectPath, subProject, pattern, exclude } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.grepSearch(
          resolvedPath,
          pattern,
          subProject,
          exclude || DEFAULT_EXCLUDES,
        );
        return this.toStructuredResult(result);
      }

      case "run_shell_command": {
        const { projectPath, subProject, command } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.runShellCommand(
          resolvedPath,
          command,
          subProject,
        );
        return this.toStructuredResult(result);
      }

      case "write_file": {
        const { projectPath, subProject, filePath, content } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const success = await this.projectManager.writeFile(
          resolvedPath,
          filePath,
          content,
        );
        return this.toStructuredResult({ success });
      }

      case "replace_file_content": {
        const { projectPath, subProject, filePath, oldString, newString } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const success = await this.projectManager.replaceFileContent(
          resolvedPath,
          filePath,
          oldString,
          newString,
        );
        return this.toStructuredResult({ success });
      }

      case "multi_replace_file_content": {
        const { projectPath, subProject, filePath, replacements } =
          knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const success = await this.projectManager.multiReplaceFileContent(
          resolvedPath,
          filePath,
          replacements,
        );
        return this.toStructuredResult({ success });
      }

      default:
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        throw new Error(`Unknown tool: ${knownCall.name}`);
    }
  }

  private toStructuredResult(data: unknown): {
    content: { type: "text"; text: string }[];
    structuredContent: Record<string, unknown>;
  } {
    const obj = Array.isArray(data) ? { items: data } : (data as Record<string, unknown>);
    return {
      content: [{ type: "text", text: JSON.stringify(data) }],
      structuredContent: obj,
    };
  }

  private sanitizeProps(props: unknown[]): unknown[] {
    if (!props) return props;
    return props.map((prop) => {
      const p = prop as Record<string, unknown>;
      const cleaned: Record<string, unknown> = {};
      if (p.name !== undefined) cleaned.name = p.name;
      if (p.kind !== undefined) cleaned.kind = p.kind;
      if (p.type !== undefined && p.type !== "any") cleaned.type = p.type;
      if (p.defaultValue !== undefined) cleaned.defaultValue = p.defaultValue;
      if (p.props !== undefined) {
        cleaned.props = this.sanitizeProps(p.props as unknown[]);
      }
      return cleaned;
    });
  }

  private stripIds<T>(data: T): T {
    if (!data) return data;
    if (Array.isArray(data)) {
      return data.map((item) => this.stripIds(item)) as unknown as T;
    }
    if (typeof data !== "object") return data;
    const obj = data as Record<string, unknown>;
    const { id: _, ...rest } = obj;
    for (const key of Object.keys(rest)) {
      rest[key] = this.stripIds(rest[key]);
    }
    return rest as unknown as T;
  }

  private filterFields<T>(data: T, fields?: string[]): T {
    if (!fields || !data) return data;

    if (Array.isArray(data)) {
      return data.map((item) =>
        this.filterFields(item, fields),
      ) as unknown as T;
    }

    if (typeof data !== "object") return data;

    const filtered: Record<string, unknown> = {};
    const obj = data as Record<string, unknown>;
    for (const field of fields) {
      if (field in obj) {
        filtered[field] = obj[field];
      }
    }

    if (Object.keys(filtered).length === 0) return data;
    return filtered as unknown as T;
  }

  private resolveProjectPath(
    projectPath: string,
    _subProject?: string,
  ): string {
    if (projectPath === "." || projectPath === "/" || !projectPath) {
      const projects = this.projectManager.getOpenProjectPaths();
      if (projects.length > 0) {
        // Fallback to the first project in the map if a generic path is given
        return projects[0];
      }
    }
    return projectPath;
  }

  private sendResponse<K extends BackendMessageType>(
    ws: WebSocket,
    type: string,
    payload: BackendRequestMap[K]["response"],
    requestId?: string,
  ) {
    ws.send(JSON.stringify({ type, payload, requestId }));
  }

  private sendChunkedResponse<K extends BackendMessageType>(
    ws: WebSocket,
    type: string,
    payload: BackendRequestMap[K]["response"],
    requestId?: string,
  ) {
    const data = JSON.stringify(payload);
    const CHUNK_SIZE = 1024 * 1024; // 1MB chunks

    if (data.length <= CHUNK_SIZE) {
      this.sendResponse(ws, type, payload, requestId);
      return;
    }

    const totalChunks = Math.ceil(data.length / CHUNK_SIZE);
    for (let i = 0; i < totalChunks; i++) {
      const chunk = data.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
      ws.send(
        JSON.stringify({
          type: "chunked_response",
          payload: {
            chunk,
            index: i,
            total: totalChunks,
            originalType: type,
          },
          requestId,
        }),
      );
    }
  }

  private sendError(ws: WebSocket, message: string, requestId?: string) {
    ws.send(JSON.stringify({ type: "error", payload: { message }, requestId }));
  }

  public startWebSocketServer() {
    try {
      this.wss = new WebSocketServer({
        port: this.port,
        maxPayload: 100 * 1024 * 1024, // 100MB
        perMessageDeflate: true,
      });

      this.wss.on("error", (error) => {
        const errorMessage =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`WebSocket server error: ${errorMessage}`);
        const err = error as { code?: string };
        if (err.code === "EADDRINUSE") {
          console.error(
            `Port ${this.port} is already in use. This instance will proceed without a WebSocket server.`,
          );
          this.wss = null;
        }
      });

      console.error(`React Map backend started on ws://127.0.0.1:${this.port}`);

      this.wss.on("connection", (ws) => {
        this.uiConnections++;
        console.error(
          `UI connected via WebSocket (Active: ${this.uiConnections})`,
        );
        this.checkExitCondition();

        ws.on("close", () => {
          this.uiConnections--;
          console.error(`UI disconnected (Active: ${this.uiConnections})`);
          this.checkExitCondition();
        });

        ws.on("message", async (message) => {
          let currentRequestId: string | undefined;
          try {
            const data = JSON.parse(message.toString()) as WsMessage;
            currentRequestId = data.requestId;

            console.error(
              `Received WebSocket message: ${data.type} (Request: ${data.requestId || "none"})`,
            );

            switch (data.type) {
              case "open_project": {
                const { projectPath, subProject, subProjects } = data.payload;
                const project = await this.projectManager.openProject(
                  projectPath,
                  subProject,
                  subProjects,
                );
                this.sendResponse(
                  ws,
                  "project_opened",
                  { sqlitePath: project.sqlitePath },
                  data.requestId,
                );
                break;
              }
              case "check_project_status": {
                const { projectPath } = data.payload;
                const status =
                  await this.projectManager.checkProjectStatus(projectPath);
                this.sendResponse(ws, "project_status", status, data.requestId);
                break;
              }
              case "save_project_config": {
                const { projectPath, config } = data.payload;
                const success = await this.projectManager.saveProjectConfig(
                  projectPath,
                  config,
                );
                this.sendResponse(
                  ws,
                  "config_saved",
                  { success },
                  data.requestId,
                );
                break;
              }
              case "get_project_icon": {
                const { projectPath } = data.payload;
                const icon =
                  await this.projectManager.getProjectIcon(projectPath);
                this.sendResponse(ws, "project_icon", { icon }, data.requestId);
                break;
              }
              case "git_status": {
                const { projectPath } = data.payload;
                const status = await this.projectManager.gitStatus(projectPath);
                this.sendResponse(
                  ws,
                  "git_status_data",
                  status,
                  data.requestId,
                );
                break;
              }
              case "git_log": {
                const { projectPath, options } = data.payload;
                const log = await this.projectManager.gitLog(
                  projectPath,
                  options,
                );
                this.sendResponse(ws, "git_log_data", log, data.requestId);
                break;
              }
              case "git_diff": {
                const { projectPath, options } = data.payload;
                const diff = await this.projectManager.gitDiff(
                  projectPath,
                  options,
                );
                this.sendResponse(ws, "git_diff_data", diff, data.requestId);
                break;
              }
              case "git_analyze_commit": {
                const { projectPath, commitHash, subProject } = data.payload;
                const snapshot = await this.projectManager.gitAnalyzeCommit(
                  projectPath,
                  commitHash,
                  subProject,
                );
                this.sendResponse(
                  ws,
                  "git_analyze_commit",
                  snapshot,
                  data.requestId,
                );
                break;
              }
              case "get_node_detail": {
                const { projectPath, nodeId } = data.payload;
                const detail = await this.projectManager.getNodeDetail(
                  projectPath,
                  nodeId,
                );
                this.sendResponse(ws, "node_detail", detail, data.requestId);
                break;
              }
              case "call_tool": {
                const { name, arguments: args } = data.payload;
                const result = await this.handleCallTool({
                  name: name as keyof ToolArgsMap,
                  args: args as unknown as ToolArgsMap[keyof ToolArgsMap],
                } as ToolCall);
                ws.send(
                  JSON.stringify({
                    type: "tool_result",
                    payload: result,
                    requestId: data.requestId,
                  }),
                );
                break;
              }
              case "chunked_response": {
                // Server receiving a chunked response from client is not supported
                break;
              }
              default: {
                const unknownData = data as unknown as {
                  type: string;
                  requestId?: string;
                };
                this.sendError(
                  ws,
                  `Unknown message type: ${unknownData.type}`,
                  unknownData.requestId,
                );
                break;
              }
            }
          } catch (e: unknown) {
            const errorMessage =
              e instanceof Error ? e.message : "Unknown error";
            console.error("Error handling WebSocket message", e);
            this.sendError(ws, errorMessage, currentRequestId);
          }
        });
      });
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown error";
      console.error(`Failed to start WebSocket server: ${errorMessage}`);
    }
  }

  public async startMcpServer(transport: StdioServerTransport) {
    this.mcpConnected = true;

    transport.onclose = () => {
      console.error("MCP stdio connection closed.");
      this.mcpConnected = false;
      this.checkExitCondition();
    };

    await this.mcpServer.connect(transport);
    console.error(
      `React Map MCP server running on stdio and ws://127.0.0.1:${this.port}`,
    );

    // Initial check after 10s to see if anyone connected
    setTimeout(() => this.checkExitCondition(), 10000);
  }

  private checkExitCondition() {
    if (process.env.NODE_ENV === "development") {
      return;
    }

    if (this.uiConnections === 0 && !this.mcpConnected) {
      if (!this.exitTimeout) {
        console.error(
          "No active connections (UI or MCP). Starting 10s exit countdown...",
        );
        this.exitTimeout = setTimeout(async () => {
          if (this.uiConnections === 0 && !this.mcpConnected) {
            console.error("No active connections for 10s. Self-terminating...");
            await this.projectManager.closeAll();
            process.exit(0);
          } else {
            this.exitTimeout = null;
          }
        }, 10000);
      }
    } else if (this.exitTimeout) {
      console.error("Connection restored. Cancelling exit countdown.");
      clearTimeout(this.exitTimeout);
      this.exitTimeout = null;
    }
  }

  public async stop() {
    if (this.wss) {
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
    }
    await this.mcpServer.close();
  }
}
