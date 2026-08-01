import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
  packageConcurrency?: number;
  reps: number;
  noSqlite: boolean;
  out?: string;
  nodeArgs: string[];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    projects: [],
    threads: os.cpus().length,
    reps: 3,
    noSqlite: false,
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
      case "--package-concurrency":
      case "--pkg-concurrency":
        args.packageConcurrency = parseNumber("--package-concurrency", next());
        break;
      case "--no-sqlite":
      case "--in-memory":
        args.noSqlite = true;
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
    fileWorkerThreads: number;
    packageConcurrency?: number;
    persist?: boolean;
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

    const errorResult = (error: string): CaseResult => ({
      project: payload.project,
      mode: payload.mode,
      fileWorkerThreads: payload.fileWorkerThreads,
      packageConcurrency: payload.packageConcurrency,
      persist: payload.persist !== false,
      rep: payload.rep,
      durationMs: 0,
      peakRssBytes: 0,
      peakHeapBytes: 0,
      filesTotal: 0,
      resolveErrors: 0,
      phases: {},
      error,
    });

    child.on("error", (error) => {
      resolve(errorResult(error.message));
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
      resolve(
        errorResult(
          stderr.trim() ||
            (code === 0
              ? "Failed to parse case output"
              : `Exited with code ${code}`),
        ),
      );
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
  fileWorkerThreads: number;
  packageConcurrency?: number;
  medianMs: number;
  peakRssBytes: number;
  filesTotal: number;
  failedReps: number;
  phases: Record<string, number>;
}

function pickMedianRep(cases: CaseResult[], medianMs: number): CaseResult {
  const ok = cases.filter((c) => !c.error);
  if (ok.length === 0) {
    return cases[0];
  }
  return ok.reduce((closest, c) =>
    Math.abs(c.durationMs - medianMs) < Math.abs(closest.durationMs - medianMs)
      ? c
      : closest,
  );
}

function summarize(
  mode: "serial" | "parallel",
  fileWorkerThreads: number,
  packageConcurrency: number | undefined,
  cases: CaseResult[],
): ModeSummary {
  const ok = cases.filter((c) => !c.error);
  const medianMs = median(ok.map((c) => c.durationMs));
  return {
    mode,
    fileWorkerThreads,
    packageConcurrency,
    medianMs,
    peakRssBytes: Math.max(0, ...ok.map((c) => c.peakRssBytes)),
    filesTotal: ok[0]?.filesTotal ?? 0,
    failedReps: cases.length - ok.length,
    phases: pickMedianRep(cases, medianMs).phases ?? {},
  };
}

function phaseRows(phases: Record<string, number>): [string, number][] {
  return Object.entries(phases).sort((a, b) => b[1] - a[1]);
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
    `  serial   -> fileWorkerThreads: 1, packageConcurrency: 1 (true serial)`,
  );
  console.log(
    `  parallel -> fileWorkerThreads: ${args.threads}, packageConcurrency: ${
      args.packageConcurrency ?? "auto"
    }, persist: ${args.noSqlite ? "off" : "on"}`,
  );
  console.log("");

  const allResults: CaseResult[] = [];
  const summaryByProject = new Map<
    string,
    { serial: ModeSummary; parallel: ModeSummary }
  >();

  for (const project of projects) {
    const absoluteRoot = path.resolve(REPO_ROOT, project.root);
    const byMode: { serial: CaseResult[]; parallel: CaseResult[] } = {
      serial: [],
      parallel: [],
    };

    for (const mode of ["serial", "parallel"] as const) {
      const fileWorkerThreads =
        mode === "serial" ? 1 : args.threads;
      const packageConcurrency =
        mode === "serial" ? 1 : args.packageConcurrency;
      for (let rep = 1; rep <= args.reps; rep++) {
        process.stdout.write(
          `  [${project.name}/${mode}] rep ${rep}/${args.reps}...`,
        );
        const result = await runCase(
          caseScript,
          {
            project: project.name,
            mode,
            fileWorkerThreads,
            packageConcurrency,
            persist: !args.noSqlite,
            rep,
            root: absoluteRoot,
          },
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

    summaryByProject.set(project.name, {
      serial: summarize(
        "serial",
        1,
        1,
        byMode.serial,
      ),
      parallel: summarize(
        "parallel",
        args.threads,
        args.packageConcurrency,
        byMode.parallel,
      ),
    });
  }

  console.log("");
  console.log("Summary");
  console.log(
    "  Project | Mode     | FileThreads | PkgConcurrency | Median   | Peak RSS  | Files | Speedup",
  );
  for (const project of projects) {
    const s = summaryByProject.get(project.name)!;
    const speedup = s.serial.medianMs / s.parallel.medianMs;
    for (const [label, sum] of [
      ["serial", s.serial],
      ["parallel", s.parallel],
    ] as const) {
      const suffix =
        sum.failedReps > 0 ? ` (${sum.failedReps} rep(s) failed)` : "";
      console.log(
        `  ${project.name.padEnd(7)} | ${label.padEnd(10)} | ${String(sum.fileWorkerThreads).padEnd(11)} | ${String(sum.packageConcurrency ?? "-").padEnd(13)} | ${formatMs(sum.medianMs).padEnd(8)} | ${formatBytes(sum.peakRssBytes).padEnd(9)} | ${sum.filesTotal}${suffix} | ${label === "parallel" ? `${speedup.toFixed(2)}x` : "-"}`,
      );
    }
  }

  console.log("");
  console.log("Phase breakdown (median rep, cumulative ms)");
  console.log("  Project | Mode     | Phase              | Time");
  for (const project of projects) {
    const s = summaryByProject.get(project.name)!;
    for (const [label, sum] of [
      ["serial", s.serial],
      ["parallel", s.parallel],
    ] as const) {
      const rows = phaseRows(sum.phases);
      if (rows.length === 0) {
        console.log(
          `  ${project.name.padEnd(7)} | ${label.padEnd(10)} | (no phase data)`,
        );
        continue;
      }
      for (const [phase, ms] of rows) {
        console.log(
          `  ${project.name.padEnd(7)} | ${label.padEnd(10)} | ${phase.padEnd(19)} | ${formatMs(ms)}`,
        );
      }
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
      fileWorkerThreads: args.threads,
      packageConcurrency: args.packageConcurrency,
      reps: args.reps,
      persist: !args.noSqlite,
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
