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
            "List all files in the project with their analyzed components and hooks.",
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
        const project = this.projectManager.getProject(projectPath, subProject);
        if (!project || !project.graph) {
          throw new Error(
            "Project not open or graph not available. Call open_project first.",
          );
        }

        const graph = project.graph;
        const results: SymbolInfoResult[] = [];

        // Find definitions
        for (const [filePath, file] of Object.entries(graph.files)) {
          for (const variable of Object.values(file.var)) {
            const displayName = getDisplayName(variable.name);
            if (displayName.toLowerCase().includes(query.toLowerCase())) {
              results.push({
                type: "definition",
                kind: variable.kind,
                name: displayName,
                file: filePath,
                loc: variable.loc,
                props: "props" in variable ? variable.props : undefined,
              });
            }
          }
        }

        // Find usages
        for (const [filePath, file] of Object.entries(graph.files)) {
          for (const variable of Object.values(file.var)) {
            const containerName = getDisplayName(variable.name);

            // Check renders (component calls)
            if ("renders" in variable && variable.renders) {
              for (const render of Object.values(variable.renders)) {
                if (render.tag.toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    type: "usage",
                    kind: "component-render",
                    in: containerName,
                    file: filePath,
                    loc: render.loc,
                  });
                }
              }
            }

            // Check direct usages in body (for other variables and hooks)
            if ("var" in variable && variable.var) {
              for (const v of Object.values(variable.var)) {
                const varName = getDisplayName(v.name);

                // Check if it's a hook call
                if (
                  v.type === "data" &&
                  v.kind === "hook" &&
                  "call" in v &&
                  v.call.name.toLowerCase().includes(query.toLowerCase())
                ) {
                  results.push({
                    type: "usage",
                    kind: "hook-call",
                    in: containerName,
                    file: filePath,
                    loc: v.loc,
                  });
                }

                // Check if it's a regular variable matching the query
                if (varName.toLowerCase().includes(query.toLowerCase())) {
                  results.push({
                    type: "definition",
                    kind: "local-variable",
                    name: varName,
                    in: containerName,
                    file: filePath,
                    loc: v.loc,
                  });
                }
              }
            }
          }
        }

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
        const project = this.projectManager.getProject(projectPath, subProject);
        if (!project || !project.graph) {
          throw new Error(
            "Project not open or graph not available. Call open_project first.",
          );
        }

        const fileSummary = Object.entries(project.graph.files).map(
          ([path, file]) => {
            return {
              path,
              exports: Object.values(file.var).map((v) => ({
                name: getDisplayName(v.name),
                kind: v.kind,
              })),
            };
          },
        );

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(fileSummary, null, 2),
            },
          ],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
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
