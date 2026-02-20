import fs from "node:fs";
import path from "node:path";
import * as watcher from "@parcel/watcher";
import { analyzeProject } from "analyser";
import type { JsonData } from "shared";
import type { Extension } from "@react-map/extension-sdk";
import { pathToFileURL } from "node:url";

export interface ProjectInfo {
  projectPath: string;
  subProject?: string;
  graph?: JsonData;
  subscription?: watcher.AsyncSubscription;
  extensions: Extension[];
}

export class ProjectManager {
  private projects = new Map<string, ProjectInfo>();

  async openProject(
    projectPath: string,
    subProject?: string,
  ): Promise<ProjectInfo> {
    const key = subProject ? `${projectPath}:${subProject}` : projectPath;
    if (this.projects.has(key)) {
      return this.projects.get(key)!;
    }

    const analysisPath = subProject
      ? path.resolve(projectPath, subProject)
      : projectPath;
    const cacheDir = path.join(analysisPath, ".react-map", "cache");
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    // Use a hash of the path to avoid collisions for projects with same basename
    const pathHash = Buffer.from(analysisPath).toString("hex").slice(0, 8);
    const cacheFile = path.join(
      cacheDir,
      `${path.basename(analysisPath)}-${pathHash}.json`,
    );

    // Load config
    const configPath = path.join(analysisPath, "react.map.config.json");
    let ignorePatterns: string[] | undefined;
    let extensionNames: string[] = [];

    if (fs.existsSync(configPath)) {
      try {
        const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        ignorePatterns = config.ignorePatterns;
        extensionNames = config.extensions || [];
      } catch (e: unknown) {
        console.warn("Failed to load config for project", e);
      }
    }

    // Load extensions dynamically
    const extensions: Extension[] = [];
    for (const name of extensionNames) {
      try {
        // Try to resolve from monorepo extensions directory first if it exists
        // This is a bit of a heuristic for this specific project structure
        // In production, we might look in node_modules or a global extensions path
        const monorepoRoot = path.join(process.cwd(), "../../");
        const extensionSlug = name
          .replace("@react-map/", "")
          .replace("-extension", "");
        const extPath = path.join(
          monorepoRoot,
          "extensions",
          extensionSlug,
          "dist",
          "index.js",
        );

        let loaded: unknown;
        if (fs.existsSync(extPath)) {
          loaded = await import(pathToFileURL(extPath).href);
        } else {
          // Fallback to normal import which might look in node_modules
          loaded = await import(name);
        }

        const extension = Object.values(
          loaded as Record<string, unknown>,
        ).find(
          (val: unknown) => val && typeof val === "object" && "id" in val,
        ) as Extension;

        if (extension) {
          extensions.push(extension);
          console.error(`Loaded extension: ${extension.id} from ${name}`);
        }
      } catch (e: unknown) {
        const errorMessage = e instanceof Error ? e.message : "Unknown error";
        console.error(`Failed to load extension ${name}:`, errorMessage);
      }
    }

    console.error(`Analyzing project: ${analysisPath}`);
    const graph = analyzeProject(analysisPath, cacheFile, ignorePatterns);

    // Save initial graph to cache
    fs.writeFileSync(cacheFile, JSON.stringify(graph, null, 2));

    const projectInfo: ProjectInfo = {
      projectPath,
      subProject,
      graph,
      extensions,
    };

    // Set up watcher
    try {
      const subscription = await watcher.subscribe(
        analysisPath,
        (err, events) => {
          if (err) {
            console.error(`Watcher error for ${analysisPath}:`, err);
            return;
          }

          const hasRelevantChange = events.some((event) => {
            const filePath = event.path;
            return (
              filePath.endsWith(".ts") ||
              filePath.endsWith(".tsx") ||
              filePath.endsWith(".js") ||
              filePath.endsWith(".jsx")
            );
          });

          if (hasRelevantChange) {
            console.error(
              `Changes detected in ${analysisPath}, re-analyzing...`,
            );
            try {
              projectInfo.graph = analyzeProject(
                analysisPath,
                cacheFile,
                ignorePatterns,
              );
              fs.writeFileSync(
                cacheFile,
                JSON.stringify(projectInfo.graph, null, 2),
              );
              console.error(
                `Project ${analysisPath} re-analyzed successfully.`,
              );
            } catch (reAnalyzeError: unknown) {
              console.error(
                `Re-analysis failed for ${analysisPath}:`,
                reAnalyzeError,
              );
            }
          }
        },
        {
          ignore: [
            "node_modules",
            ".git",
            ".react-map",
            "dist",
            "build",
            ".next",
            ".vite",
            ...(ignorePatterns || []).map((p) =>
              p.replace(/^\*\*\/|\/\*\*$/g, ""),
            ),
          ],
        },
      );
      projectInfo.subscription = subscription;
    } catch (watcherError) {
      console.error(
        `Failed to start watcher for ${analysisPath}:`,
        watcherError,
      );
    }

    this.projects.set(key, projectInfo);
    return projectInfo;
  }

  getProject(
    projectPath: string,
    subProject?: string,
  ): ProjectInfo | undefined {
    const key = subProject ? `${projectPath}:${subProject}` : projectPath;
    return this.projects.get(key);
  }

  getAllExtensions(): Extension[] {
    const all = new Map<string, Extension>();
    for (const project of this.projects.values()) {
      for (const ext of project.extensions) {
        all.set(ext.id, ext);
      }
    }
    return Array.from(all.values());
  }

  async closeAll() {
    for (const project of this.projects.values()) {
      if (project.subscription) {
        await project.subscription.unsubscribe();
      }
    }
    this.projects.clear();
  }
}
