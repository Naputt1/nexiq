import { analyzeProject } from "@nexiq/analyser";
import { performance } from "node:perf_hooks";

export interface CaseResult {
  project: string;
  mode: "serial" | "parallel";
  threads: number;
  rep: number;
  durationMs: number;
  peakRssBytes: number;
  peakHeapBytes: number;
  filesTotal: number;
  resolveErrors: number;
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
    threads: number;
    rep: number;
    root: string;
  };

  let peakRss = 0;
  let peakHeap = 0;
  const sampler = peakMemorySampler((rss, heap) => {
    peakRss = Math.max(peakRss, rss);
    peakHeap = Math.max(peakHeap, heap);
  });

  const result: CaseResult = {
    project: args.project,
    mode: args.mode,
    threads: args.threads,
    rep: args.rep,
    durationMs: 0,
    peakRssBytes: 0,
    peakHeapBytes: 0,
    filesTotal: 0,
    resolveErrors: 0,
  };

  sampler.start();
  const start = performance.now();
  try {
    const graph = await analyzeProject(args.root, {
      fileWorkerThreads: args.threads,
    });
    result.durationMs = performance.now() - start;
    result.filesTotal = graph.files ? Object.keys(graph.files).length : 0;
    result.resolveErrors = Array.isArray(graph.resolve) ? graph.resolve.length : 0;
  } catch (error) {
    result.durationMs = performance.now() - start;
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    sampler.stop();
    // Capture the peak from the most recent poll as well.
    result.peakRssBytes = peakRss;
    result.peakHeapBytes = peakHeap;
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
