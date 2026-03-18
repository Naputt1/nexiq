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

vi.mock("@nexiq/analyser", () => ({
  analyzeProject: vi.fn(),
}));

vi.mock("@nexiq/analyser/db/sqlite", () => ({
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

describe("Token Optimization Tools", () => {
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
          var: { "app-id": { id: "app-id", name: { type: "identifier", name: "App" }, kind: "component", type: "function", loc: { line: 1, column: 1 } } }
        },
        "/src/App.test.tsx": {
          path: "/src/App.test.tsx",
          var: {}
        }
      },
      edges: [],
    } as unknown as JsonData);

    projectManager = new ProjectManager();
    server = new BackendServer(projectManager);
    
    await server.handleCallTool({ name: "open_project", args: { projectPath } });
  });

  describe("get_symbol_info with filtering", () => {
    it("should exclude test files by default", async () => {
      // Definition in a test file (which should be filtered out by default)
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([
          { id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 1, column: 1, kind: "component" },
          { id: "sym-2", name: "Button", file: "/src/Button.test.tsx", line: 1, column: 1, kind: "component" }
        ]),
      } as any);

      const result = await server.handleCallTool({ name: "get_symbol_info", args: { projectPath, query: "Button" } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.definitions).toHaveLength(1);
      expect(data.definitions[0].file).toBe("/src/Button.tsx");
    });

    it("should allow custom exclude patterns", async () => {
        mockDb.prepare.mockReturnValueOnce({
          all: vi.fn().mockReturnValue([
            { id: "sym-1", name: "Button", file: "/src/Button.tsx", line: 1, column: 1, kind: "component" },
            { id: "sym-2", name: "Button", file: "/src/components/Button.tsx", line: 1, column: 1, kind: "component" }
          ]),
        } as any);
  
        const result = await server.handleCallTool({ 
            name: "get_symbol_info",
            args: {
                projectPath, 
                query: "Button",
                exclude: ["**/components/**"] 
            }
        });
        const data = JSON.parse(result.content[0].text);
        
        expect(data.definitions).toHaveLength(1);
        expect(data.definitions[0].file).toBe("/src/Button.tsx");
      });
  });

  describe("list_files with filtering", () => {
    it("should exclude node_modules and tests by default", async () => {
      const result = await server.handleCallTool({ name: "list_files", args: { projectPath } });
      const data = JSON.parse(result.content[0].text);
      
      expect(data.totalFiles).toBe(1);
      expect(data.files[0].path).toBe("/src/App.tsx");
      // App.test.tsx should be excluded
    });
  });

  describe("get_symbol_usages_with_context", () => {
    it("should return usages with source code context", async () => {
      // 1. Definition call
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          id: "btn-1", name: "Button", file: "/src/Button.tsx", line: 1, column: 1, kind: "component"
        }]),
      } as any);
      
      // 2. Usages call
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          tag: "Button", file: "/src/App.tsx", line: 3, column: 10, kind: "jsx", in_name: "App"
        }]),
      } as any);

      vi.mocked(fs.readFileSync).mockReturnValue(`import { Button } from './Button';
export const App = () => {
  return <Button>Click</Button>;
};`);

      const result = await server.handleCallTool({ 
        name: "get_symbol_usages_with_context",
        args: { 
            projectPath, query: "Button", contextLines: 1 
        }
      });
      const data = JSON.parse(result.content[0].text);
      
      expect(data).toHaveLength(1);
      expect(data[0].file).toBe("/src/App.tsx");
      expect(data[0].line).toBe(3);
      expect(data[0].context).toHaveLength(3); // line 2, 3, 4
      expect(data[0].context[1]).toContain("<Button>");
    });
  });

  describe("get_prop_definitions", () => {
    it("should return clean prop summary", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([{
          id: "btn-1", name: "Button", file: "/src/Button.tsx", line: 1, column: 1, kind: "component",
          data_json: JSON.stringify({ props: [{ name: "label", type: "string" }] })
        }]),
      } as any);

      const result = await server.handleCallTool({ 
        name: "get_prop_definitions",
        args: { 
            projectPath, componentName: "Button" 
        }
      });
      const data = JSON.parse(result.content[0].text);
      
      expect(data).toHaveLength(1);
      expect(data[0].name).toBe("Button");
      expect(data[0].props[0].name).toBe("label");
    });
  });
});
