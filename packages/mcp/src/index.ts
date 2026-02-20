import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ProjectManager, BackendServer } from "server";

const projectManager = new ProjectManager();
const server = new BackendServer(projectManager);

async function main() {
  const transport = new StdioServerTransport();
  
  // Try to start WebSocket server. If port taken, we just continue as an MCP-only process
  // or connect to the existing one if we want to share state (TBD)
  try {
    server.startWebSocketServer();
  } catch (e) {
    console.error("Could not start WebSocket server (likely port 3030 taken). Continuing as MCP-only.");
  }

  await server.startMcpServer(transport);
}

main().catch((error: unknown) => {
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
