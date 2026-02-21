import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ProjectManager } from "./projectManager.js";
import {
  getDisplayName,
  type PropData,
  type ComponentInfoRenderDependency,
} from "shared";
import { WebSocketServer, WebSocket } from "ws";

export interface OpenProjectArgs {
  projectPath: string;
  subProject?: string;
}

export interface GetSymbolInfoArgs {
  projectPath: string;
  subProject?: string;
  query: string;
}

export interface ListFilesArgs {
  projectPath: string;
  subProject?: string;
}

export type SymbolInfoResult =
  | {
      type: "definition";
      kind: string;
      name: string;
      file: string;
      loc: { line: number; column: number };
      props?: PropData[] | ComponentInfoRenderDependency[];
      in?: string;
    }
  | {
      type: "usage";
      kind: string;
      in: string;
      file: string;
      loc: { line: number; column: number };
    };

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
            },
            required: ["projectPath", "query"],
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
                description: "How many levels up and down to traverse (default: 2)",
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
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "get_symbol_content",
          description:
            "Get the source code content of a symbol's definition.",
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
            },
            required: ["projectPath", "query"],
          },
        },
        {
          name: "add_label",
          description: "Add a persistent label/tag to a file, folder, or variable ID for instant retrieval later.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              id: { type: "string", description: "The ID or path to label (e.g. file path or graph ID)" },
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
          description: "Find entities (files, folders, variables) by their associated label.",
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
          description: "List files and subdirectories in a specific folder. Use this to explore the project structure efficiently.",
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
          description: "Get a structured outline of a single file, including components, hooks, states, and their line numbers.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              filePath: { type: "string", description: "Relative path from project root" },
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
              filePath: { type: "string", description: "Relative path from project root" },
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
              pattern: { type: "string", description: "Regex pattern to search for" },
            },
            required: ["projectPath", "pattern"],
          },
        },
        {
          name: "run_shell_command",
          description: "Execute a shell command in the project directory. Use this for terminal tasks. For searching code, prefer 'grep_search'. If using 'grep' manually, ensure you exclude '.git', 'node_modules', and '.react-map' directories to avoid noise.",
          inputSchema: {
            type: "object",
            properties: {
              projectPath: { type: "string" },
              subProject: { type: "string" },
              command: { type: "string", description: "The command to execute" },
            },
            required: ["projectPath", "command"],
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
        const result = await this.handleCallTool(name, (args as any) || {});
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

  public async handleCallTool(name: string, args: Record<string, unknown>) {
    // Handle extension tools
    const extensions = this.projectManager.getAllExtensions();
    for (const ext of extensions) {
      if (name.startsWith(`${ext.id}_`)) {
        const toolName = name.replace(`${ext.id}_`, "");
        const tool = (ext.mcpTools || []).find((t) => t.name === toolName);
        if (tool) {
          const result = await tool.handler({
            ...args,
            projectManager: this.projectManager,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          };
        }
      }
    }

    switch (name) {
      case "open_project": {
        const { projectPath, subProject } = args as unknown as OpenProjectArgs;
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
        const { projectPath, subProject, query } =
          args as unknown as GetSymbolInfoArgs;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const results = await this.projectManager.findSymbol(
          resolvedPath,
          query,
          subProject,
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(results, null, 2),
            },
          ],
        };
      }

      case "list_files": {
        const { projectPath, subProject } = args as unknown as ListFilesArgs;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const project = this.projectManager.getProject(resolvedPath, subProject);
        if (!project || !project.graph) {
          throw new Error(
            "Project not open or graph not available. Call open_project first.",
          );
        }

        const files = Object.entries(project.graph.files);
        let fileSummary: any[];

        if (files.length > 100) {
          // Large project: return only paths to save tokens
          fileSummary = files.map(([path]) => ({ path }));
        } else {
          fileSummary = files.map(([path, file]) => {
            return {
              path,
              exports: Object.values(file.var).map((v) => ({
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
              text: JSON.stringify({
                totalFiles: files.length,
                files: fileSummary,
                hint: files.length > 100 ? "Project is large. Use list_directory to explore specific folders or get_file_outline for symbol details." : undefined
              }, null, 2),
            },
          ],
        };
      }

      case "get_component_hierarchy": {
        const { projectPath, subProject, componentName, depth } =
          args as any;
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_symbol_location": {
        const { projectPath, subProject, query } =
          args as any;
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_symbol_content": {
        const { projectPath, subProject, query } =
          args as any;
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
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "add_label": {
        const { projectPath, subProject, id, label } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.addLabel(resolvedPath, id, label, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "list_labels": {
        const { projectPath, subProject } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getLabels(resolvedPath, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "search_by_label": {
        const { projectPath, subProject, label } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.findEntitiesByLabel(resolvedPath, label, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "list_directory": {
        const { projectPath, subProject, dirPath } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.listDirectory(resolvedPath, dirPath, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "get_file_outline": {
        const { projectPath, subProject, filePath } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.getFileOutline(resolvedPath, filePath, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "read_file": {
        const { projectPath, subProject, filePath } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.readFile(resolvedPath, filePath, subProject);
        return { content: [{ type: "text", text: result }] };
      }

      case "grep_search": {
        const { projectPath, subProject, pattern } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.grepSearch(resolvedPath, pattern, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      case "run_shell_command": {
        const { projectPath, subProject, command } = args as any;
        const resolvedPath = this.resolveProjectPath(projectPath, subProject);
        const result = await this.projectManager.runShellCommand(resolvedPath, command, subProject);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  private resolveProjectPath(projectPath: string, subProject?: string): string {
    if (projectPath === "." || projectPath === "/" || !projectPath) {
      const projects = (this.projectManager as any).projects;
      if (projects && projects.size > 0) {
        // Fallback to the first project in the map if a generic path is given
        const firstProject = projects.values().next().value;
        return firstProject.projectPath;
      }
    }
    return projectPath;
  }

  public startWebSocketServer() {
    this.wss = new WebSocketServer({ port: this.port });
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
          const data = JSON.parse(message.toString()) as {
            type: string;
            payload: unknown;
            requestId?: string;
          };
          const { type, payload, requestId } = data;
          currentRequestId = requestId;

          switch (type) {
            case "open_project": {
              const { projectPath, subProject } = payload as OpenProjectArgs;
              await this.projectManager.openProject(projectPath, subProject);
              ws.send(
                JSON.stringify({
                  type: "project_opened",
                  payload: { projectPath, subProject },
                  requestId,
                }),
              );
              break;
            }
            case "get_graph_data": {
              const { projectPath, subProject } = payload as OpenProjectArgs;
              let project = this.projectManager.getProject(
                projectPath,
                subProject,
              );
              if (!project) {
                console.error(
                  `Project not in cache, opening: ${subProject || projectPath}`,
                );
                project = await this.projectManager.openProject(
                  projectPath,
                  subProject,
                );
              }
              ws.send(
                JSON.stringify({
                  type: "graph_data",
                  payload: project.graph,
                  requestId,
                }),
              );
              break;
            }
            case "update_graph_position": {
              const { projectPath, subProject, positions, contextId } =
                payload as {
                  projectPath: string;
                  subProject: string | undefined;
                  positions: any;
                  contextId?: string;
                };
              const success = await this.projectManager.updateGraphPosition(
                projectPath,
                subProject,
                positions,
                contextId,
              );
              ws.send(
                JSON.stringify({
                  type: "position_updated",
                  payload: { success },
                  requestId,
                }),
              );
              break;
            }
            case "save_state": {
              const { projectPath, state } = payload as {
                projectPath: string;
                state: any;
              };
              const success = await this.projectManager.saveAppState(
                projectPath,
                state,
              );
              ws.send(
                JSON.stringify({
                  type: "state_saved",
                  payload: { success },
                  requestId,
                }),
              );
              break;
            }
            case "read_state": {
              const { projectPath } = payload as { projectPath: string };
              const state = await this.projectManager.readAppState(projectPath);
              ws.send(
                JSON.stringify({
                  type: "state_data",
                  payload: state,
                  requestId,
                }),
              );
              break;
            }
            case "call_tool": {
              const { name, arguments: args } = payload as {
                name: string;
                arguments: Record<string, unknown>;
              };
              const result = await this.handleCallTool(name, args);
              ws.send(
                JSON.stringify({
                  type: "tool_result",
                  payload: result,
                  requestId,
                }),
              );
              break;
            }
            default: {
              ws.send(
                JSON.stringify({
                  type: "error",
                  payload: { message: `Unknown message type: ${type}` },
                  requestId,
                }),
              );
              break;
            }
          }
        } catch (e: unknown) {
          const errorMessage = e instanceof Error ? e.message : "Unknown error";
          console.error("Error handling WebSocket message", e);
          ws.send(
            JSON.stringify({
              type: "error",
              payload: { message: errorMessage },
              requestId: currentRequestId,
            }),
          );
        }
      });
    });
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
