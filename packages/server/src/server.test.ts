import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendServer } from "./server.js";
import { ProjectManager } from "./projectManager.js";
import { WebSocketServer, WebSocket } from "ws";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

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
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockProjectManager = new ProjectManager() as any;
    (mockProjectManager.getAllExtensions as any).mockReturnValue([]);
    server = new BackendServer(mockProjectManager, 3030);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MCP Tool Handlers", () => {
    it("should handle open_project tool", async () => {
      const args = { projectPath: "/test" };
      const result = await server.handleCallTool("open_project", args);

      expect(mockProjectManager.openProject).toHaveBeenCalledWith(
        "/test",
        undefined,
      );
      expect(result).toEqual({
        content: [
          { type: "text", text: expect.stringContaining("successfully") },
        ],
      });
    });

    it("should handle get_symbol_info tool", async () => {
      const mockResult = [
        {
          type: "definition",
          kind: "component",
          name: "App",
          file: "src/App.tsx",
          loc: { line: 1, column: 1 },
        },
      ];

      (mockProjectManager.findSymbol as any).mockResolvedValue(mockResult);

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
              v1: {
                name: { type: "identifier", name: "main" },
                kind: "normal",
              },
            },
          },
        },
      };

      (mockProjectManager.getProject as any).mockReturnValue({
        graph: mockGraph,
      });

      const args = { projectPath: "/test" };
      const result = await server.handleCallTool("list_files", args);

      const content = JSON.parse((result as any).content[0].text);
      expect(content.totalFiles).toBe(1);
      expect(content.files).toHaveLength(1);
      expect(content.files[0].path).toBe("src/index.ts");
    });

    it("should handle read_file tool", async () => {
      (mockProjectManager.readFile as any).mockResolvedValue("file content");
      const args = { projectPath: "/test", filePath: "src/App.tsx" };
      const result = await server.handleCallTool("read_file", args);
      expect((result as any).content[0].text).toBe("file content");
    });

    it("should handle grep_search tool", async () => {
      const mockResult = [{ file: "src/App.tsx", line: 1, content: "import" }];
      (mockProjectManager.grepSearch as any).mockResolvedValue(mockResult);
      const args = { projectPath: "/test", pattern: "import" };
      const result = await server.handleCallTool("grep_search", args);
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle list_files tool error when project not open", async () => {
      (mockProjectManager.getProject as any).mockReturnValue(null);
      await expect(
        server.handleCallTool("list_files", { projectPath: "/p" }),
      ).rejects.toThrow("Project not open");
    });

    it("should handle labeling tools", async () => {
      (mockProjectManager.addLabel as any).mockResolvedValue(["tag1"]);
      const addResult = await server.handleCallTool("add_label", {
        projectPath: "/p",
        id: "id1",
        label: "tag1",
      });
      expect(JSON.parse((addResult as any).content[0].text)).toEqual(["tag1"]);

      (mockProjectManager.getLabels as any).mockResolvedValue({
        id1: ["tag1"],
      });
      const listResult = await server.handleCallTool("list_labels", {
        projectPath: "/p",
      });
      expect(JSON.parse((listResult as any).content[0].text)).toEqual({
        id1: ["tag1"],
      });

      (mockProjectManager.findEntitiesByLabel as any).mockResolvedValue([
        "id1",
      ]);
      const searchResult = await server.handleCallTool("search_by_label", {
        projectPath: "/p",
        label: "tag1",
      });
      expect(JSON.parse((searchResult as any).content[0].text)).toEqual([
        "id1",
      ]);
    });

    it("should handle enhanced navigation tools", async () => {
      const mockDir = { directories: ["d1"], files: ["f1"] };
      (mockProjectManager.listDirectory as any).mockResolvedValue(mockDir);
      const dirResult = await server.handleCallTool("list_directory", {
        projectPath: "/p",
        dirPath: "src",
      });
      expect(JSON.parse((dirResult as any).content[0].text)).toEqual(mockDir);

      const mockOutline = [{ name: "Comp", line: 1 }];
      (mockProjectManager.getFileOutline as any).mockResolvedValue(mockOutline);
      const outlineResult = await server.handleCallTool("get_file_outline", {
        projectPath: "/p",
        filePath: "f1",
      });
      expect(JSON.parse((outlineResult as any).content[0].text)).toEqual(
        mockOutline,
      );
    });

    it("should handle symbol exploration tools", async () => {
      const mockLoc = [{ file: "f1", line: 1 }];
      (mockProjectManager.getSymbolLocation as any).mockResolvedValue(mockLoc);
      const locResult = await server.handleCallTool("get_symbol_location", {
        projectPath: "/p",
        query: "S",
      });
      expect(JSON.parse((locResult as any).content[0].text)).toEqual(mockLoc);

      const mockContent = [{ content: "code" }];
      (mockProjectManager.getSymbolContent as any).mockResolvedValue(
        mockContent,
      );
      const contentResult = await server.handleCallTool("get_symbol_content", {
        projectPath: "/p",
        query: "S",
      });
      expect(JSON.parse((contentResult as any).content[0].text)).toEqual(
        mockContent,
      );
    });

    it("should handle get_symbol_usages tool", async () => {
      const mockResult = [{ type: "usage", name: "App", file: "src/main.tsx" }];
      (mockProjectManager.findSymbolUsages as any).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_symbol_usages", {
        projectPath: "/p",
        query: "App",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle find_files tool", async () => {
      const mockResult = ["src/App.tsx"];
      (mockProjectManager.findFiles as any).mockResolvedValue(mockResult);
      const result = await server.handleCallTool("find_files", {
        projectPath: "/p",
        pattern: "App",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle get_file_imports tool", async () => {
      const mockResult = { react: { localName: "React", source: "react" } };
      (mockProjectManager.getFileImports as any).mockResolvedValue(mockResult);
      const result = await server.handleCallTool("get_file_imports", {
        projectPath: "/p",
        filePath: "f1",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle get_project_tree tool", async () => {
      const mockResult = { name: "/", children: [] };
      (mockProjectManager.getProjectTree as any).mockResolvedValue(mockResult);
      const result = await server.handleCallTool("get_project_tree", {
        projectPath: "/p",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle get_component_hierarchy tool", async () => {
      const mockResult = { component: "App", hierarchies: [] };
      (mockProjectManager.getComponentHierarchy as any).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_component_hierarchy", {
        projectPath: "/p",
        componentName: "App",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle run_shell_command tool", async () => {
      const mockResult = { stdout: "ok", stderr: "" };
      (mockProjectManager.runShellCommand as any).mockResolvedValue(mockResult);
      const result = await server.handleCallTool("run_shell_command", {
        projectPath: "/p",
        command: "ls",
      });
      expect(JSON.parse((result as any).content[0].text)).toEqual(mockResult);
    });

    it("should handle list_files tool with large project", async () => {
      const mockGraph = {
        files: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`f${i}.ts`, { var: {} }]),
        ),
      };
      (mockProjectManager.getProject as any).mockReturnValue({
        graph: mockGraph,
      });
      const result = await server.handleCallTool("list_files", {
        projectPath: "/p",
      });
      const content = JSON.parse((result as any).content[0].text);
      expect(content.totalFiles).toBe(101);
      expect(content.files[0]).not.toHaveProperty("exports");
    });

    it("should return error if tool is unknown", async () => {
      await expect(server.handleCallTool("unknown_tool", {})).rejects.toThrow(
        "Unknown tool",
      );
    });

    it("should handle list tools request", async () => {
      const listToolsHandler = (
        server as any
      ).mcpServer.setRequestHandler.mock.calls.find(
        (args: any) => args[0] === ListToolsRequestSchema,
      )[1];
      const result = await listToolsHandler();
      expect(result.tools).toBeDefined();
      expect(result.tools.some((t: any) => t.name === "open_project")).toBe(
        true,
      );
    });

    it("should handle call tool request with error", async () => {
      const callToolHandler = (
        server as any
      ).mcpServer.setRequestHandler.mock.calls.find(
        (args: any) => args[0] === CallToolRequestSchema,
      )[1];

      const result = await callToolHandler({ params: { name: "unknown" } });
      expect(result.isError).toBe(true);
    });

    it("should handle extension tools", async () => {
      const mockExt = {
        id: "ext1",
        mcpTools: [
          {
            name: "tool1",
            description: "desc",
            inputSchema: {},
            handler: vi.fn().mockResolvedValue({ ok: true }),
          },
        ],
      };
      (mockProjectManager.getAllExtensions as any).mockReturnValue([mockExt]);

      // List tools
      const listToolsHandler = (
        server as any
      ).mcpServer.setRequestHandler.mock.calls.find(
        (args: any) => args[0] === ListToolsRequestSchema,
      )[1];
      const tools = await listToolsHandler();
      expect(tools.tools.some((t: any) => t.name === "ext1_tool1")).toBe(true);

      // Call tool
      const result = await server.handleCallTool("ext1_tool1", { some: "arg" });
      expect(mockExt.mcpTools[0].handler).toHaveBeenCalled();
      expect(JSON.parse((result as any).content[0].text)).toEqual({ ok: true });
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
      const connectionHandler = wssInstance.on.mock.calls.find(
        (args: any) => args[0] === "connection",
      )[1];
      connectionHandler(mockWs);
    });

    it("should handle open_project message", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "message",
      )[1];

      const payload = {
        type: "open_project",
        payload: { projectPath: "/test" },
        requestId: "req-1",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockProjectManager.openProject).toHaveBeenCalledWith(
        "/test",
        undefined,
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("project_opened"),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("req-1"),
      );
    });

    it("should handle get_graph_data message", async () => {
      const mockGraph = { files: {}, edges: [] };
      (mockProjectManager.getProject as any).mockReturnValue({
        graph: mockGraph,
      });

      const messageHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "message",
      )[1];

      const payload = {
        type: "get_graph_data",
        payload: { projectPath: "/test" },
        requestId: "req-2",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("graph_data"),
      );
      const response = JSON.parse(mockWs.send.mock.calls[0][0]);
      expect(response.payload).toEqual(mockGraph);
    });

    it("should handle call_tool message", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "message",
      )[1];

      const payload = {
        type: "call_tool",
        payload: { name: "open_project", arguments: { projectPath: "/test" } },
        requestId: "req-3",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("tool_result"),
      );
    });

    it("should handle unknown message type", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "message",
      )[1];
      await messageHandler(JSON.stringify({ type: "unknown", payload: {} }));
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Unknown message type"),
      );
    });

    it("should handle malformed JSON in websocket", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "message",
      )[1];
      await messageHandler("not-json");
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("error"),
      );
    });
  });

  describe("Self-Termination", () => {
    it("should start exit countdown when last connection drops", async () => {
      vi.useFakeTimers();
      process.env.NODE_ENV = "production";

      server.startWebSocketServer();
      const wssInstance = (WebSocketServer as any).mock.instances[0];
      const connectionHandler = wssInstance.on.mock.calls.find(
        (args: any) => args[0] === "connection",
      )[1];

      const mockWs = { on: vi.fn(), send: vi.fn() };
      connectionHandler(mockWs);

      const closeHandler = mockWs.on.mock.calls.find(
        (args: any) => args[0] === "close",
      )![1];
      closeHandler();

      // Countdown started
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockProjectManager.closeAll).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
      
      vi.useRealTimers();
    });
  });
});
