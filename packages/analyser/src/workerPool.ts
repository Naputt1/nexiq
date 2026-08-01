import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import type {
  AnalyzerWorkerMessage,
  AnalyzerWorkerRequest,
  AnalyzerWorkerResponse,
  WorkerSessionConfig,
} from "./types.ts";

/**
 * A fixed-size pool of persistent worker threads.
 *
 * Workers are spawned once at construction and reused for the lifetime of the
 * pool — they are NEVER re-spawned on error. This prevents the "more than 100
 * workers" scenario that causes the Node.js v8::ToLocalChecked fatal crash.
 *
 * If a worker crashes while handling a task, that task is rejected and the
 * worker slot is removed from the pool. Any tasks still queued when the pool
 * drains below one worker are also rejected.
 *
 * Tasks that hang past `TASK_TIMEOUT_MS` are rejected; the hung worker is
 * retired and, if any surviving workers remain, the task is retried once.
 */
const TASK_TIMEOUT_MS = 60_000;
const isDev = process.env.MODE === "development";

function log(...args: unknown[]) {
  if (isDev) {
    console.log(...args);
  }
}

interface TaskEntry {
  task: AnalyzerWorkerRequest;
  resolve: (val: AnalyzerWorkerResponse) => void;
  reject: (err: Error) => void;
  retriesLeft: number;
  timer?: NodeJS.Timeout;
}

export class WorkerPool {
  private workers: {
    worker: Worker;
    idle: boolean;
    spawnedAt: number;
    startupMs: number;
  }[] = [];
  private taskQueue: TaskEntry[] = [];
  private currentTasks = new Map<
    Worker,
    {
      entry: TaskEntry;
      resolve: (val: AnalyzerWorkerResponse) => void;
      reject: (err: Error) => void;
    }
  >();
  private isTerminating = false;

  constructor(
    private size: number,
    private workerScript: string,
    private workerData?: WorkerSessionConfig,
  ) {
    for (let i = 0; i < size; i++) {
      this.spawnWorker();
    }
    log(
      `[WorkerPool] Initialized with ${size} persistent workers for ${workerScript}`,
    );
  }

  private static INVALID_WORKER_FLAGS = [
    "--max-old-space-size",
    "--max-semi-space-size",
    "--max-heap-size",
    "--expose-gc",
    "--expose-internals",
    "--harmony",
    "--harmony-shipping",
    "--harmony-import-assertions",
  ];

  private buildExecArgv(): string[] {
    // Filter out V8 flags that are invalid for Worker threads
    // (throw ERR_WORKER_INVALID_EXEC_ARGV)
    const execArgv = process.execArgv.filter(
      (arg) =>
        !WorkerPool.INVALID_WORKER_FLAGS.some((flag) =>
          arg.startsWith(flag),
        ) || arg.startsWith("--inspect"),
    );
    if (!execArgv.includes("--no-warnings")) {
      execArgv.push("--no-warnings");
    }
    const hasTsx = execArgv.some(
      (arg) => arg.includes("tsx") || arg.includes("ts-node"),
    );
    if (this.workerScript.endsWith(".ts") && !hasTsx) {
      execArgv.push("--import=tsx");
    }
    return execArgv;
  }

