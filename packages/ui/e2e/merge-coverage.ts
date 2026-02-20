import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import istanbulLibCoverage from "istanbul-lib-coverage";
import istanbulLibReport from "istanbul-lib-report";
import istanbulReports from "istanbul-reports";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const coverageDir = path.join(__dirname, "coverage");
const outputDir = path.join(__dirname, "..", "coverage");

async function merge() {
  if (!fs.existsSync(coverageDir)) {
    console.error("No coverage files found");
    return;
  }

  const files = fs.readdirSync(coverageDir).filter(f => f.startsWith("coverage-") && f.endsWith(".json"));
  const map = istanbulLibCoverage.createCoverageMap();

  for (const file of files) {
    const coverage = JSON.parse(fs.readFileSync(path.join(coverageDir, file), "utf-8"));
    map.merge(coverage);
  }

  const context = istanbulLibReport.createContext({
    dir: outputDir,
    defaultSummarizer: "nested",
    watermarks: {
      statements: [50, 80],
      functions: [50, 80],
      branches: [50, 80],
      lines: [50, 80],
    },
    coverageMap: map,
  });

  const reporter = istanbulReports.create("html");
  (reporter as any).execute(context);
  
  const textReporter = istanbulReports.create("text");
  (textReporter as any).execute(context);

  console.log(`Coverage report generated in ${outputDir}`);
}

merge().catch(console.error);
