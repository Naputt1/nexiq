import fs from "fs";
import path from "path";
import { PackageJson } from "./db/packageJson.js";
import analyzeFiles from "./analyzer/index.js";
import { getFiles, getViteConfig } from "./analyzer/utils.js";

const SRC_DIR = process.argv[2] || "./sample-src";
const OUT_FILE = process.argv[3] || "./out/graph.json";
const PUBLIC_FILE = process.argv[4] || "./ui/public/graph.json";

function main() {
  const packageJson = new PackageJson(SRC_DIR);

  const viteConfigPath = getViteConfig(SRC_DIR);
  console.log("viteConfigPath", viteConfigPath);
  const files = getFiles(SRC_DIR);
  // fs.writeFileSync("./out/files.json", JSON.stringify(files));
  console.log(`Analyzing ${files.length} files...`);
  const graph = analyzeFiles(SRC_DIR, viteConfigPath, files, packageJson);

  fs.mkdirSync(path.dirname(PUBLIC_FILE), { recursive: true });
  fs.writeFileSync(PUBLIC_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${PUBLIC_FILE}`);

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(graph, null, 2));
  console.log(`Graph written to ${OUT_FILE}`);
}

main();
