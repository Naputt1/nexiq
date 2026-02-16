import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import * as automation from "./automation.js";

const server = new Server(
  {
    name: "react-map-mcp",
    version: "0.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "screenshot",
        description: "Take a screenshot of the React Map UI",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "click",
        description: "Click an element by selector or at specific coordinates",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
      },
      {
        name: "drag",
        description: "Drag from one coordinate to another",
        inputSchema: {
          type: "object",
          properties: {
            from: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
            to: {
              type: "object",
              properties: {
                x: { type: "number" },
                y: { type: "number" },
              },
              required: ["x", "y"],
            },
          },
          required: ["from", "to"],
        },
      },
      {
        name: "hover",
        description: "Hover over an element by selector or at specific coordinates",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string" },
            x: { type: "number" },
            y: { type: "number" },
          },
        },
      },
      {
        name: "press_key",
        description: "Press a keyboard key",
        inputSchema: {
          type: "object",
          properties: {
            key: { type: "string", description: "The key to press (e.g., 'Enter', 'Escape', 'Control+Shift+N')" },
          },
          required: ["key"],
        },
      },
      {
        name: "get_graph_data",
        description: "Get the current graph data (nodes, combos, edges)",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "search_graph",
        description: "Search for a query in the graph and return matching IDs",
        inputSchema: {
          type: "object",
          properties: {
            query: { type: "string" },
          },
          required: ["query"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "screenshot": {
        const base64 = await automation.screenshot();
        return {
          content: [
            {
              type: "text",
              text: "Screenshot captured.",
            },
            {
              type: "image",
              data: base64,
              mimeType: "image/png",
            } as any, // Cast to any because SDK types might be strict
          ],
        };
      }

      case "click": {
        const { selector, x, y } = args as any;
        await automation.click(selector || { x, y });
        return { content: [{ type: "text", text: `Clicked ${selector || `at (${x}, ${y})`}` }] };
      }

      case "drag": {
        const { from, to } = args as any;
        await automation.drag(from, to);
        return { content: [{ type: "text", text: `Dragged from (${from.x}, ${from.y}) to (${to.x}, ${to.y})` }] };
      }

      case "hover": {
        const { selector, x, y } = args as any;
        await automation.hover(selector || { x, y });
        return { content: [{ type: "text", text: `Hovered ${selector || `at (${x}, ${y})`}` }] };
      }

      case "press_key": {
        const { key } = args as any;
        await automation.pressKey(key);
        return { content: [{ type: "text", text: `Pressed key: ${key}` }] };
      }

      case "get_graph_data": {
        const data = await automation.getGraphData();
        return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
      }

      case "search_graph": {
        const { query } = args as any;
        const result = await automation.searchGraph(query);
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
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
  console.error("React Map MCP server running on stdio");
}

main().catch((error) => {
  console.error("Fatal error in main():", error);
  process.exit(1);
});
