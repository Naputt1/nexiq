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
} from "@nexu/shared";
import { WebSocketServer, WebSocket } from "ws";
import { minimatch } from "minimatch";
import path from "node:path";

export interface OpenProjectArgs {
  projectPath: string;
  subProject?: string;
}

export interface GetSymbolInfoArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  strict?: boolean;
  props?: boolean;
  usages?: boolean;
  loc?: boolean;
  exclude?: string[];
  fields?: string[];
}

export interface GetSymbolUsagesWithContextArgs {
  projectPath: string;
  subProject?: string;
  query: string;
  strict?: boolean;
  contextLines?: number;
  exclude?: string[];
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
  open_project: OpenProjectArgs;
  get_symbol_info: GetSymbolInfoArgs;
  get_symbol_usages_with_context: GetSymbolUsagesWithContextArgs;
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
  "**/.react-map/**",
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
        name: "react-map-mcp",
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
          name: "open_project",
          description:
            "Open a project and start analysis. Returns project status.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path for monorepos",
              },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "get_symbol_info",
          description:
            "Get detailed information about a symbol (component or hook), including its definition and all usages/call sites across the project.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              query: {
                type: "string",
                description: "The name of the component or hook to find",
              },
              strict: {
                type: "boolean",
                description:
                  "If true, only return symbols that exactly match the query. Defaults to true.",
              },
              props: {
                type: "boolean",
                description:
                  "If true, include props in the definition. Defaults to false.",
              },
              usages: {
                type: "boolean",
                description:
                  "If true, include usages across the project. Defaults to false.",
              },
              loc: {
                type: "boolean",
                description:
                  "If true, include location information (line, column). Defaults to false.",
              },
              exclude: {
                type: "array",
                items: { type: "string" },
                description:
                  "List of glob patterns to exclude from results (e.g. ['**/test/**', '**/*.test.tsx']).",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return (e.g., ['definitions']). Omit to return all fields.",
              },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_symbol_usages_with_context",
          description:
            "Find all usages of a symbol and return them with a few lines of surrounding code context. Highly token-efficient for understanding how a symbol is used.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              query: {
                type: "string",
                description: "The name of the component or hook to find",
              },
              strict: {
                type: "boolean",
                description:
                  "If true, only return symbols that exactly match the query. Defaults to true.",
              },
              contextLines: {
                type: "number",
                description:
                  "Number of context lines to show around the match. Defaults to 2.",
              },
              exclude: {
                type: "array",
                items: { type: "string" },
                description:
                  "List of glob patterns to exclude from results (e.g. ['**/test/**', '**/*.test.tsx']).",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_prop_definitions",
          description:
            "Get the prop definitions for a component. Returns a clean summary of props (name, type, required, documentation).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              componentName: {
                type: "string",
                description: "The name of the component",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "componentName"],
          },
        },
        {
          name: "find_files",
          description:
            "Search for files by name or pattern (glob or regex) across the project.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              pattern: {
                type: "string",
                description:
                  "Pattern to match against file paths or basenames (e.g., 'App*', 'src/**/*.tsx', 'auth')",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "pattern"],
          },
        },
        {
          name: "get_file_imports",
          description:
            "Get the list of imports for a specific file from the analysis data. More token-efficient than reading the full file.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "get_project_tree",
          description:
            "Get a tree structure of the project directories and files up to a specified depth.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              maxDepth: {
                type: "number",
                description: "Maximum depth to traverse (default: 3)",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "list_files",
          description:
            "List files in the project. For large projects, this returns a summary. Use list_directory for exploring specific folders and get_file_outline for details of a single file.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return for each file (e.g., ['path']). Omit to return all fields.",
              },
              exclude: {
                type: "array",
                items: { type: "string" },
                description:
                  "List of glob patterns to exclude from results (e.g. ['**/test/**', '**/*.test.tsx']).",
              },
            },
            required: ["projectPath"],
          },
        },
        {
          name: "get_component_hierarchy",
          description:
            "Get the render hierarchy starting from a specific component (who it renders and who renders it).",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              componentName: {
                type: "string",
                description: "The name of the component to start from",
              },
              depth: {
                type: "number",
                description:
                  "How many levels up and down to traverse (default: 2)",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "componentName"],
          },
        },
        {
          name: "get_symbol_location",
          description:
            "Get the exact file and location (line/column) of a symbol's definition, including its body scope if it's a function or hook.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              query: {
                type: "string",
                description: "The name of the symbol to find",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_symbol_content",
          description: "Get the source code content of a symbol's definition.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: {
                type: "string",
                description: "Absolute path to the project root",
              },
              subProject: {
                type: "string",
                description: "Optional sub-project path",
              },
              query: {
                type: "string",
                description: "The name of the symbol to find",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return. Omit to return all fields.",
              },
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "add_label",
          description:
            "Add a persistent label/tag to a file, folder, or variable ID for instant retrieval later.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              id: {
                type: "string",
                description:
                  "The ID or path to label (e.g. file path or graph ID)",
              },
              label: { type: "string", description: "The label to attach" },
            },
            required: ["projectPath", "id", "label"],
          },
        },
        {
          name: "list_labels",
          description: "List all persistent labels in the project.",
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
          description:
            "Find entities (files, folders, variables) by their associated label.",
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
          description:
            "List files and subdirectories in a specific folder. Use this to explore the project structure efficiently.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              dirPath: {
                type: "string",
                description: "Relative path from project root",
              },
            },
            required: ["projectPath", "dirPath"],
          },
        },
        {
          name: "get_file_outline",
          description:
            "Get a structured outline of a single file, including components, hooks, states, and their line numbers.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
              fields: {
                type: "array",
                items: { type: "string" },
                description:
                  "Optional list of fields to return (e.g., ['name', 'line']). Omit to return all fields.",
              },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "read_file",
          description: "Read the full content of a file.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
            },
            required: ["projectPath", "filePath"],
          },
        },
        {
          name: "grep_search",
          description: "Search for a pattern across all files in the project.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              pattern: {
                type: "string",
                description: "Regex pattern to search for",
              },
              exclude: {
                type: "array",
                items: { type: "string" },
                description:
                  "List of glob patterns to exclude from results (e.g. ['**/test/**', '**/*.test.tsx']).",
              },
            },
            required: ["projectPath", "pattern"],
          },
        },
        {
          name: "run_shell_command",
          description:
            "Execute a shell command in the project directory. Use this for terminal tasks. For searching code, prefer 'grep_search'. If using 'grep' manually, ensure you exclude '.git', 'node_modules', and '.react-map' directories to avoid noise.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              command: {
                type: "string",
                description: "The command to execute",
              },
            },
            required: ["projectPath", "command"],
          },
        },
        {
          name: "write_file",
          description:
            "Write content to a file. Useful for creating or overwriting files.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
              content: { type: "string" },
            },
            required: ["projectPath", "filePath", "content"],
          },
        },
        {
          name: "replace_file_content",
          description: "Replace a string in a file with another string.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
              oldString: { type: "string" },
              newString: { type: "string" },
            },
            required: ["projectPath", "filePath", "oldString", "newString"],
          },
        },
        {
          name: "multi_replace_file_content",
          description: "Perform multiple string replacements in a single file.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: {
                type: "string",
                description: "Relative path from project root",
              },
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
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    }

    return await this.handleKnownToolCall(toolCall as KnownToolCall);
  }

  private async handleKnownToolCall(knownCall: KnownToolCall) {
    switch (knownCall.name) {
      case "open_project": {
        const { projectPath, subProject } = knownCall.args;
        await this.projectManager.openProject(projectPath, subProject);
        return {
          content: [
            {
              type: "text",
              text: `Project ${subProject || projectPath} opened and analyzed successfully.`,
            },
          ],
        };
      }
      case "get_symbol_info": {
        const {
          projectPath,
          subProject,
          query,
          strict,
          props,
          usages,
          loc,
          exclude,
          fields,
        } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);

        const includeUsage = usages === true; // Default to false

        const results = await this.projectManager.findSymbol(
          resolvedPath,
          query,
          subProject,
          strict !== false, // Default to strict true
          props === true, // Default to false
          includeUsage,
          exclude || DEFAULT_EXCLUDES,
        );

        const includeLoc = loc === true;

        const processItem = (item: SymbolSearchResult) => {
          const processed = { ...item };
          if (!includeLoc) {
            delete (processed as Partial<SymbolSearchResult>).loc;
          }
          if (processed.usages) {
            processed.usages = processed.usages.map((u) => processItem(u));
          }

          return processed;
        };

        const result: SymbolInfo = {
          definitions: results.definitions.map((d) => processItem(d)),
        };

        if (includeUsage) {
          result.externalUsages = (results.externalUsages ?? []).map((u) =>
            processItem(u),
          );
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(result, fields), null, 2),
            },
          ],
        };
      }
      case "get_symbol_usages_with_context": {
        const {
          projectPath,
          subProject,
          query,
          strict,
          contextLines,
          exclude,
          fields,
        } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getSymbolUsagesWithContext(
          resolvedPath,
          query,
          subProject,
          strict !== false,
          contextLines ?? 2,
          exclude || DEFAULT_EXCLUDES,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(results, fields), null, 2),
            },
          ],
        };
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

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(results, fields), null, 2),
            },
          ],
        };
      }
      case "find_files": {
        const { projectPath, subProject, pattern, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.findFiles(
          resolvedPath,
          pattern,
          subProject,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(results, fields), null, 2),
            },
          ],
        };
      }

      case "get_file_imports": {
        const { projectPath, subProject, filePath, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getFileImports(
          resolvedPath,
          filePath,
          subProject,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(results, fields), null, 2),
            },
          ],
        };
      }

      case "get_project_tree": {
        const { projectPath, subProject, maxDepth, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.getProjectTree(
          resolvedPath,
          subProject,
          maxDepth,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(results, fields), null, 2),
            },
          ],
        };
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

        const files = Object.entries(project.graph!.files).filter(
          ([path]) => !isExcluded(path),
        );
        const totalFiles = files.length;
        const MAX_FILES = 50;
        const displayedFiles = files.slice(0, MAX_FILES);

        let fileSummary: {
          path: string;
          exports?: { name: string; kind: string }[];
        }[];

        if (totalFiles > MAX_FILES) {
          // Large project: return only paths for a subset to save tokens
          fileSummary = displayedFiles.map(([path]) => ({ path }));
        } else {
          fileSummary = displayedFiles.map(([path, file]) => {
            return {
              path,
              exports: Object.values(file.var || {}).map((v) => ({
                name: getDisplayName(v.name),
                kind: v.kind,
              })),
            };
          });
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  totalFiles,
                  displayedCount: fileSummary.length,
                  files: this.filterFields(fileSummary, fields),
                  hint:
                    totalFiles > MAX_FILES
                      ? `Project has ${totalFiles} files. Showing first ${MAX_FILES}. Use 'list_directory' to explore folders or 'find_files' to search for specific files.`
                      : undefined,
                },
                null,
                2,
              ),
            },
          ],
        };
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
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(result, fields), null, 2),
            },
          ],
        };
      }

      case "get_symbol_location": {
        const { projectPath, subProject, query, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getSymbolLocation(
          resolvedPath,
          query,
          subProject,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(result, fields), null, 2),
            },
          ],
        };
      }

      case "get_symbol_content": {
        const { projectPath, subProject, query, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getSymbolContent(
          resolvedPath,
          query,
          subProject,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(result, fields), null, 2),
            },
          ],
        };
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
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_labels": {
        const { projectPath, subProject } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getLabels(
          resolvedPath,
          subProject,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "search_by_label": {
        const { projectPath, subProject, label } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.findEntitiesByLabel(
          resolvedPath,
          label,
          subProject,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "list_directory": {
        const { projectPath, subProject, dirPath } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.listDirectory(
          resolvedPath,
          dirPath,
          subProject,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "get_file_outline": {
        const { projectPath, subProject, filePath, fields } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getFileOutline(
          resolvedPath,
          filePath,
          subProject,
        );
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(this.filterFields(result, fields), null, 2),
            },
          ],
        };
      }

      case "read_file": {
        const { projectPath, subProject, filePath } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.readFile(
          resolvedPath,
          filePath,
          subProject,
        );
        return { content: [{ type: "text", text: result }] };
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
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "run_shell_command": {
        const { projectPath, subProject, command } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.runShellCommand(
          resolvedPath,
          command,
          subProject,
        );
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "write_file": {
        const { projectPath, subProject, filePath, content } = knownCall.args;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const success = await this.projectManager.writeFile(
          resolvedPath,
          filePath,
          content,
        );
        return {
          content: [{ type: "text", text: JSON.stringify({ success }) }],
        };
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
        return {
          content: [{ type: "text", text: JSON.stringify({ success }) }],
        };
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
        return {
          content: [{ type: "text", text: JSON.stringify({ success }) }],
        };
      }

      default:
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        // @ts-expect-error
        throw new Error(`Unknown tool: ${knownCall.name}`);
    }
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

      console.error(`React Map backend started on ws://localhost:${this.port}`);

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
                const { projectPath, subProject } = data.payload;
                const project = await this.projectManager.openProject(
                  projectPath,
                  subProject,
                );
                this.sendResponse(
                  ws,
                  "project_opened",
                  { sqlitePath: project.sqlitePath },
                  data.requestId,
                );
                break;
              }
              case "update_graph_position": {
                const { projectPath, subProject, positions, contextId } =
                  data.payload;
                const success = await this.projectManager.updateGraphPosition(
                  projectPath,
                  subProject,
                  positions,
                  contextId,
                );
                this.sendResponse(
                  ws,
                  "position_updated",
                  { success },
                  data.requestId,
                );
                break;
              }
              case "save_state": {
                const { projectPath, state } = data.payload;
                const success = await this.projectManager.saveAppState(
                  projectPath,
                  state,
                );
                this.sendResponse(
                  ws,
                  "state_saved",
                  { success },
                  data.requestId,
                );
                break;
              }
              case "read_state": {
                const { projectPath } = data.payload;
                const state =
                  await this.projectManager.readAppState(projectPath);
                this.sendResponse(ws, "state_data", state, data.requestId);
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
                const { projectPath, commitHash, subPath } = data.payload;
                const graph = await this.projectManager.gitAnalyzeCommit(
                  projectPath,
                  commitHash,
                  subPath,
                );
                this.sendChunkedResponse(
                  ws,
                  "git_analyze_commit",
                  graph,
                  data.requestId,
                );
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
      `React Map MCP server running on stdio and ws://localhost:${this.port}`,
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