  private spawnWorker() {
    const scriptUrl = this.workerScript.startsWith("file:")
      ? new URL(this.workerScript)
      : pathToFileURL(this.workerScript);

    const worker = new Worker(scriptUrl, {
      stdout: true,
      stderr: true,
      execArgv: this.buildExecArgv(),
      env: { ...process.env },
      workerData: this.workerData,
    });

    worker.stdout.on("data", (data) => {
      process.stdout.write(`[Worker ${worker.threadId}] ${data}`);
    });
    worker.stderr.on("data", (data) => {
      process.stderr.write(`[Worker ${worker.threadId}] ${data}`);
    });

    worker.on("message", (msg: AnalyzerWorkerResponse) =>
      this.onWorkerMessage(worker, msg),
    );
    worker.on("error", (err) => this.onWorkerDied(worker, err));
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.onWorkerDied(
          worker,
          new Error(`Worker ${worker.threadId} exited with code ${code}`),
        );
      }
    });

    this.workers.push({ worker, idle: true, spawnedAt: performance.now(), startupMs: 0 });
  }

  private onWorkerMessage(worker: Worker, msg: AnalyzerWorkerMessage) {
    const workerInfo = this.workers.find((w) => w.worker === worker);
    if (!workerInfo) return;

    // Worker finished loading its module graph; record startup latency.
    // Do NOT touch idle/currentTasks: the worker may already be processing a
    // dispatched task (ready arrives asynchronously after module load), and
    // flipping it idle here would let the pool double-assign it and orphan the
    // in-flight task's promise.
    if (msg.type === "worker_ready") {
      workerInfo.startupMs = performance.now() - workerInfo.spawnedAt;
      return;
    }

    const task = this.currentTasks.get(worker);
    log(
      `[WorkerPool] Message received from Worker ${worker.threadId} (task: ${!!task})`,
    );

    workerInfo.idle = true;
    this.currentTasks.delete(worker);

    if (task) {
      if (task.entry.timer) {
        clearTimeout(task.entry.timer);
      }
      task.resolve(msg);
    }
    this.nextTask();
  }

  /**
   * Called when a worker crashes or exits with a non-zero code.
   * The worker is removed from the pool permanently — no re-spawning.
   * The in-flight task (if any) is rejected. Any tasks remaining in the
   * queue will still be served by the surviving workers.
   */
  private onWorkerDied(worker: Worker, err: Error | unknown) {
    const workerIndex = this.workers.findIndex((w) => w.worker === worker);
    if (workerIndex === -1) return; // already removed (duplicate event)

    const task = this.currentTasks.get(worker);

    if (!this.isTerminating) {
      console.error(
        `[WorkerPool] Worker ${worker.threadId} died (had task: ${!!task}):`,
        err,
      );
    }

    // Permanently remove — do NOT re-spawn
    this.workers.splice(workerIndex, 1);
    this.currentTasks.delete(worker);

    // Reject the in-flight task so its Promise settles
    if (task) {
      if (task.entry.timer) {
        clearTimeout(task.entry.timer);
      }
      task.reject(err instanceof Error ? err : new Error(String(err)));
    }

    // If the pool is now completely empty and there are queued tasks,
    // reject them all rather than hanging forever.
    if (this.workers.length === 0 && this.taskQueue.length > 0) {
      console.error(
        `[WorkerPool] All workers have died. Rejecting ${this.taskQueue.length} queued task(s).`,
      );
      const drained = this.taskQueue.splice(0);
      for (const queued of drained) {
        if (queued.timer) {
          clearTimeout(queued.timer);
        }
        queued.reject(
          new Error("WorkerPool exhausted: all workers have crashed"),
        );
      }
      return;
    }

    // Otherwise let surviving workers pick up queued tasks
    this.nextTask();
  }

  private onTaskTimeout(entry: TaskEntry, worker: Worker) {
    const workerIndex = this.workers.findIndex((w) => w.worker === worker);
    if (workerIndex === -1) return;

    console.error(
      `[WorkerPool] Task timed out on Worker ${worker.threadId} (retries left: ${entry.retriesLeft}). Retiring worker.`,
    );

    // Retire the hung worker permanently (no re-spawn).
    this.workers.splice(workerIndex, 1);
    this.currentTasks.delete(worker);

    if (entry.retriesLeft > 0) {
      // Requeue for a surviving worker to retry.
      entry.retriesLeft -= 1;
      this.taskQueue.unshift(entry);
      this.nextTask();
    } else {
      entry.reject(new Error("Task timed out"));
    }
  }

  /**
   * Worker startup latency, from spawn to "module graph loaded" signal.
   * `wall` is the max (loads happen concurrently), `total` is the summed CPU.
   */
  public getStartupMs(): { wall: number; total: number } {
    const latencies = this.workers
      .map((w) => w.startupMs)
      .filter((ms) => ms > 0);
    return {
      wall: latencies.length > 0 ? Math.max(...latencies) : 0,
      total: latencies.reduce((sum, ms) => sum + ms, 0),
    };
  }

  public runTask(task: AnalyzerWorkerRequest): Promise<AnalyzerWorkerResponse> {
    return new Promise((resolve, reject) => {
      const entry: TaskEntry = {
        task,
        resolve,
        reject,
        retriesLeft: 1,
      };
      this.taskQueue.push(entry);
      this.nextTask();
    });
  }

  private nextTask() {
    const idleWorker = this.workers.find((w) => w.idle);
    if (idleWorker && this.taskQueue.length > 0) {
      const entry = this.taskQueue.shift()!;
      idleWorker.idle = false;
      entry.timer = setTimeout(
        () => this.onTaskTimeout(entry, idleWorker.worker),
        TASK_TIMEOUT_MS,
      );
      this.currentTasks.set(idleWorker.worker, {
        entry,
        resolve: entry.resolve,
        reject: entry.reject,
      });
      log(
        `[WorkerPool] Task assigned to Worker ${idleWorker.worker.threadId}: ${entry.task.filePaths.length} files`,
      );
      idleWorker.worker.postMessage(entry.task);
    }
  }

  public async terminate() {
    this.isTerminating = true;
    for (const queued of this.taskQueue.splice(0)) {
      if (queued.timer) {
        clearTimeout(queued.timer);
      }
      queued.reject(new Error("WorkerPool terminated"));
    }
    for (const [worker, task] of this.currentTasks) {
      if (task.entry.timer) {
        clearTimeout(task.entry.timer);
      }
      task.reject(new Error("WorkerPool terminated"));
    }
    this.currentTasks.clear();
    await Promise.all(this.workers.map((w) => w.worker.terminate()));
    this.workers = [];
  }
}
