import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import type { CustomColors } from "./types";

const DATA_FILE = "recent-projects.json";

interface StoreData {
  recentProjects: string[];
  openProjects: string[];
  theme: "dark" | "light";
  customColors?: CustomColors;
  autoReload: boolean;
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
        openProjects: parsed.openProjects || [],
        theme: parsed.theme || parsed.graphTheme || "dark",
        customColors: parsed.customColors,
        autoReload: parsed.autoReload !== undefined ? parsed.autoReload : true,
      };
    } catch {
      return {
        recentProjects: [],
        openProjects: [],
        theme: "dark",
        autoReload: true,
      };
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

  getOpenProjects(): string[] {
    return this.data.openProjects;
  }

  setOpenProjects(projects: string[]) {
    this.data.openProjects = projects;
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

  getGlobalConfig(): {
    theme: "dark" | "light";
    customColors?: CustomColors;
    autoReload: boolean;
  } {
    return {
      theme: this.data.theme,
      customColors: this.data.customColors,
      autoReload: this.data.autoReload,
    };
  }

  saveGlobalConfig(config: {
    theme: "dark" | "light";
    customColors?: CustomColors;
    autoReload?: boolean;
  }) {
    if (config.theme) this.data.theme = config.theme;
    if (config.customColors) this.data.customColors = config.customColors;
    if (config.autoReload !== undefined)
      this.data.autoReload = config.autoReload;
    this.save();
  }
}

export const store = new Store();
