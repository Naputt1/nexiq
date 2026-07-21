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

  const graph = await analyzeProject(input.srcDir, options);
  const graphJson = JSON.stringify(graph);
  process.stdout.write(graphJson, () => process.exit(0));
}

main().catch(() => process.exit(1));
