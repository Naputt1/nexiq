import { describe, it, expect } from "vitest";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";
import { PackageJson } from "./db/packageJson.js";
import { setRandomSeed } from "./utils/uuid.js";
import path from "path";
import fs from "fs";

const SEED = "analyser-test-seed";

describe("analyser snapshots", () => {
  const projects = ["simple", "complex"];

  projects.forEach((projectName) => {
    it(`should match snapshot for ${projectName}`, () => {
      setRandomSeed(SEED);
      const projectPath = path.resolve(
        process.cwd(),
        `../sample-project/${projectName}`
      );
      const packageJson = new PackageJson(projectPath);
      const viteConfigPath = getViteConfig(projectPath);
      const files = getFiles(projectPath);

      const graph = analyzeFiles(
        projectPath,
        viteConfigPath,
        files,
        packageJson
      );

      const snapshotPath = path.resolve(
        process.cwd(),
        `test/snapshots/${projectName}.json`
      );
      const snapshotData = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));

      // Compare the result with the stored snapshot
      // We strip the absolute 'src' path as it changes between environments
      const result = JSON.parse(JSON.stringify(graph));
      delete result.src;
      const expected = snapshotData;
      delete expected.src;

      expect(result).toEqual(expected);
    });
  });
});
