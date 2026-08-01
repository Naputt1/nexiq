import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import type { CaseResult } from "./case.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const RESULTS_DIR = path.join(REPO_ROOT, "benchmarks/results/analysis");

interface Tier {
  name: string;
  root: string;
}

const TIERS: Tier[] = [
  { name: "small", root: "benchmarks/projects/small/apps/react-vite" },
  { name: "mid", root: "benchmarks/projects/mid" },
  { name: "large", root: "benchmarks/projects/large" },
];

interface CliArgs {
  projects: string[];
  threads: number;
  reps: number;
  out?: string;
  nodeArgs: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projects: [],
    threads: Math.min(os.cpus().length, 4),
    reps: 3,
    nodeArgs: ["--max-old-space-size=4096"],
  };
  for (let i = 0; i < argv.length; i++) {
    let arg = argv[i];
    if (arg === "--") {
      continue;
    }
    const eqIndex = arg.indexOf("=");
    let inlineValue: string | undefined;
    if (arg.startsWith("--") && eqIndex !== -1) {
      inlineValue = arg.slice(eqIndex + 1);
      arg = arg.slice(0, eqIndex);
    }
    const next = () => inlineValue ?? argv[++i];
    const parseNumber = (name: string, raw: string | undefined): number => {
      const value = parseInt(raw ?? "", 10);
      if (Number.isNaN(value) || value < 1) {
        throw new Error(`Invalid ${name} value: ${raw}`);
      }
      return value;
    };
    switch (arg) {
      case "--projects":
      case "-p":
        args.projects = (next() ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        break;
      case "--threads":
      case "-t":
        args.threads = parseNumber("--threads", next());
        break;
      case "--reps":
      case "-r":
        args.reps = parseNumber("--reps", next());
        break;
      case "--out":
      case "-o":
        args.out = next();
        break;
      case "--node-args":
        args.nodeArgs = (next() ?? "")
          .split(" ")
          .filter(Boolean);
        break;
      default:
        if (arg.startsWith("-")) {
          throw new Error(`Unknown flag: ${arg}`);
        }
    }
  }
  return args;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

function runCase(
  caseScript: string,
  payload: {
    project: string;
    mode: "serial" | "parallel";
    threads: number;
    rep: number;
    root: string;
  },
  nodeArgs: string[],
): Promise<CaseResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [...nodeArgs, caseScript, JSON.stringify(payload)],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("error", (error) => {
      resolve({
        project: payload.project,
        mode: payload.mode,
        threads: payload.threads,
        rep: payload.rep,
        durationMs: 0,
        peakRssBytes: 0,
        peakHeapBytes: 0,
        filesTotal: 0,
        resolveErrors: 0,
        error: error.message,
      });
    });

    child.on("close", (code) => {
      const lines = stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const lastLine = lines[lines.length - 1];
      if (code === 0 && lastLine) {
        try {
          resolve(JSON.parse(lastLine) as CaseResult);
          return;
        } catch {
          // fall through to error result
        }
      }
      resolve({
        project: payload.project,
        mode: payload.mode,
        threads: payload.threads,
        rep: payload.rep,
        durationMs: 0,
        peakRssBytes: 0,
        peakHeapBytes: 0,
        filesTotal: 0,
        resolveErrors: 0,
        error:
          stderr.trim() ||
          (code === 0 ? "Failed to parse case output" : `Exited with code ${code}`),
      });
    });
  });
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(0)}ms`;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

interface ModeSummary {
  mode: "serial" | "parallel";
  threads: number;
  medianMs: number;
  peakRssBytes: number;
  filesTotal: number;
  failedReps: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const projects =
    args.projects.length > 0
      ? TIERS.filter((t) => args.projects.includes(t.name))
      : TIERS;

  if (projects.length === 0) {
    throw new Error(
      `No matching projects. Available: ${TIERS.map((t) => t.name).join(", ")}`,
    );
  }

  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const caseScript = path.join(__dirname, "case.js");

  console.log(
    `Analysis benchmark: ${projects.map((p) => p.name).join(", ")} x ${args.reps} reps`,
  );
  console.log(
    `  serial   -> fileWorkerThreads: 1`,
  );
  console.log(`  parallel -> fileWorkerThreads: ${args.threads}`);
  console.log("");

  const allResults: CaseResult[] = [];
  const summaryByProject = new Map<string, { serial: ModeSummary; parallel: ModeSummary }>();

  for (const project of projects) {
    const absoluteRoot = path.resolve(REPO_ROOT, project.root);
    const byMode: { serial: CaseResult[]; parallel: CaseResult[] } = {
      serial: [],
      parallel: [],
    };

    for (const mode of ["serial", "parallel"] as const) {
      const threads = mode === "serial" ? 1 : args.threads;
      for (let rep = 1; rep <= args.reps; rep++) {
        process.stdout.write(
          `  [${project.name}/${mode}] rep ${rep}/${args.reps}...`,
        );
        const result = await runCase(
          caseScript,
          { project: project.name, mode, threads, rep, root: absoluteRoot },
          args.nodeArgs,
        );
        allResults.push(result);
        byMode[mode].push(result);
        if (result.error) {
          console.log(` FAILED (${result.error.slice(0, 120)})`);
        } else {
          console.log(
            ` done in ${formatMs(result.durationMs)} (peak ${formatBytes(result.peakRssBytes)})`,
          );
        }
      }
    }

    const summarize = (
      mode: "serial" | "parallel",
      cases: CaseResult[],
    ): ModeSummary => {
      const ok = cases.filter((c) => !c.error);
      return {
        mode,
        threads: mode === "serial" ? 1 : args.threads,
        medianMs: median(ok.map((c) => c.durationMs)),
        peakRssBytes: Math.max(0, ...ok.map((c) => c.peakRssBytes)),
        filesTotal: ok[0]?.filesTotal ?? 0,
        failedReps: cases.length - ok.length,
      };
    };

    summaryByProject.set(project.name, {
      serial: summarize("serial", byMode.serial),
      parallel: summarize("parallel", byMode.parallel),
    });
  }

  console.log("");
  console.log("Summary");
  console.log(
    "  Project | Mode     | Threads | Median   | Peak RSS  | Files      | Speedup",
  );
  for (const project of projects) {
    const s = summaryByProject.get(project.name)!;
    const speedup = s.serial.medianMs / s.parallel.medianMs;
    for (const [label, sum] of [
      ["serial", s.serial],
      ["parallel", s.parallel],
    ] as const) {
      const suffix = sum.failedReps > 0 ? ` (${sum.failedReps} rep(s) failed)` : "";
      console.log(
        `  ${project.name.padEnd(7)} | ${label.padEnd(10)} | ${String(sum.threads).padEnd(7)} | ${formatMs(sum.medianMs).padEnd(8)} | ${formatBytes(sum.peakRssBytes).padEnd(9)} | ${sum.filesTotal}${suffix} | ${label === "parallel" ? `${speedup.toFixed(2)}x` : "-"}`,
      );
    }
  }

  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const outFile = args.out
    ? path.resolve(REPO_ROOT, args.out)
    : path.join(RESULTS_DIR, `run_${timestamp}.json`);
  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  let gitHead: string | undefined;
  try {
    gitHead = execSync("git rev-parse HEAD", { cwd: REPO_ROOT })
      .toString()
      .trim();
  } catch {
    gitHead = undefined;
  }

  const report = {
    timestamp,
    metadata: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      cpuModel: os.cpus()[0]?.model,
      totalMemoryBytes: os.totalmem(),
      gitHead,
    },
    config: {
      projects: projects.map((p) => p.name),
      threads: args.threads,
      reps: args.reps,
    },
    summary: Object.fromEntries(
      [...summaryByProject.entries()].map(([name, s]) => [
        name,
        {
          serial: s.serial,
          parallel: s.parallel,
          speedup: s.serial.medianMs / s.parallel.medianMs,
        },
      ]),
    ),
    cases: allResults,
  };

  fs.writeFileSync(outFile, JSON.stringify(report, null, 2));
  console.log("");
  console.log(`Results written to ${outFile}`);
}

main().catch((error) => {
  console.error("Benchmark failed:", error);
  process.exit(1);
});
