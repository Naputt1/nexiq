import { app } from "electron";
import path from "node:path";
import fs from "node:fs";

const DATA_FILE = "recent-projects.json";

interface StoreData {
  recentProjects: string[];
  lastProjectRoot: string | null;
}

export class Store {
  private path: string;
  private data: StoreData;

  constructor() {
    this.path = path.join(app.getPath("userData"), DATA_FILE);
    this.data = this.parseDataFile(this.path);
  }

  private parseDataFile(filePath: string): StoreData {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      return {
        recentProjects: parsed.recentProjects || [],
        lastProjectRoot: parsed.lastProjectRoot || null,
      };
    } catch {
      return { recentProjects: [], lastProjectRoot: null };
    }
  }

  private save() {
    try {
      fs.writeFileSync(this.path, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error("Failed to save store:", error);
    }
  }

  getRecentProjects(): string[] {
    return this.data.recentProjects;
  }

  getLastProject(): string | null {
    return this.data.lastProjectRoot;
  }

  setLastProject(projectPath: string | null) {
    this.data.lastProjectRoot = projectPath;
    this.save();
  }

  addRecentProject(projectPath: string) {
    // Remove if exists (to move to top)
    this.data.recentProjects = this.data.recentProjects.filter(
      (p) => p !== projectPath,
    );
    // Add to top
    this.data.recentProjects.unshift(projectPath);
    // Limit to 20
    this.data.recentProjects = this.data.recentProjects.slice(0, 20);
    this.save();
  }

  removeRecentProject(projectPath: string) {
    this.data.recentProjects = this.data.recentProjects.filter(
      (p) => p !== projectPath,
    );
    this.save();
  }
}

export const store = new Store();
