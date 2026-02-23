import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BackendServer, type SymbolInfoResult } from "./server.js";
import { ProjectManager } from "./projectManager.js";
import { WebSocketServer } from "ws";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import type { JsonData } from "shared";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

import type { Extension } from "@react-map/extension-sdk";

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
    mockProjectManager = new ProjectManager();
    vi.mocked(mockProjectManager.getAllExtensions).mockReturnValue([]);
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
      const mockResult: SymbolInfoResult[] = [
        {
          type: "definition",
          kind: "component",
          name: "App",
          file: "src/App.tsx",
          loc: { line: 1, column: 1 },
        },
      ];

      vi.mocked(mockProjectManager.findSymbol).mockResolvedValue(mockResult);

      const args = { projectPath: "/test", query: "App" };
      const result = await server.handleCallTool("get_symbol_info", args);

      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as SymbolInfoResult[];
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
                id: "v1",
                name: { type: "identifier" as const, name: "main" },
                kind: "normal" as const,
                loc: { line: 1, column: 1 },
              },
            },
          },
        },
      };

      vi.mocked(mockProjectManager.getProject).mockReturnValue({
        projectPath: "/test",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });

      const args = { projectPath: "/test" };
      const result = await server.handleCallTool("list_files", args);

      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as { totalFiles: number; files: { path: string }[] };
      expect(content.totalFiles).toBe(1);
      expect(content.files).toHaveLength(1);
      expect(content.files[0].path).toBe("src/index.ts");
    });

    it("should handle read_file tool", async () => {
      vi.mocked(mockProjectManager.readFile).mockResolvedValue("file content");
      const args = { projectPath: "/test", filePath: "src/App.tsx" };
      const result = await server.handleCallTool("read_file", args);
      expect((result as { content: { text: string }[] }).content[0].text).toBe(
        "file content",
      );
    });

    it("should handle grep_search tool", async () => {
      const mockResult = [{ file: "src/App.tsx", line: 1, content: "import" }];
      vi.mocked(mockProjectManager.grepSearch).mockResolvedValue(mockResult);
      const args = { projectPath: "/test", pattern: "import" };
      const result = await server.handleCallTool("grep_search", args);
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle list_files tool error when project not open", async () => {
      vi.mocked(mockProjectManager.getProject).mockReturnValue(undefined);
      await expect(
        server.handleCallTool("list_files", { projectPath: "/p" }),
      ).rejects.toThrow("Project not open");
    });

    it("should handle labeling tools", async () => {
      vi.mocked(mockProjectManager.addLabel).mockResolvedValue(["tag1"]);
      const addResult = await server.handleCallTool("add_label", {
        projectPath: "/p",
        id: "id1",
        label: "tag1",
      });
      expect(
        JSON.parse(
          (addResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(["tag1"]);

      vi.mocked(mockProjectManager.getLabels).mockResolvedValue({
        id1: ["tag1"],
      });
      const listResult = await server.handleCallTool("list_labels", {
        projectPath: "/p",
      });
      expect(
        JSON.parse(
          (listResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual({
        id1: ["tag1"],
      });

      vi.mocked(mockProjectManager.findEntitiesByLabel).mockResolvedValue([
        "id1",
      ]);
      const searchResult = await server.handleCallTool("search_by_label", {
        projectPath: "/p",
        label: "tag1",
      });
      expect(
        JSON.parse(
          (searchResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(["id1"]);
    });

    it("should handle enhanced navigation tools", async () => {
      const mockDir = { directories: ["d1"], files: ["f1"] };
      vi.mocked(mockProjectManager.listDirectory).mockResolvedValue(mockDir);
      const dirResult = await server.handleCallTool("list_directory", {
        projectPath: "/p",
        dirPath: "src",
      });
      expect(
        JSON.parse(
          (dirResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(mockDir);

      const mockOutline = [
        {
          name: "Comp",
          line: 1,
          id: "c1",
          kind: "component" as const,
          type: "function" as const,
        },
      ];
      vi.mocked(mockProjectManager.getFileOutline).mockResolvedValue(
        mockOutline,
      );
      const outlineResult = await server.handleCallTool("get_file_outline", {
        projectPath: "/p",
        filePath: "f1",
      });
      expect(
        JSON.parse(
          (outlineResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(mockOutline);
    });

    it("should handle symbol exploration tools", async () => {
      const mockLoc = [
        {
          file: "f1",
          line: 1,
          id: "s1",
          name: "S",
          loc: { line: 1, column: 1 },
          kind: "component",
          type: "function",
        },
      ];
      vi.mocked(mockProjectManager.getSymbolLocation).mockResolvedValue(
        mockLoc,
      );
      const locResult = await server.handleCallTool("get_symbol_location", {
        projectPath: "/p",
        query: "S",
      });
      expect(
        JSON.parse(
          (locResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(mockLoc);

      const mockContent = [
        {
          id: "s1",
          name: "S",
          file: "f1",
          loc: { line: 1, column: 1 },
          kind: "component",
          type: "function",
          content: "code",
        },
      ];
      vi.mocked(mockProjectManager.getSymbolContent).mockResolvedValue(
        mockContent,
      );
      const contentResult = await server.handleCallTool("get_symbol_content", {
        projectPath: "/p",
        query: "S",
      });
      expect(
        JSON.parse(
          (contentResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(mockContent);
    });

    it("should handle get_symbol_usages tool", async () => {
      const mockResult: SymbolInfoResult[] = [
        {
          type: "usage",
          name: "App",
          file: "src/main.tsx",
          kind: "render",
          loc: { line: 1, column: 1 },
          in: "main",
        },
      ];
      vi.mocked(mockProjectManager.findSymbolUsages).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_symbol_usages", {
        projectPath: "/p",
        query: "App",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle find_files tool", async () => {
      const mockResult = ["src/App.tsx"];
      vi.mocked(mockProjectManager.findFiles).mockResolvedValue(mockResult);
      const result = await server.handleCallTool("find_files", {
        projectPath: "/p",
        pattern: "App",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle get_file_imports tool", async () => {
      const mockResult = {
        react: {
          localName: "React",
          importedName: "React",
          source: "react",
          type: "default" as const,
          importKind: "value" as const,
        },
      };
      vi.mocked(mockProjectManager.getFileImports).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_file_imports", {
        projectPath: "/p",
        filePath: "f1",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle get_project_tree tool", async () => {
      const mockResult = { name: "/", children: [] };
      vi.mocked(mockProjectManager.getProjectTree).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_project_tree", {
        projectPath: "/p",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle get_component_hierarchy tool", async () => {
      const mockResult = { component: "App", hierarchies: [], renderedBy: [] };
      vi.mocked(mockProjectManager.getComponentHierarchy).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("get_component_hierarchy", {
        projectPath: "/p",
        componentName: "App",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle run_shell_command tool", async () => {
      const mockResult = { stdout: "ok", stderr: "" };
      vi.mocked(mockProjectManager.runShellCommand).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool("run_shell_command", {
        projectPath: "/p",
        command: "ls",
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle list_files tool with large project", async () => {
      const mockGraph = {
        files: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => [`f${i}.ts`, { var: {} }]),
        ),
      };
      vi.mocked(mockProjectManager.getProject).mockReturnValue({
        projectPath: "/p",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });
      const result = await server.handleCallTool("list_files", {
        projectPath: "/p",
      });
      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as { totalFiles: number; files: { path: string; exports?: unknown }[] };
      expect(content.totalFiles).toBe(101);
      expect(content.files[0]).not.toHaveProperty("exports");
    });

    it("should return error if tool is unknown", async () => {
      await expect(server.handleCallTool("unknown_tool", {})).rejects.toThrow(
        "Unknown tool",
      );
    });

    it("should handle list tools request", async () => {
      const listToolsHandler = vi
        .mocked((server as unknown as { mcpServer: Server }).mcpServer)
        .setRequestHandler.mock.calls.find(
          (args) => args[0] === ListToolsRequestSchema,
        )![1] as () => Promise<{ tools: unknown[] }>;
      const result = await listToolsHandler();
      expect(result.tools).toBeDefined();
      expect(
        (result.tools as { name: string }[]).some(
          (t) => t.name === "open_project",
        ),
      ).toBe(true);
    });

    it("should handle call tool request with error", async () => {
      const callToolHandler = vi
        .mocked((server as unknown as { mcpServer: Server }).mcpServer)
        .setRequestHandler.mock.calls.find(
          (args) => args[0] === CallToolRequestSchema,
        )![1] as (req: {
        params: { name: string };
      }) => Promise<{ isError: boolean }>;

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
      vi.mocked(mockProjectManager.getAllExtensions).mockReturnValue([
        mockExt as unknown as Extension,
      ]);

      // List tools
      const listToolsHandler = vi
        .mocked((server as unknown as { mcpServer: Server }).mcpServer)
        .setRequestHandler.mock.calls.find(
          (args) => args[0] === ListToolsRequestSchema,
        )![1] as () => Promise<{ tools: unknown[] }>;
      const tools = await listToolsHandler();
      expect(
        (tools.tools as { name: string }[]).some(
          (t) => t.name === "ext1_tool1",
        ),
      ).toBe(true);

      // Call tool
      const result = await server.handleCallTool("ext1_tool1", { some: "arg" });
      expect(mockExt.mcpTools[0].handler).toHaveBeenCalled();
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual({ ok: true });
    });
  });

  describe("WebSocket Handlers", () => {
    let mockWs: {
      send: ReturnType<typeof vi.fn>;
      on: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockWs = {
        send: vi.fn(),
        on: vi.fn(),
      };
      server.startWebSocketServer();
      const wssInstance = vi.mocked(WebSocketServer).mock.instances[0];
      const connectionHandler = vi
        .mocked(wssInstance.on)
        .mock.calls.find((args) => args[0] === "connection")![1] as (
        ws: unknown,
      ) => void;
      connectionHandler(mockWs);
    });

    it("should handle open_project message", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args) => args[0] === "message",
      )![1] as (msg: string) => Promise<void>;

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
      vi.mocked(mockProjectManager.getProject).mockReturnValue({
        projectPath: "/test",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });

      const messageHandler = mockWs.on.mock.calls.find(
        (args) => args[0] === "message",
      )![1] as (msg: string) => Promise<void>;

      const payload = {
        type: "get_graph_data",
        payload: { projectPath: "/test" },
        requestId: "req-2",
      };

      await messageHandler(JSON.stringify(payload));

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("graph_data"),
      );
      const response = JSON.parse(mockWs.send.mock.calls[0][0]) as {
        payload: unknown;
      };
      expect(response.payload).toEqual(mockGraph);
    });

    it("should handle call_tool message", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args) => args[0] === "message",
      )![1] as (msg: string) => Promise<void>;

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
        (args) => args[0] === "message",
      )![1] as (msg: string) => Promise<void>;
      await messageHandler(JSON.stringify({ type: "unknown", payload: {} }));
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Unknown message type"),
      );
    });

    it("should handle WebSocket server error", () => {
      server.startWebSocketServer();
      const wssInstance = vi.mocked(WebSocketServer).mock.instances[0];
      const errorHandler = vi
        .mocked(wssInstance.on)
        .mock.calls.find((args) => args[0] === "error")![1] as (
        err: unknown,
      ) => void;

      errorHandler(new Error("Test error"));
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("WebSocket server error"),
      );

      const addrInUseError = new Error("Address in use");
      (addrInUseError as unknown as Record<string, unknown>).code =
        "EADDRINUSE";
      errorHandler(addrInUseError);
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining("Port 3030 is already in use"),
      );
    });

    it("should handle malformed JSON in websocket", async () => {
      const messageHandler = mockWs.on.mock.calls.find(
        (args) => args[0] === "message",
      )![1] as (msg: string) => Promise<void>;
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
      const wssInstance = vi.mocked(WebSocketServer).mock.instances[0];
      const connectionHandler = vi
        .mocked(wssInstance.on)
        .mock.calls.find((args) => args[0] === "connection")![1] as (
        ws: unknown,
      ) => void;

      const mockWs = { on: vi.fn(), send: vi.fn() };
      connectionHandler(mockWs);

      const closeHandler = mockWs.on.mock.calls.find(
        (args) => args[0] === "close",
      )![1] as () => void;
      closeHandler();

      // Countdown started
      await vi.advanceTimersByTimeAsync(10000);

      expect(mockProjectManager.closeAll).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);

      vi.useRealTimers();
    });
  });
});
