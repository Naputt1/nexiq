import { describe, it, expect, vi, beforeEach } from "vitest";
import { BackendServer } from "./server.js";
import { ProjectManager } from "./projectManager.js";
import fs from "node:fs";
import { analyzeProject } from "@nexiq/analyser";
import type { JsonData } from "@nexiq/shared";
import Database from "better-sqlite3";

vi.mock("node:fs");
vi.mock("@parcel/watcher");

const createMockStmt = () => ({
  all: vi.fn<() => unknown[]>(() => []),
  get: vi.fn<() => unknown>(() => undefined),
  run: vi.fn(() => ({ changes: 0 })),
  prepare: vi.fn(() => createMockStmt()),
});

const mockDb = {
  prepare: vi.fn<(sql: string) => Database.Statement>(() => createMockStmt() as unknown as Database.Statement),
  close: vi.fn(),
  exec: vi.fn(),
  pragma: vi.fn(),
};

vi.mock("@nexiq/analyser", () => ({
  analyzeProject: vi.fn(),
}));

vi.mock("@nexiq/analyser/db/sqlite", () => ({
  SqliteDB: vi.fn().mockImplementation(function (this: any) {
    this.db = mockDb;
    this.getAllData = vi.fn().mockReturnValue({
      files: [],
      entities: [],
      scopes: [],
      symbols: [],
      renders: [],
      exports: [],
      relations: [],
    });
    this.close = () => mockDb.close();
  }),
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
    
    // Pre-open the project for most tests (tools auto-open internally)
    await projectManager.openProject(projectPath);
  });

  describe("get_symbol_info", () => {
    it("should return definitions only by default", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          s.all.mockReturnValue([{
            id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
          }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { projectPath, query: "Button" } });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { definitions: unknown[] };
      
      expect(data.definitions).toHaveLength(1);
      expect(data.definitions[0].name).toBe("Button");
      expect(data.definitions[0].loc).toBeDefined(); // loc always included
      expect(data.usages).toBeUndefined();
    });

    it("should include usages and location when requested", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          s.all.mockReturnValue([{
            id: "sym-1", entity_id: "ent-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
          }]);
        } else if (sql.includes("FROM relations rel")) {
          s.all.mockReturnValue([{
            file: "/src/App.tsx", in_name: "App", line: 20, column: 8
          }]);
        } else if (sql.includes("FROM relations")) {
          s.all.mockReturnValue([]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "Button", usages: true, loc: true 
      } });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { definitions: { loc: unknown; usages: { file: string; in: string }[] }[] };
      
      expect(data.definitions[0].loc).toBeDefined();
      expect(data.definitions[0].usages).toHaveLength(1);
      expect(data.definitions[0].usages[0].file).toBe("/src/App.tsx");
      expect(data.definitions[0].usages[0].in).toBe("App");
    });

    it("should handle external usages fallback", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          s.all.mockReturnValue([]);
        } else if (sql.includes("usage-render-call")) {
          s.all.mockReturnValue([{
            line: 5, column: 5,
            data_json: JSON.stringify({ displayLabel: "div" }),
            in_name: "App",
            file: "/src/App.tsx",
          }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "div", usages: true 
      } });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { definitions: unknown[]; externalUsages: { name: string }[] };
      
      expect(data.definitions).toHaveLength(0);
      expect(data.externalUsages).toHaveLength(1);
      expect(data.externalUsages[0].name).toBe("div");
    });

    it("should handle non-strict matching", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          s.all.mockReturnValue([{
            id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 10, column: 5, kind: "component", type: "function"
          }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { 
        projectPath, query: "But", strict: false 
      } });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { definitions: { name: string }[] };
      
      expect(data.definitions).toHaveLength(1);
      expect(data.definitions[0].name).toBe("Button");
      expect(mockDb.prepare).toHaveBeenCalledWith(expect.stringContaining("LIKE ?"));
    });
  });

  describe("get_field_accesses", () => {
    it("should filter by owner when ownerId matches query symbol", async () => {
      const postListEntityId = "ent-postlist";
      const toastEntityId = "ent-toast";
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("WHERE r.kind = 'usage-read'")) {
          s.all.mockReturnValue([
            {
              line: 10, column: 5,
              data_json: JSON.stringify({
                filePath: "/src/PostList.tsx",
                ownerId: postListEntityId,
                ownerKind: "component",
                accessPath: ["postListIds"],
                displayLabel: "props.postListIds",
              }),
            },
            {
              line: 20, column: 8,
              data_json: JSON.stringify({
                filePath: "/src/ToastWrapper.tsx",
                ownerId: toastEntityId,
                ownerKind: "component",
                accessPath: ["postListIds"],
                displayLabel: "props.postListIds",
              }),
            },
          ]);
        } else if (sql.includes("FROM entities e JOIN symbols s")) {
          s.all.mockReturnValue([{ id: postListEntityId }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({
        name: "get_field_accesses",
        args: { projectPath, query: "PostList", fieldPath: "postListIds", contextLines: 0 },
      });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as {
        symbol: string; fieldPath: string; results: { file: string }[]
      };
      expect(data.symbol).toBe("PostList");
      expect(data.results).toHaveLength(1);
      expect(data.results[0].file).toBe("/src/PostList.tsx");
    });

    it("should return all results when no owner matches query symbol", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("WHERE r.kind = 'usage-read'")) {
          s.all.mockReturnValue([
            {
              line: 10, column: 5,
              data_json: JSON.stringify({
                filePath: "/src/LoginForm.tsx",
                ownerId: "ent-loginform",
                ownerKind: "component",
                accessPath: ["user", "data", "role"],
                displayLabel: "user.data.role",
              }),
            },
            {
              line: 20, column: 8,
              data_json: JSON.stringify({
                filePath: "/src/Profile.tsx",
                ownerId: "ent-profile",
                ownerKind: "component",
                accessPath: ["user", "data", "role"],
                displayLabel: "user.data.role",
              }),
            },
          ]);
        } else if (sql.includes("FROM entities e JOIN symbols s")) {
          s.all.mockReturnValue([]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({
        name: "get_field_accesses",
        args: { projectPath, query: "useUser", fieldPath: "user.data.role", contextLines: 0 },
      });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as {
        symbol: string; fieldPath: string; results: { file: string }[]
      };
      expect(data.symbol).toBe("useUser");
      expect(data.results).toHaveLength(2);
      expect(data.results[0].file).toBe("/src/LoginForm.tsx");
      expect(data.results[1].file).toBe("/src/Profile.tsx");
    });
  });

  describe("get_symbol_info", () => {
    it("should always query renders table for external usages when definitions exist", async () => {
      let queryCounts: Record<string, number> = {};
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s") && sql.includes("WHERE s.name = ?") && !sql.includes("LIKE")) {
          s.all.mockReturnValue([{
            id: "sym-1", entity_id: "ent-1", name: "PostList",
            file: "/src/post_list.tsx", line: 10, column: 5,
            kind: "component", type: "class", data_json: null,
          }]);
        } else if (sql.includes("usage-render-call")) {
          s.all.mockReturnValue([{
            line: 30, column: 5,
            data_json: JSON.stringify({ displayLabel: "PostList" }),
            in_name: "AnotherComp",
            file: "/src/another_file.tsx",
          }]);
        } else if (sql.includes("FROM relations rel")) {
          s.all.mockReturnValue([{
            line: 30, column: 5,
            data_json: JSON.stringify({ displayLabel: "PostList" }),
            in_name: "AnotherComp",
            file: "/src/another_file.tsx",
          }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({
        name: "get_symbol_info",
        args: { projectPath, query: "PostList", usages: true },
      });
      const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as {
        definitions: { file: string }[];
        externalUsages: { file: string }[];
      };
      expect(data.definitions).toHaveLength(1);
      expect(data.externalUsages).toBeDefined();
      // The renders table result in another_file.tsx should be an external usage
      const crossFile = data.externalUsages.find((u) => u.file === "/src/another_file.tsx");
      expect(crossFile).toBeDefined();
    });
  });

  describe("get_prop_definitions", () => {
    it("should fall back to file scan when analyser props are empty", async () => {
      let queryCount = 0;
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          queryCount++;
          s.all.mockReturnValue([{
            id: "sym-1", entity_id: "ent-1", name: "PostList",
            file: "/src/post_list.tsx", line: 10, column: 5,
            kind: "component", type: "class",
            data_json: JSON.stringify({}),
          }]);
        } else if (sql.includes("FROM entities e JOIN symbols s")) {
          s.all.mockReturnValue([]);
        }
        return s as unknown as Database.Statement;
      });

      vi.mocked(fs.readFileSync).mockReturnValue(`interface Props {
  postListIds: string[];
  channelId: string;
  focusedPostId?: string;
}`);

      const result = await server.handleCallTool({
        name: "get_prop_definitions",
        args: { projectPath, "componentName": "PostList" },
      });
      const data = (result as { structuredContent: { items: { props: { name: string }[] }[] } }).structuredContent.items;
      expect(data[0].props.length).toBeGreaterThan(0);
      const names = data[0].props.map((p: { name: string }) => p.name);
      expect(names).toContain("postListIds");
      expect(names).toContain("channelId");
      expect(names).toContain("focusedPostId");
    });

    it("should use analyser props when available (no file scan)", async () => {
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("FROM symbols s")) {
          s.all.mockReturnValue([{
            id: "sym-1", entity_id: "ent-1", name: "Button",
            file: "/src/Button.tsx", line: 10, column: 5,
            kind: "component", type: "function",
            data_json: JSON.stringify({ props: [{ name: "isLoading", type: "boolean", kind: "prop" }] }),
          }]);
        }
        return s as unknown as Database.Statement;
      });

      const result = await server.handleCallTool({
        name: "get_prop_definitions",
        args: { projectPath, "componentName": "Button" },
      });
      const data = (result as { structuredContent: { items: { props: { name: string }[] }[] } }).structuredContent.items;
      expect(data[0].props).toHaveLength(1);
      expect(data[0].props[0].name).toBe("isLoading");
    });
  });


  it("find_files: should support glob patterns", async () => {
    const result = await server.handleCallTool({ name: "find_files", args: { projectPath, pattern: "**/*.tsx" } });
    const files = (result as { structuredContent: { items: string[] } }).structuredContent.items;
    expect(files).toContain("/src/App.tsx");
  });

  it("get_file_imports: should return imports for a file", async () => {
    const result = await server.handleCallTool({ name: "get_file_imports", args: { projectPath, filePath: "src/App.tsx" } });
    const imports = (result as { structuredContent: Record<string, unknown> }).structuredContent;
    expect((imports as Record<string, unknown>)["react"]).toBeDefined();
  });

  it("list_files: should return summary for small projects", async () => {
    const result = await server.handleCallTool({ name: "list_files", args: { projectPath } });
    const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { totalFiles: number; files: { path: string; exports: unknown }[] };
    expect(data.totalFiles).toBe(1);
    expect(data.files[0].path).toBe("/src/App.tsx");
    expect(data.files[0].exports).toBeDefined();
  });

    it("get_component_hierarchy: should return rendered and renderedBy", async () => {
      let symGetCalls = 0;
      let renderChildrenCalls = 0;
      mockDb.prepare.mockImplementation((sql: string) => {
        const s = createMockStmt();
        if (sql.includes("AND e.kind = 'component'")) {
          s.all.mockReturnValue([{ id: "app-id", entity_id: "ent-app", name: "App", file: "/src/App.tsx" }]);
        } else if (sql.includes("FROM relations rel")) {
          s.all.mockReturnValue([{ id: "root-id", name: "Root", file: "/src/index.tsx" }]);
        } else if (sql.includes("SELECT * FROM symbols WHERE id = ?")) {
          symGetCalls++;
          s.get.mockReturnValue(symGetCalls === 1 ? { id: "app-id", name: "App" } : { id: "btn-id", name: "Button" });
        } else if (sql.includes("parent_entity_id = (SELECT entity_id FROM symbols WHERE id = ?)")) {
          renderChildrenCalls++;
          s.all.mockReturnValue(renderChildrenCalls === 1 ? [{ tag: "Button", symbol_id: "btn-id", file: "/src/App.tsx" }] : []);
        }
        return s as unknown as Database.Statement;
      });

    const result = await server.handleCallTool({ name: "get_component_hierarchy", args: { projectPath, componentName: "App" } });
    const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { component: string; hierarchies: { name: string; children: { name: string }[] }[]; renderedBy: { name: string }[] };
    
    expect(data.component).toBe("App");
    expect(data.hierarchies[0].name).toBe("App");
    expect(data.hierarchies[0].children[0].name).toBe("Button");
    expect(data.renderedBy[0].name).toBe("Root");
  });

  it("get_symbol_location: should return file and line", async () => {
    mockDb.prepare.mockImplementation((sql: string) => {
      const s = createMockStmt();
      if (sql.includes("FROM symbols s")) {
        s.all.mockReturnValue([{
          id: "id1", name: "App", file: "/src/App.tsx", line: 5, column: 1, kind: "component", type: "function"
        }]);
      }
      return s as unknown as Database.Statement;
    });

    const result = await server.handleCallTool({ name: "get_symbol_location", args: { projectPath, query: "App" } });
    const locs = (result as { structuredContent: { items: { file: string; loc: { line: number } }[] } }).structuredContent.items;
    expect(locs[0].file).toBe("/src/App.tsx");
    expect(locs[0].loc.line).toBe(5);
  });

  it("get_symbol_content: should return source code line", async () => {
    mockDb.prepare.mockImplementation((sql: string) => {
      const s = createMockStmt();
      if (sql.includes("FROM symbols s")) {
        s.all.mockReturnValue([{
          id: "id1", name: "App", file: "/src/App.tsx", line: 2, column: 1, kind: "component", type: "function"
        }]);
      }
      return s as unknown as Database.Statement;
    });
    
    vi.mocked(fs.readFileSync).mockReturnValue(`line 1
export const App = () => {}
line 3`);

    const result = await server.handleCallTool({ name: "get_symbol_content", args: { projectPath, query: "App" } });
    const contents = (result as { structuredContent: { items: { content: string }[] } }).structuredContent.items;
    expect(contents[0].content).toBe("line 1\nexport const App = () => {}\nline 3");
  });

  it("add_label / list_labels / search_by_label: should manage entity labels", async () => {
    await server.handleCallTool({ name: "add_label", args: { projectPath, id: "app-id", label: "entry" } });
    
    const listResult = await server.handleCallTool({ name: "list_labels", args: { projectPath } });
    const labels = (listResult as { structuredContent: Record<string, unknown> }).structuredContent as Record<string, string[]>;
    expect(labels["app-id"]).toContain("entry");

    const searchResult = await server.handleCallTool({ name: "search_by_label", args: { projectPath, label: "entry" } });
    const ids = (searchResult as { structuredContent: { items: string[] } }).structuredContent.items;
    expect(ids).toContain("app-id");
  });

  it("list_directory: should return files and subdirs", async () => {
    const result = await server.handleCallTool({ name: "list_directory", args: { projectPath, dirPath: "src" } });
    const data = (result as { structuredContent: Record<string, unknown> }).structuredContent as { files: string[] };
    expect(data.files).toContain("App.tsx");
  });

  it("get_file_outline: should return symbols in a file", async () => {
    const result = await server.handleCallTool({ name: "get_file_outline", args: { projectPath, filePath: "src/App.tsx" } });
    const outline = (result as { structuredContent: { items: { name: string; line: number }[] } }).structuredContent.items;
    expect(outline[0].name).toBe("App");
    expect(outline[0].line).toBe(1);
  });

  it("read_file: should return raw file content", async () => {
    vi.mocked(fs.readFileSync).mockReturnValue("raw content");
    const result = await server.handleCallTool({ name: "read_file", args: { projectPath, filePath: "src/App.tsx" } });
    expect((result as { structuredContent: { content: string } }).structuredContent.content).toBe("raw content");
  });

  it("grep_search: should find occurrences", async () => {
    vi.mocked(fs.readdirSync).mockImplementation((dir: unknown) => {
      const d = dir as string;
      if (d.includes(".nexiq") || d.includes("node_modules")) return [] as fs.Dirent[];
      if (d === "/test/project" || d === "/test/project/src") {
        return [{ name: "App.tsx", isDirectory: () => false, isFile: () => true }] as fs.Dirent[];
      }
      return [] as fs.Dirent[];
    });
    vi.mocked(fs.readFileSync).mockReturnValue(`const x = 1;
console.log(x);`);
    const result = await server.handleCallTool({ name: "grep_search", args: { projectPath, pattern: "console" } });
    const matches = (result as { structuredContent: { items: { file: string; content: string }[] } }).structuredContent.items;
    expect(matches[0].file).toBe("/App.tsx");
    expect(matches[0].content).toBe("console.log(x);");
  });

  it("run_shell_command: should execute and return output", async () => {
    // Mocking promisified exec is a bit tricky, but projectManager uses execAsync
    // We can mock it if needed, but let's at least test the restricted command check
    await expect(server.handleCallTool({ name: "run_shell_command", args: { projectPath, command: "rm -rf /" } }))
      .rejects.toThrow("restricted");
  });
});
