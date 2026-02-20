import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { ProjectManager } from "./projectManager.js";
import { getDisplayName } from "shared";
import { WebSocketServer } from "ws";

const projectManager = new ProjectManager();

// Start WebSocket server for UI integration
const wss = new WebSocketServer({ port: 3030 });
console.error("React Map backend started on ws://localhost:3030");

wss.on("connection", (ws) => {
  console.error("UI connected via WebSocket");
  
  ws.on("message", async (message) => {
    try {
      const { type, payload } = JSON.parse(message.toString());
      
      switch (type) {
        case "open_project": {
          const { projectPath, subProject } = payload;
          await projectManager.openProject(projectPath, subProject);
          ws.send(JSON.stringify({ type: "project_opened", payload: { projectPath, subProject } }));
          break;
        }
        case "get_graph_data": {
          const { projectPath, subProject } = payload;
          const project = projectManager.getProject(projectPath, subProject);
          if (project) {
            ws.send(JSON.stringify({ type: "graph_data", payload: project.graph }));
          }
          break;
        }
      }
    } catch (e) {
      console.error("Error handling WebSocket message", e);
    }
  });
});

const server = new Server(
  {
    name: "react-map-mcp",
    version: "0.2.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  const baseTools = [
    {
      name: "open_project",
      description: "Open a project and start analysis. Returns project status.",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project root" },
          subProject: { type: "string", description: "Optional sub-project path for monorepos" },
        },
        required: ["projectPath"],
      },
    },
    {
      name: "get_symbol_info",
      description: "Get detailed information about a symbol (component or hook), including its definition and all usages/call sites across the project.",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project root" },
          subProject: { type: "string", description: "Optional sub-project path" },
          query: { type: "string", description: "The name of the component or hook to find" },
        },
        required: ["projectPath", "query"],
      },
    },
    {
      name: "list_files",
      description: "List all files in the project with their analyzed components and hooks.",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Absolute path to the project root" },
          subProject: { type: "string", description: "Optional sub-project path" },
        },
        required: ["projectPath"],
      },
    },
  ];

  const extensions = projectManager.getAllExtensions();
  const extensionTools = extensions.flatMap(ext => 
    (ext.mcpTools || []).map(tool => ({
      name: `${ext.id}_${tool.name}`,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }))
  );

  return {
    tools: [...baseTools, ...extensionTools],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    // Handle extension tools
    const extensions = projectManager.getAllExtensions();
    for (const ext of extensions) {
      if (name.startsWith(`${ext.id}_`)) {
        const toolName = name.replace(`${ext.id}_`, "");
        const tool = (ext.mcpTools || []).find(t => t.name === toolName);
        if (tool) {
          const result = await tool.handler({ ...args, projectManager });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
      }
    }

    switch (name) {
      case "open_project": {
        const { projectPath, subProject } = args as any;
        await projectManager.openProject(projectPath, subProject);
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
        const { projectPath, subProject, query } = args as any;
        const project = projectManager.getProject(projectPath, subProject);
        if (!project || !project.graph) {
          throw new Error("Project not open or graph not available. Call open_project first.");
        }

        const graph = project.graph;
        const results: any[] = [];

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
                props: variable.props,
              });
            }
          }
        }

        // Find usages
        for (const [filePath, file] of Object.entries(graph.files)) {
          for (const variable of Object.values(file.var)) {
             // Check renders (component calls)
             if (variable.renders) {
               for (const render of Object.values(variable.renders)) {
                 if (render.name.toLowerCase().includes(query.toLowerCase())) {
                    results.push({
                      type: "usage",
                      kind: "component-render",
                      in: getDisplayName(variable.name),
                      file: filePath,
                      loc: render.loc,
                    });
                 }
               }
             }
             // Check hooks (hook calls)
             if (variable.hooks) {
                for (const hook of Object.values(variable.hooks)) {
                   if (hook.name.toLowerCase().includes(query.toLowerCase())) {
                      results.push({
                        type: "usage",
                        kind: "hook-call",
                        in: getDisplayName(variable.name),
                        file: filePath,
                        loc: hook.loc,
                      });
                   }
                }
             }
             // Check direct usages in body (for other variables)
             if (variable.var) {
                for (const v of Object.values(variable.var)) {
                   if (getDisplayName(v.name).toLowerCase().includes(query.toLowerCase())) {
                      results.push({
                        type: "definition",
                        kind: "local-variable",
                        in: getDisplayName(variable.name),
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
        const { projectPath, subProject } = args as any;
        const project = projectManager.getProject(projectPath, subProject);
        if (!project || !project.graph) {
          throw new Error("Project not open or graph not available. Call open_project first.");
        }

        const fileSummary = Object.entries(project.graph.files).map(([path, file]) => {
          return {
            path,
            exports: Object.values(file.var).map(v => ({
              name: getDisplayName(v.name),
              kind: v.kind
            }))
          };
        });

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
  } catch (error: any) {
    return {
      isError: true,
      content: [{ type: "text", text: error.message }],
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("React Map MCP server running on stdio and ws://localhost:3030");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await projectManager.closeAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await projectManager.closeAll();
  process.exit(0);
});
