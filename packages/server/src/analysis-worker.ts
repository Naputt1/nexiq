import fs from "node:fs";
import path from "node:path";
import { analyzeProject } from "@nexiq/analyser";

interface WorkerInput {
  srcDir: string;
  cacheFile?: string;
  sqlitePath?: string;
  ignorePatterns?: string[];
  analysisPaths?: string[];
  monorepo?: boolean;
}

async function main() {
  const inputJson = await new Promise<string>((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
  const input: WorkerInput = JSON.parse(inputJson.trim());

  const options: Record<string, unknown> = {};
  if (input.cacheFile) options.cacheFile = input.cacheFile;
  if (input.sqlitePath) options.sqlitePath = input.sqlitePath;
  if (input.ignorePatterns) options.ignorePatterns = input.ignorePatterns;
  if (input.analysisPaths) options.analysisPaths = input.analysisPaths;
  if (input.monorepo) options.monorepo = input.monorepo;
  options.fileWorkerThreads = options.fileWorkerThreads ?? 2;

  const graph = await analyzeProject(input.srcDir, options);

  if (input.cacheFile) {
    const dir = path.dirname(input.cacheFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(input.cacheFile, JSON.stringify(graph));
  }

  process.exit(0);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack || err.message : String(err);
  process.stderr.write("Analysis worker fatal error:\n" + msg + "\n");
  process.exit(1);
});
