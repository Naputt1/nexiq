import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ProjectManager } from "./projectManager.js";
import { BackendServer } from "./server.js";

const projectManager = new ProjectManager();
const server = new BackendServer(projectManager);

async function main() {
  const transport = new StdioServerTransport();
  server.startWebSocketServer();
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
