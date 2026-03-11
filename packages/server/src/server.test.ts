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
    vi.mocked(mockProjectManager.openProject).mockResolvedValue({
      projectPath: "/test",
      sqlitePath: "/test/db.sqlite",
      extensions: [],
    } as any);
    vi.mocked(mockProjectManager.getDatabaseData).mockResolvedValue({
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    });
    vi.mocked(mockProjectManager.getAllExtensions).mockReturnValue([]);
    server = new BackendServer(mockProjectManager, 3030);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("MCP Tool Handlers", () => {
    it("should handle open_project tool", async () => {
      const args = { projectPath: "/test" };
      const result = await server.handleCallTool({
        name: "open_project",
        args: args,
      });

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
      const mockResult = {
        definitions: [
          {
            type: "definition" as const,
            kind: "component",
            name: "App",
            file: "src/App.tsx",
            loc: { line: 1, column: 1 },
            usages: [],
          },
        ],
        externalUsages: [],
      };

      vi.mocked(mockProjectManager.findSymbol).mockResolvedValue(mockResult);

      const args = { projectPath: "/test", query: "App", usages: true };
      const result = await server.handleCallTool({
        name: "get_symbol_info",
        args: args,
      });

      expect(mockProjectManager.findSymbol).toHaveBeenCalledWith(
        "/test",
        "App",
        undefined,
        true,
        false,
        true,
        expect.arrayContaining(["**/node_modules/**"]),
      );

      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as {
        definitions: (SymbolInfoResult & { usages?: SymbolInfoResult[] })[];
        externalUsages: SymbolInfoResult[];
      };
      expect(content.definitions).toHaveLength(1);
      expect(content.definitions[0].name).toBe("App");
      expect(content.definitions[0].type).toBe("definition");
      expect(content.definitions[0].usages).toHaveLength(0);
      expect(content.externalUsages).toHaveLength(0);
    });

    it("should handle get_symbol_info tool with loc: false", async () => {
      const mockResult = {
        definitions: [
          {
            type: "definition" as const,
            kind: "component",
            name: "App",
            file: "src/App.tsx",
            loc: { line: 1, column: 1 },
            usages: [],
          },
        ],
        externalUsages: [],
      };

      vi.mocked(mockProjectManager.findSymbol).mockResolvedValue(mockResult);

      const args = { projectPath: "/test", query: "App", loc: false };
      const result = await server.handleCallTool({
        name: "get_symbol_info",
        args: args,
      });

      expect(mockProjectManager.findSymbol).toHaveBeenCalledWith(
        "/test",
        "App",
        undefined,
        true,
        false,
        false,
        expect.any(Array),
      );

      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as {
        definitions: (SymbolInfoResult & { usages?: SymbolInfoResult[] })[];
        externalUsages: SymbolInfoResult[];
      };
      expect(content.definitions[0].loc).toBeUndefined();
    });

    it("should handle get_symbol_info tool with nested and external usages", async () => {
      const mockResult = {
        definitions: [
          {
            kind: "component",
            name: "Button",
            file: "src/components/Button.tsx",
            loc: { line: 1, column: 1 },
            usages: [
              {
                kind: "render",
                name: "Button",
                file: "src/App.tsx",
                loc: { line: 10, column: 5 },
                in: "App",
              },
            ],
          },
        ],
        externalUsages: [
          {
            kind: "render",
            name: "ExternalComponent",
            file: "src/External.tsx",
            loc: { line: 5, column: 1 },
            in: "Unknown",
          },
        ],
      };

      vi.mocked(mockProjectManager.findSymbol).mockResolvedValue(mockResult);

      const args = { projectPath: "/test", query: "Button", usages: true };
      const result = await server.handleCallTool({
        name: "get_symbol_info",
        args: args,
      });

      expect(mockProjectManager.findSymbol).toHaveBeenCalledWith(
        "/test",
        "Button",
        undefined,
        true,
        false,
        true,
        expect.any(Array),
      );

      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as {
        definitions: (SymbolInfoResult & { usages?: SymbolInfoResult[] })[];
        externalUsages: SymbolInfoResult[];
      };

      expect(content.definitions).toHaveLength(1);
      expect(content.definitions[0].usages).toHaveLength(1);
      expect(content.definitions[0].usages![0].name).toBe("Button");
      expect(content.externalUsages).toHaveLength(1);
      expect(content.externalUsages[0].name).toBe("ExternalComponent");
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

      vi.mocked(mockProjectManager.openProject).mockResolvedValue({
        projectPath: "/test",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });

      const args = { projectPath: "/test" };
      const result = await server.handleCallTool({
        name: "list_files",
        args: args,
      });

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
      const result = await server.handleCallTool({
        name: "read_file",
        args: args,
      });
      expect((result as { content: { text: string }[] }).content[0].text).toBe(
        "file content",
      );
    });

    it("should handle grep_search tool", async () => {
      const mockResult = [{ file: "src/App.tsx", line: 1, content: "import" }];
      vi.mocked(mockProjectManager.grepSearch).mockResolvedValue(mockResult);
      const args = { projectPath: "/test", pattern: "import" };
      const result = await server.handleCallTool({
        name: "grep_search",
        args: args,
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should open project automatically for list_files tool", async () => {
      const mockGraph = { files: {} };
      vi.mocked(mockProjectManager.openProject).mockResolvedValue({
        projectPath: "/p",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });

      const result = await server.handleCallTool({
        name: "list_files",
        args: {
          projectPath: "/p",
        },
      });
      expect(result).toBeDefined();
      expect(mockProjectManager.openProject).toHaveBeenCalledWith(
        "/p",
        undefined,
      );
    });

    it("should handle labeling tools", async () => {
      vi.mocked(mockProjectManager.addLabel).mockResolvedValue(["tag1"]);
      const addResult = await server.handleCallTool({
        name: "add_label",
        args: {
          projectPath: "/p",
          id: "id1",
          label: "tag1",
        },
      });
      expect(
        JSON.parse(
          (addResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(["tag1"]);

      vi.mocked(mockProjectManager.getLabels).mockResolvedValue({
        id1: ["tag1"],
      });
      const listResult = await server.handleCallTool({
        name: "list_labels",
        args: {
          projectPath: "/p",
        },
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
      const searchResult = await server.handleCallTool({
        name: "search_by_label",
        args: {
          projectPath: "/p",
          label: "tag1",
        },
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
      const dirResult = await server.handleCallTool({
        name: "list_directory",
        args: {
          projectPath: "/p",
          dirPath: "src",
        },
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
      const outlineResult = await server.handleCallTool({
        name: "get_file_outline",
        args: {
          projectPath: "/p",
          filePath: "f1",
        },
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
      const locResult = await server.handleCallTool({
        name: "get_symbol_location",
        args: {
          projectPath: "/p",
          query: "S",
        },
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
      const contentResult = await server.handleCallTool({
        name: "get_symbol_content",
        args: {
          projectPath: "/p",
          query: "S",
        },
      });
      expect(
        JSON.parse(
          (contentResult as { content: { text: string }[] }).content[0].text,
        ),
      ).toEqual(mockContent);
    });

    it("should handle find_files tool", async () => {
      const mockResult = ["src/App.tsx"];
      vi.mocked(mockProjectManager.findFiles).mockResolvedValue(mockResult);
      const result = await server.handleCallTool({
        name: "find_files",
        args: {
          projectPath: "/p",
          pattern: "App",
        },
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
      const result = await server.handleCallTool({
        name: "get_file_imports",
        args: {
          projectPath: "/p",
          filePath: "f1",
        },
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
      const result = await server.handleCallTool({
        name: "get_project_tree",
        args: {
          projectPath: "/p",
        },
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
      const result = await server.handleCallTool({
        name: "get_component_hierarchy",
        args: {
          projectPath: "/p",
          componentName: "App",
        },
      });
      expect(
        JSON.parse((result as { content: { text: string }[] }).content[0].text),
      ).toEqual(mockResult);
    });

    it("should handle run_shell_command tool", async () => {
      const mockResult = { stdout: "ok", stderr: "", exitCode: 0 };
      vi.mocked(mockProjectManager.runShellCommand).mockResolvedValue(
        mockResult,
      );
      const result = await server.handleCallTool({
        name: "run_shell_command",
        args: {
          projectPath: "/p",
          command: "ls",
        },
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
      vi.mocked(mockProjectManager.openProject).mockResolvedValue({
        projectPath: "/p",
        extensions: [],
        sqlitePath: "test.sqlite",
        graph: mockGraph as unknown as JsonData,
      });
      const result = await server.handleCallTool({
        name: "list_files",
        args: {
          projectPath: "/p",
        },
      });
      const content = JSON.parse(
        (result as { content: { text: string }[] }).content[0].text,
      ) as { totalFiles: number; files: { path: string; exports?: unknown }[] };
      expect(content.totalFiles).toBe(101);
      expect(content.files[0]).not.toHaveProperty("exports");
    });

    it("should return error if tool is unknown", async () => {
      await expect(
        server.handleCallTool({
          name: "unknown_tool",
          args: {},
        }),
      ).rejects.toThrow("Unknown tool");
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
      const result = await server.handleCallTool({
        name: "ext1_tool1",
        args: { some: "arg" },
      });
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
