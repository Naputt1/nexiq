import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ProjectManager } from "./projectManager.js";
import { BackendServer } from "./server.js";

export { ProjectManager, BackendServer };

// If this file is run directly (e.g., pnpm start)
if (import.meta.url === `file://${process.argv[1]}`) {
  const projectManager = new ProjectManager();
  const server = new BackendServer(projectManager);

  const main = async () => {
    const transport = new StdioServerTransport();
    server.startWebSocketServer();
    await server.startMcpServer(transport);
  };

  main().catch((error: unknown) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
  });

  const cleanupAndExit = async () => {
    console.log("Shutting down backend server...");
    // Force exit after 1 second if closeAll hangs or workers are still running
    setTimeout(() => {
      console.error("Force exiting after timeout");
      process.exit(0);
    }, 1000).unref();
    
    try {
      await projectManager.closeAll();
    } catch (err) {
      console.error("Error during cleanup:", err);
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);

  // If spawned with an IPC channel, exit when the parent process disconnects
  if (process.send) {
    process.on("disconnect", () => {
      console.log("Parent process disconnected, exiting...");
      cleanupAndExit();
    });
  }
}
