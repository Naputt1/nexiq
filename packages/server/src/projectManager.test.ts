import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProjectManager } from "./projectManager.js";
import fs from "node:fs";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";

vi.mock("node:fs");
vi.mock("@parcel/watcher");
vi.mock("analyser");

describe("ProjectManager", () => {
  let projectManager: ProjectManager;

  beforeEach(() => {
    vi.clearAllMocks();
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
    expect(analyzeProject).toHaveBeenCalled();
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

    (fs.existsSync as any).mockImplementation((p: string) => p === configPath);
    (fs.readFileSync as any).mockReturnValue(
      JSON.stringify({
        ignorePatterns: ["*.test.ts"],
        extensions: ["@react-map/test-extension"],
      }),
    );

    await projectManager.openProject(projectPath);

    expect(analyzeProject).toHaveBeenCalledWith(
      projectPath,
      expect.any(String),
      ["*.test.ts"],
    );
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
});
