import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectManager } from "./projectManager.js";
import fs from "node:fs";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";
import "@react-map/extension-sdk";

vi.mock("node:fs");
vi.mock("@parcel/watcher");
vi.mock("analyser");

const createMockStmt = () => ({
  all: vi.fn().mockReturnValue([]),
  get: vi.fn().mockReturnValue(undefined),
  run: vi.fn().mockReturnValue({ changes: 0 }),
});

const mockDb = {
  prepare: vi.fn().mockImplementation(() => createMockStmt()),
  close: vi.fn(),
};

vi.mock("better-sqlite3", () => {
  return {
    default: vi.fn().mockImplementation(() => mockDb),
  };
});

describe("ProjectManager", () => {
  let projectManager: ProjectManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.prepare.mockReset();
    mockDb.prepare.mockImplementation(() => createMockStmt());
    vi.spyOn(console, "error").mockImplementation(() => {});
    projectManager = new ProjectManager();
    (fs.existsSync as any).mockReturnValue(false);
    (analyzeProject as any).mockReturnValue({ files: {}, edges: [] });
  });

  it("should open a project and return project info", async () => {
    const projectPath = "/test/project";
    const info = await projectManager.openProject(projectPath);

    expect(info.projectPath).toBe(projectPath);
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining(".react-map/cache"),
      { recursive: true },
    );
    expect(analyzeProject).toHaveBeenCalledWith(
      projectPath,
      expect.any(String),
      undefined,
      expect.any(String),
    );
    expect(watcher.subscribe).toHaveBeenCalled();
  });

  it("should handle subprojects correctly", async () => {
    const projectPath = "/test/project";
    const subProject = "packages/app";
    const info = await projectManager.openProject(projectPath, subProject);

    expect(info.subProject).toBe(subProject);
    const expectedAnalysisPath = path.resolve(projectPath, subProject);
    expect(analyzeProject).toHaveBeenCalledWith(
      expectedAnalysisPath,
      expect.any(String),
      undefined,
      expect.any(String),
    );
  });

  it("should return cached project if already open", async () => {
    const projectPath = "/test/project";
    const info1 = await projectManager.openProject(projectPath);
    const info2 = await projectManager.openProject(projectPath);

    expect(info1).toBe(info2);
    expect(analyzeProject).toHaveBeenCalledTimes(1);
  });

  it("should load config and extensions if present", async () => {
    const projectPath = "/test/project";
    const configPath = path.join(projectPath, "react.map.config.json");

    (fs.existsSync as any).mockImplementation((p: string) => {
      if (p === configPath) return true;
      // Do not return true for extension file path so we use module import
      return false;
    });
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        ignorePatterns: ["*.test.ts"],
        extensions: ["@react-map/test-extension"],
      }),
    );

    // Mock dynamic import
    vi.mock("@react-map/test-extension", () => ({
      default: { id: "test-ext" },
    }));

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await projectManager.openProject(projectPath);

    expect(analyzeProject).toHaveBeenCalledWith(
      projectPath,
      expect.any(String),
      ["*.test.ts"],
      expect.any(String),
    );
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Loaded extension: test-ext"),
    );
    consoleSpy.mockRestore();
  });

  it("should handle extension load failures", async () => {
    const projectPath = "/test/project";
    const configPath = path.join(projectPath, "react.map.config.json");

    (fs.existsSync as any).mockImplementation((p: string) => p === configPath);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        extensions: ["@react-map/fail"],
      }),
    );

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await projectManager.openProject(projectPath);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Failed to load extension"),
      expect.any(String),
    );
  });

  it("should handle extension fallback import", async () => {
    const projectPath = "/test/project";
    const configPath = path.join(projectPath, "react.map.config.json");

    (fs.existsSync as any).mockImplementation((p: string) => p === configPath);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        extensions: ["@react-map/fallback"],
      }),
    );

    await projectManager.openProject(projectPath);
    // Should hit line 94
  });

  it("should close all projects and unsubscribe from watchers", async () => {
    const mockSubscription = { unsubscribe: vi.fn() };
    (watcher.subscribe as any).mockResolvedValue(mockSubscription);

    await projectManager.openProject("/p1");
    await projectManager.openProject("/p2");

    await projectManager.closeAll();

    expect(mockSubscription.unsubscribe).toHaveBeenCalledTimes(2);
    expect(projectManager.getProject("/p1")).toBeUndefined();
  });

  it("should re-analyze when watcher detects changes", async () => {
    let watcherCallback: any;
    (watcher.subscribe as any).mockImplementation((path: string, cb: any) => {
      watcherCallback = cb;
      return Promise.resolve({ unsubscribe: vi.fn() });
    });

    await projectManager.openProject("/test/project");

    // Trigger change
    const events = [{ path: "/test/project/src/NewComp.tsx", type: "update" }];
    await watcherCallback(null, events);

    expect(analyzeProject).toHaveBeenCalledTimes(2);
  });

  it("should handle watcher errors", async () => {
    let watcherCallback: any;
    (watcher.subscribe as any).mockImplementation((path: string, cb: any) => {
      watcherCallback = cb;
      return Promise.resolve({ unsubscribe: vi.fn() });
    });

    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await projectManager.openProject("/test/project");

    await watcherCallback(new Error("Watcher failed"), []);
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Watcher error"),
      expect.any(Error),
    );
  });

  describe("Labeling", () => {
    const projectPath = "/test/project";

    beforeEach(async () => {
      (analyzeProject as any).mockReturnValue({
        files: {},
        edges: [],
        labels: {},
      });
      await projectManager.openProject(projectPath);
    });

    it("should add and persist labels", async () => {
      const labels = await projectManager.addLabel(
        projectPath,
        "id1",
        "important",
      );
      expect(labels).toEqual(["important"]);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const allLabels = await projectManager.getLabels(projectPath);
      expect(allLabels["id1"]).toEqual(["important"]);
    });

    it("should remove labels", async () => {
      await projectManager.addLabel(projectPath, "id1", "tag1");
      await projectManager.addLabel(projectPath, "id1", "tag2");

      const labels = await projectManager.removeLabel(
        projectPath,
        "id1",
        "tag1",
      );
      expect(labels).toEqual(["tag2"]);

      const found = await projectManager.findEntitiesByLabel(
        projectPath,
        "tag2",
      );
      expect(found).toContain("id1");
    });

    it("should find entities by label", async () => {
      await projectManager.addLabel(projectPath, "id1", "shared");
      await projectManager.addLabel(projectPath, "id2", "shared");

      const found = await projectManager.findEntitiesByLabel(
        projectPath,
        "shared",
      );
      expect(found).toEqual(["id1", "id2"]);
    });
  });

  describe("Enhanced Navigation", () => {
    const projectPath = "/test/project";

    beforeEach(async () => {
      const mockGraph = {
        files: {
          "/src/components/Button.tsx": {
            var: {
              "btn-id": {
                id: "btn-id",
                name: { type: "identifier", name: "Button" },
                kind: "component",
                type: "function",
                loc: { line: 10, column: 1 },
                children: { r1: { tag: "div", loc: { line: 15, column: 5 } } },
                var: {
                  s1: {
                    id: "s1",
                    name: { type: "identifier", name: "count" },
                    kind: "state",
                    type: "data",
                    loc: { line: 11, column: 5 },
                  },
                },
              },
            },
          },
          "/src/utils/math.ts": { var: {} },
        },
        edges: [],
      };
      (analyzeProject as any).mockReturnValue(mockGraph);
      await projectManager.openProject(projectPath);
    });

    it("should list directories and files", async () => {
      const result = await projectManager.listDirectory(projectPath, "src");
      expect(result.directories).toEqual(["components", "utils"]);
      expect(result.files).toEqual([]);

      const components = await projectManager.listDirectory(
        projectPath,
        "src/components",
      );
      expect(components.files).toEqual(["Button.tsx"]);
    });

    it("should get file outline", async () => {
      const outline = await projectManager.getFileOutline(
        projectPath,
        "src/components/Button.tsx",
      );
      expect(outline).toHaveLength(1);
      expect(outline[0].name).toBe("Button");
    });

    it("should get component hierarchy", async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([{ id: "btn-id", name: "Button" }]),
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([]), // renderedBy call
        })
        .mockReturnValueOnce({
          get: vi.fn().mockReturnValue({ id: "btn-id", name: "Button" }), // sym call
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([{ tag: "div", symbol_id: null }]), // children call
        })
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([]),
        });

      const result = await projectManager.getComponentHierarchy(
        projectPath,
        "Button",
      );
      expect(result.component).toBe("Button");
      expect(result.hierarchies[0].name).toBe("Button");
      expect(result.hierarchies[0].children[0].name).toBe("div");
    });

    it("should throw error if file not found for outline", async () => {
      await expect(
        projectManager.getFileOutline(projectPath, "non-existent.tsx"),
      ).rejects.toThrow("File not found");
    });

    it("should throw error if project not open for listDirectory", async () => {
      await expect(
        projectManager.listDirectory("/invalid", "src"),
      ).rejects.toThrow("Project not open");
    });
  });

  describe("Efficiency Tools", () => {
    const projectPath = "/test/project";

    beforeEach(async () => {
      const mockGraph = {
        files: {
          "/src/App.tsx": {
            import: {
              useState: {
                localName: "useState",
                importedName: "useState",
                source: "react",
                type: "named",
                importKind: "value",
              },
              Button: {
                localName: "Button",
                importedName: "Button",
                source: "/src/components/Button.tsx",
                type: "named",
                importKind: "value",
              },
            },
            var: {
              "app-id": {
                id: "app-id",
                name: { type: "identifier", name: "App" },
                kind: "component",
                type: "function",
                loc: { line: 10, column: 1 },
                hooks: ["useState"],
                children: {
                  r1: { tag: "Button", loc: { line: 15, column: 5 } },
                },
              },
            },
          },
          "/src/components/Button.tsx": {
            import: {},
            var: {
              "btn-id": {
                id: "btn-id",
                name: { type: "identifier", name: "Button" },
                kind: "component",
                type: "function",
                loc: { line: 5, column: 1 },
              },
            },
          },
        },
        edges: [],
      };
      (analyzeProject as any).mockReturnValue(mockGraph);
      await projectManager.openProject(projectPath);
    });

    it("should find symbol usages", async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi
            .fn()
            .mockReturnValue([
              {
                id: "btn-id",
                name: "Button",
                kind: "component",
                file: "/src/components/Button.tsx",
                line: 5,
                column: 1,
              },
            ]),
        })
        .mockReturnValueOnce({
          all: vi
            .fn()
            .mockReturnValue([
              {
                tag: "Button",
                file: "/src/App.tsx",
                line: 15,
                column: 5,
                in_name: "App",
              },
            ]),
        });

      const results = await projectManager.findSymbolUsages(
        projectPath,
        "Button",
      );
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("usage");
      expect(results[0].file).toBe("/src/App.tsx");
    });

    it("should find symbol usages with summary", async () => {
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi
            .fn()
            .mockReturnValue([
              {
                id: "btn-id",
                name: "Button",
                kind: "component",
                file: "/src/components/Button.tsx",
                line: 5,
                column: 1,
              },
            ]),
        })
        .mockReturnValueOnce({
          all: vi
            .fn()
            .mockReturnValue([
              {
                tag: "Button",
                file: "/src/App.tsx",
                line: 15,
                column: 5,
                in_name: "App",
              },
            ]),
        });

      const results = await projectManager.findSymbolUsages(
        projectPath,
        "Button",
        undefined,
        true,
      );
      expect(results.totalUsages).toBe(1);
      expect(results.files["/src/App.tsx"]).toBe(1);
    });

    it("should find files by pattern", async () => {
      const results = await projectManager.findFiles(projectPath, "App*");
      expect(results).toEqual(["/src/App.tsx"]);

      const results2 = await projectManager.findFiles(projectPath, "Button");
      expect(results2).toEqual(["/src/components/Button.tsx"]);
    });

    it("should get file imports", async () => {
      const imports = await projectManager.getFileImports(
        projectPath,
        "/src/App.tsx",
      );
      expect(imports["useState"]).toBeDefined();
      expect(imports["Button"]).toBeDefined();
    });

    it("should get project tree", async () => {
      const tree = await projectManager.getProjectTree(
        projectPath,
        undefined,
        2,
      );
      expect(tree.name).toBe("/");
      expect(tree.children[0].name).toBe("src");
      expect(tree.children[0].children[0].name).toBe("App.tsx");
      expect(tree.children[0].children[1].name).toBe("components");
    });

    it("should find usages of external symbols", async () => {
      // 1. Return no definitions
      // 2. Return usages from external fallback
      mockDb.prepare
        .mockReturnValueOnce({
          all: vi.fn().mockReturnValue([]),
        })
        .mockReturnValueOnce({
          all: vi
            .fn()
            .mockReturnValue([
              {
                tag: "useState",
                file: "/src/App.tsx",
                line: 10,
                column: 1,
                in_name: "App",
              },
            ]),
        });

      const results = await projectManager.findSymbolUsages(
        projectPath,
        "useState",
      );
      expect(results).toHaveLength(1);
      expect(results[0].file).toBe("/src/App.tsx");
    });
  });

  describe("Symbol Location and Content", () => {
    const projectPath = "/test/project";

    beforeEach(async () => {
      const mockGraph = {
        files: {
          "/src/App.tsx": {
            var: {
              "app-id": {
                id: "app-id",
                name: { type: "identifier", name: "App" },
                kind: "component",
                type: "function",
                loc: { line: 5, column: 1 },
                scope: {
                  start: { line: 5, column: 20 },
                  end: { line: 10, column: 1 },
                },
              },
            },
          },
        },
        edges: [],
      };
      (analyzeProject as any).mockReturnValue(mockGraph);
      await projectManager.openProject(projectPath);
    });

    it("should get symbol location", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi
          .fn()
          .mockReturnValue([
            {
              id: "app-id",
              name: "App",
              file: "/src/App.tsx",
              line: 5,
              column: 1,
              kind: "component",
              type: "function",
            },
          ]),
      });
      const loc = await projectManager.getSymbolLocation(projectPath, "App");
      expect(loc).toHaveLength(1);
      expect(loc[0].file).toBe("/src/App.tsx");
      expect(loc[0].loc.line).toBe(5);
    });

    it("should get symbol content", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi
          .fn()
          .mockReturnValue([
            {
              id: "app-id",
              name: "App",
              file: "/src/App.tsx",
              line: 5,
              column: 1,
              kind: "component",
              type: "function",
            },
          ]),
      });
      const fileContent =
        "line1\nline2\nline3\nline4\nexport const App = () => {\n  return <div>App</div>\n}";
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes(".react-map/cache")) return true;
        if (p.includes("/src/App.tsx")) return true;
        return false;
      });
      (fs.readFileSync as any).mockReturnValue(fileContent);

      const content = await projectManager.getSymbolContent(projectPath, "App");
      expect(content[0].content).toContain("App");
    });

    it("should get symbol content from subproject", async () => {
      const subProject = "packages/app";
      mockDb.prepare.mockReturnValueOnce({
        all: vi
          .fn()
          .mockReturnValue([
            {
              id: "app-id",
              name: "App",
              file: "/src/App.tsx",
              line: 1,
              column: 1,
              kind: "component",
              type: "function",
            },
          ]),
      });
      await projectManager.openProject(projectPath, subProject);

      const fileContent = "export const App = () => {}";
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes(".react-map/cache")) return true;
        if (p.includes("/src/App.tsx")) return true;
        return false;
      });
      (fs.readFileSync as any).mockReturnValue(fileContent);

      const content = await projectManager.getSymbolContent(
        projectPath,
        "App",
        subProject,
      );
      expect(content[0].content).toContain("App");
    });

    it("should handle missing file on disk for content", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi
          .fn()
          .mockReturnValue([
            {
              id: "app-id",
              name: "App",
              file: "/src/App.tsx",
              line: 1,
              column: 1,
              kind: "component",
              type: "function",
            },
          ]),
      });
      (fs.existsSync as any).mockImplementation((p: string) => {
        if (p.includes(".react-map/cache")) return true;
        return false;
      });
      const content = await projectManager.getSymbolContent(projectPath, "App");
      expect(content[0].error).toBeDefined();
    });

    it("should return error if symbol not found for content", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([]),
      });
      const result = await projectManager.getSymbolContent(
        projectPath,
        "NonExistent",
      );
      expect(result.error).toBeDefined();
    });

    it("should throw error if project not open", async () => {
      await expect(
        projectManager.getSymbolLocation("/invalid", "App"),
      ).rejects.toThrow("Project not open");
    });
  });

  describe("Graph State", () => {
    const projectPath = "/test/project";

    beforeEach(async () => {
      (analyzeProject as any).mockReturnValue({
        files: {
          "/src/App.tsx": {
            var: {
              app: {
                id: "app",
                name: { type: "identifier", name: "App" },
                loc: { line: 1, column: 1 },
                kind: "component",
                ui: { x: 0, y: 0, children: {} },
                var: {
                  "app:v1": {
                    id: "app:v1",
                    name: { type: "identifier", name: "v1" },
                    loc: { line: 2, column: 1 },
                    kind: "normal",
                  },
                },
              },
            },
          },
        },
        edges: [],
      });
      await projectManager.openProject(projectPath);
    });

    it("should update graph positions with contextId and sub-items", async () => {
      const positions = {
        app: { x: 100, y: 200, isLayoutCalculated: true },
        "app-render-1": { x: 50, y: 50 },
        "app:v1": { x: 10, y: 10 },
      };
      await projectManager.updateGraphPosition(
        projectPath,
        undefined,
        positions,
        "app",
      );
      await projectManager.updateGraphPosition(
        projectPath,
        undefined,
        positions,
        "root",
      );
      await projectManager.updateGraphPosition(
        projectPath,
        undefined,
        positions,
        "app:v1",
      ); // non-combo context
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it("should update positions in subproject", async () => {
      const subProject = "packages/app";
      await projectManager.openProject(projectPath, subProject);
      const success = await projectManager.updateGraphPosition(
        projectPath,
        subProject,
        {},
      );
      expect(success).toBe(true);
    });

    it("should return false if project not found for updateGraphPosition", async () => {
      const success = await projectManager.updateGraphPosition(
        "/invalid",
        undefined,
        {},
      );
      expect(success).toBe(false);
    });

    it("should handle partial symbol matches", async () => {
      mockDb.prepare.mockReturnValueOnce({
        all: vi.fn().mockReturnValue([
          {
            id: "app",
            name: "App",
            file: "/src/App.tsx",
            line: 1,
            column: 1,
            kind: "component",
            type: "function",
            props_json: "[]",
          },
        ]),
      });
      const results = await projectManager.findSymbol(projectPath, "Ap"); // Matches "App"
      expect(results).toHaveLength(1);
      expect(results[0].name).toBe("App");
    });

    it("should save and read app state", async () => {
      const state = { zoom: 1 };
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readFileSync as any).mockReturnValue(JSON.stringify(state));

      await projectManager.saveAppState(projectPath, state);
      expect(fs.writeFileSync).toHaveBeenCalled();

      const readState = await projectManager.readAppState(projectPath);
      expect(readState).toEqual(state);
    });
  });
});
