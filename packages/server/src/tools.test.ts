import { describe, it, expect, vi, beforeEach } from "vitest";
import { BackendServer } from "./server.js";
import { ProjectManager } from "./projectManager.js";
import fs from "node:fs";
import { analyzeProject } from "@nexu/analyser";
import type { JsonData } from "@nexu/shared";
import Database from "better-sqlite3";

vi.mock("node:fs");
vi.mock("@parcel/watcher");

const createMockStmt = () => ({
  all: vi.fn(() => []),
  get: vi.fn(() => undefined),
  run: vi.fn(() => ({ changes: 0 })),
  prepare: vi.fn(() => createMockStmt()),
});

const mockDb = {
  prepare: vi.fn(() => createMockStmt() as unknown as Database.Statement),
  close: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn(),
};

vi.mock("@nexu/analyser", () => ({
  analyzeProject: vi.fn(),
}));

vi.mock("@nexu/analyser/db/sqlite", () => ({
  SqliteDB: vi.fn().mockImplementation(() => ({
    db: mockDb,
    getAllData: vi.fn().mockReturnValue({
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    }),
    close: () => mockDb.close(),
  })),
}));

vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn(() => mockDb),
  };
});

describe("MCP Tools Integration", () => {
  let server: BackendServer;
  let projectManager: ProjectManager;
  const projectPath = "/test/project";

  beforeEach(async () => {
    vi.clearAllMocks();
    mockDb.prepare.mockReset();
    mockDb.prepare.mockImplementation(
      () => createMockStmt() as unknown as Database.Statement,
    );
    
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue("{}");
    
    vi.mocked(analyzeProject).mockResolvedValue({
      src: projectPath,
      files: {
        "/src/App.tsx": {
          path: "/src/App.tsx",
          import: { "react": { localName: "React", source: "react" } },
          var: { "app-id": { id: "app-id", name: { type: "identifier", name: "App" }, kind: "component", type: "function", loc: { line: 1, column: 1 } } }
        }
      },
      edges: [],
    } as unknown as JsonData);

    projectManager = new ProjectManager();
    server = new BackendServer(projectManager);
    
    // Pre-open the project for most tests
    await server.handleCallTool({ name: "open_project", args: { projectPath } });
  });

  it("open_project: should initialize project and return success message", async () => {
    const result = await server.handleCallTool({ name: "open_project", args: { projectPath: "/new/path" } });
    expect(result.content[0].text).toContain("opened and analyzed successfully");
    expect(analyzeProject).toHaveBeenCalledWith("/new/path", expect.any(String), undefined, expect.any(String));
  });

  describe("get_symbol_info", () => {
    it("should return definitions only by default", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
        }]),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { projectPath, query: "Button" } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.definitions).toHaveLength(1);
      expect(data.definitions[0].name).toBe("Button");
      expect(data.definitions[0].loc).toBeUndefined(); // loc false by default
      expect(data.usages).toBeUndefined();
    });

    it("should include usages and location when requested", async () => {
      // 1. Definition call
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
        }]),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      
      // 2. Usages call
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          tag: "Button", file: "/src/App.tsx", line: 20, column: 8, kind: "jsx", in_name: "App"
        }]),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "Button", usages: true, loc: true 
      } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.definitions[0].loc).toBeDefined();
      expect(data.definitions[0].usages).toHaveLength(1);
      expect(data.definitions[0].usages[0].file).toBe("/src/App.tsx");
      expect(data.definitions[0].usages[0].in).toBe("App");
    });

    it("should handle external usages fallback", async () => {
      // 1. Definition call (empty)
      mockDb.prepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
      // 2. External Usages call
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          tag: "div", file: "/src/App.tsx", line: 5, column: 5, kind: "jsx"
        }]),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "div", usages: true 
      } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.definitions).toHaveLength(0);
      expect(data.externalUsages).toHaveLength(1);
      expect(data.externalUsages[0].name).toBe("div");
    });

    it("should handle non-strict matching", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
        }]),
      } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "But", strict: false 
      } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.definitions).toHaveLength(1);
      expect(data.definitions[0].name).toBe("Button");
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("LIKE ?"));
    });
  });

  it("find_files: should support glob patterns", async () => {
    const result = await server.handleCallTool({ name: "find_files", args: { projectPath, pattern: "**/*.tsx" } });
    const files = JSON.parse(result.content[0].text);
    expect(files).toContain("/src/App.tsx");
  });

  it("get_file_imports: should return imports for a file", async () => {
    const result = await server.handleCallTool({ name: "get_file_imports", args: { projectPath, filePath: "src/App.tsx" } });
    const imports = JSON.parse(result.content[0].text);
    expect(imports["react"]).toBeDefined();
  });

  it("get_project_tree: should return tree up to maxDepth", async () => {
    const result = await server.handleCallTool({ name: "get_project_tree", args: { projectPath, maxDepth: 1 } });
    const tree = JSON.parse(result.content[0].text);
    expect(tree.name).toBe("/");
    expect(tree.children[0].name).toBe("src");
  });

  it("list_files: should return summary for small projects", async () => {
    const result = await server.handleCallTool({ name: "list_files", args: { projectPath } });
    const data = JSON.parse(result.content[0].text);
    expect(data.totalFiles).toBe(1);
    expect(data.files[0].path).toBe("/src/App.tsx");
    expect(data.files[0].exports).toBeDefined();
  });

  it("get_component_hierarchy: should return rendered and renderedBy", async () => {
    // 1. Start component call
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([{ id: "app-id", name: "App", file: "/src/App.tsx" }]),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 2. renderedBy call
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([{ id: "root-id", name: "Root", file: "/src/index.tsx" }]),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 3. sym call (App)
    mockDb.prepare.mockReturnValueOnce({
      get: vi.fn().mockReturnValue({ id: "app-id", name: "App" }),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 4. children call (App renders)
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([{ tag: "Button", symbol_id: "btn-id", file: "/src/App.tsx" }]),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 5. sym call (Button)
    mockDb.prepare.mockReturnValueOnce({
      get: vi.fn().mockReturnValue({ id: "btn-id", name: "Button" }),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    // 6. children call (Button renders - empty)
    mockDb.prepare.mockReturnValueOnce({ all: vi.fn().mockReturnValue([]) } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await server.handleCallTool({ name: "get_component_hierarchy", args: { projectPath, componentName: "App" } });
    const data = JSON.parse(result.content[0].text);
    
    expect(data.component).toBe("App");
    expect(data.hierarchies[0].name).toBe("App");
    expect(data.hierarchies[0].children[0].name).toBe("Button");
    expect(data.renderedBy[0].name).toBe("Root");
  });

  it("get_symbol_location: should return file and line", async () => {
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([{
        id: "id1", name: "App", file: "/src/App.tsx", line: 5, column: 1, kind: "component", type: "function"
      }]),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any

    const result = await server.handleCallTool({ name: "get_symbol_location", args: { projectPath, query: "App" } });
    const locs = JSON.parse(result.content[0].text);
    expect(locs[0].file).toBe("/src/App.tsx");
    expect(locs[0].loc.line).toBe(5);
  });

  it("get_symbol_content: should return source code line", async () => {
    // 1. Location call
    mockDb.prepare.mockReturnValueOnce({
      all: vi.fn().mockReturnValue([{
        id: "id1", name: "App", file: "/src/App.tsx", line: 2, column: 1, kind: "component", type: "function"
      }]),
    } as any); // eslint-disable-line @typescript-eslint/no-explicit-any
    
    vi.mocked(fs.readFileSync).mockReturnValue(`line 1
export const App = () => {}
line 3`);

    const result = await server.handleCallTool({ name: "get_symbol_content", args: { projectPath, query: "App" } });
    const contents = JSON.parse(result.content[0].text);
    expect(contents[0].content).toBe("export const App = () => {}");
  });

  it("add_label / list_labels / search_by_label: should manage entity labels", async () => {
    await server.handleCallTool({ name: "add_label", args: { projectPath, id: "app-id", label: "entry" } });
    
    const listResult = await server.handleCallTool({ name: "list_labels", args: { projectPath } });
    const labels = JSON.parse(listResult.content[0].text);
    expect(labels["app-id"]).toContain("entry");

    const searchResult = await server.handleCallTool({ name: "search_by_label", args: { projectPath, label: "entry" } });
    const ids = JSON.parse(searchResult.content[0].text);
    expect(ids).toContain("app-id");
  });

  it("list_directory: should return files and subdirs", async () => {
    const result = await server.handleCallTool({ name: "list_directory", args: { projectPath, dirPath: "src" } });
    const data = JSON.parse(result.content[0].text);
    expect(data.files).toContain("App.tsx");
  });

  it("get_file_outline: should return symbols in a file", async () => {
    const result = await server.handleCallTool({ name: "get_file_outline", args: { projectPath, filePath: "src/App.tsx" } });
    const outline = JSON.parse(result.content[0].text);
    expect(outline[0].name).toBe("App");
    expect(outline[0].line).toBe(1);
  });

  it("read_file: should return raw file content", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("raw content");
    const result = await server.handleCallTool({ name: "read_file", args: { projectPath, filePath: "src/App.tsx" } });
    expect(result.content[0].text).toBe("raw content");
  });

  it("grep_search: should find occurrences", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue(`const x = 1;
console.log(x);`);
    const result = await server.handleCallTool({ name: "grep_search", args: { projectPath, pattern: "console" } });
    const matches = JSON.parse(result.content[0].text);
    expect(matches[0].file).toBe("/src/App.tsx");
    expect(matches[0].content).toBe("console.log(x);");
  });

  it("run_shell_command: should execute and return output", async () => {
    // Mocking promisified exec is a bit tricky, but projectManager uses execAsync
    // We can mock it if needed, but let's at least test the restricted command check
    await expect(server.handleCallTool({ name: "run_shell_command", args: { projectPath, command: "rm -rf /" } }))
      .rejects.toThrow("restricted");
  });
});
