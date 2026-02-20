import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendServer } from "./server.js";
import { ProjectManager } from "./projectManager.js";
import { WebSocketServer, WebSocket } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";

vi.mock("ws");
vi.mock("@modelcontextprotocol/sdk/server/index.js");
vi.mock("@modelcontextprotocol/sdk/server/stdio.js");
vi.mock("./projectManager.js");

describe("BackendServer", () => {
  let server: BackendServer;
  let mockProjectManager: ProjectManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
    mockProjectManager = new ProjectManager() as any;
    (mockProjectManager.getAllExtensions as any).mockReturnValue([]);
    server = new BackendServer(mockProjectManager, 3030);
  });

  describe("MCP Tool Handlers", () => {
    it("should handle open_project tool", async () => {
      const args = { projectPath: "/test" };
      const result = await server.handleCallTool("open_project", args);

      expect(mockProjectManager.openProject).toHaveBeenCalledWith("/test", undefined);
      expect(result).toEqual({
        content: [{ type: "text", text: expect.stringContaining("successfully") }],
      });
    });

    it("should handle get_symbol_info tool", async () => {
      const mockGraph = {
        files: {
          "src/App.tsx": {
            var: {
              "App-id": {
                id: "App-id",
                name: { type: "identifier", name: "App" },
                kind: "component",
                loc: { line: 1, column: 1 },
                props: [],
              },
            },
          },
        },
      };

      (mockProjectManager.getProject as any).mockReturnValue({ graph: mockGraph });

      const args = { projectPath: "/test", query: "App" };
      const result = await server.handleCallTool("get_symbol_info", args);

      const content = JSON.parse((result as any).content[0].text);
      expect(content).toHaveLength(1);
      expect(content[0].name).toBe("App");
      expect(content[0].type).toBe("definition");
    });

    it("should handle list_files tool", async () => {
      const mockGraph = {
        files: {
          "src/index.ts": {
            var: {
              "v1": { name: { type: "identifier", name: "main" }, kind: "normal" },
            },
          },
        },
      };

      (mockProjectManager.getProject as any).mockReturnValue({ graph: mockGraph });

      const args = { projectPath: "/test" };
      const result = await server.handleCallTool("list_files", args);

      const content = JSON.parse((result as any).content[0].text);
      expect(content).toHaveLength(1);
      expect(content[0].path).toBe("src/index.ts");
    });

    it("should return error if tool is unknown", async () => {
      await expect(server.handleCallTool("unknown_tool", {})).rejects.toThrow("Unknown tool");
    });
  });

  describe("WebSocket Handlers", () => {
    let mockWs: any;

    beforeEach(() => {
      mockWs = {
        send: vi.fn(),
        on: vi.fn(),
      };
      server.startWebSocketServer();
      const wssInstance = (WebSocketServer as any).mock.instances[0];
      const connectionHandler = wssInstance.on.mock.calls.find((args: any) => args[0] === "connection")[1];
      connectionHandler(mockWs);
    });

    it("should handle open_project message", async () => {
      const messageHandler = mockWs.on.mock.calls.find((args: any) => args[0] === "message")[1];
      
      const payload = {
        type: "open_project",
        payload: { projectPath: "/test" },
        requestId: "req-1",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockProjectManager.openProject).toHaveBeenCalledWith("/test", undefined);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("project_opened"));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("req-1"));
    });

    it("should handle get_graph_data message", async () => {
      const mockGraph = { files: {}, edges: [] };
      (mockProjectManager.getProject as any).mockReturnValue({ graph: mockGraph });

      const messageHandler = mockWs.on.mock.calls.find((args: any) => args[0] === "message")[1];
      
      const payload = {
        type: "get_graph_data",
        payload: { projectPath: "/test" },
        requestId: "req-2",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("graph_data"));
      const response = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(response.payload).toEqual(mockGraph);
    });

    it("should handle call_tool message", async () => {
      const messageHandler = mockWs.on.mock.calls.find((args: any) => args[0] === "message")[1];
      
      const payload = {
        type: "call_tool",
        payload: { name: "open_project", arguments: { projectPath: "/test" } },
        requestId: "req-3",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining("tool_result"));
    });
  });

  describe("Self-Termination", () => {
    it("should start exit countdown when last connection drops", async () => {
      vi.useFakeTimers();
      process.env.NODE_ENV = "production";

      server.startWebSocketServer();
      const wssInstance = (WebSocketServer as any).mock.instances[0];
      const connectionHandler = wssInstance.on.mock.calls.find((args: any) => args[0] === "connection")[1];
      
      const mockWs = { on: vi.fn(), send: vi.fn() };
      connectionHandler(mockWs);

      const closeHandler = mockWs.on.mock.calls.find((args: any) => args[0] === "close")[1];
      closeHandler();

      // Countdown started
      vi.advanceTimersByTime(10000);
      
      expect(mockProjectManager.closeAll).toHaveBeenCalled();
      vi.useRealTimers();
    });
  });
});
