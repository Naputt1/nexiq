import { analyzeProject } from "@nexiq/analyser";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

export interface CaseResult {
  project: string;
  mode: "serial" | "parallel";
  fileWorkerThreads: number;
  packageConcurrency?: number;
  persist: boolean;
  rep: number;
  durationMs: number;
  peakRssBytes: number;
  peakHeapBytes: number;
  filesTotal: number;
  resolveErrors: number;
  phases: Record<string, number>;
  error?: string;
}

const POLL_INTERVAL_MS = 25;

function peakMemorySampler(onSample: (rss: number, heap: number) => void) {
  let timer: NodeJS.Timeout | undefined;
  const sample = () => {
    const usage = process.memoryUsage();
    onSample(usage.rss, usage.heapUsed);
  };
  return {
    start() {
      sample();
      timer = setInterval(sample, POLL_INTERVAL_MS);
      timer.unref();
    },
    stop() {
      if (timer) {
        clearInterval(timer);
      }
    },
  };
}

async function runCase(): Promise<CaseResult> {
  const args = JSON.parse(process.argv[2] ?? "{}") as {
    project: string;
    mode: "serial" | "parallel";
    fileWorkerThreads: number;
    packageConcurrency?: number;
    persist?: boolean;
    rep: number;
    root: string;
  };
  const persist = args.persist !== false;

  let peakRss = 0;
  let peakHeap = 0;
  const sampler = peakMemorySampler((rss, heap) => {
    peakRss = Math.max(peakRss, rss);
    peakHeap = Math.max(peakHeap, heap);
  });

  const result: CaseResult = {
    project: args.project,
    mode: args.mode,
    fileWorkerThreads: args.fileWorkerThreads,
    packageConcurrency: args.packageConcurrency,
    persist,
    rep: args.rep,
    durationMs: 0,
    peakRssBytes: 0,
    peakHeapBytes: 0,
    filesTotal: 0,
    resolveErrors: 0,
    phases: {},
  };

  // Monorepo analysis writes SQLite state into the project by default
  // (CentralMaster uses "<root>/.nexiq/..."). Redirect to a fresh temp dir
  // per case so reps stay independent (no cross-rep cache reuse) and the
  // benchmark projects are not polluted. With persist=false no DBs are written.
  const tmpDir = persist
    ? fs.mkdtempSync(path.join(os.tmpdir(), "nexiq-bench-"))
    : "";
  const phases = result.phases;

  sampler.start();
  const start = performance.now();
  try {
    const graph = await analyzeProject(args.root, {
      fileWorkerThreads: args.fileWorkerThreads,
      packageConcurrency: args.packageConcurrency,
      packageDbDir: tmpDir ? path.join(tmpDir, "packages") : undefined,
      centralSqlitePath: tmpDir ? path.join(tmpDir, "workspace.sqlite") : undefined,
      persist,
      onPhase: (phase, ms) => {
        phases[phase] = (phases[phase] || 0) + ms;
      },
    });
    result.durationMs = performance.now() - start;
    result.filesTotal = graph.files ? Object.keys(graph.files).length : 0;
    result.resolveErrors = Array.isArray(graph.resolve)
      ? graph.resolve.length
      : 0;
  } catch (error) {
    result.durationMs = performance.now() - start;
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    sampler.stop();
    result.peakRssBytes = peakRss;
    result.peakHeapBytes = peakHeap;
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  }

  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCase()
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
