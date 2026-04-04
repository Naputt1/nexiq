import { Worker } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import type { FileTaskMessage } from "./types.ts";

export interface WorkerParams {
  filePath: string;
  srcDir: string;
  viteAliases: Record<string, string>;
  packageJsonData: Record<string, unknown>;
  runId?: string;
}

export type WorkerMessage = FileTaskMessage;

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
 */
export class WorkerPool {
  private workers: { worker: Worker; idle: boolean }[] = [];
  private taskQueue: {
    task: WorkerParams;
    resolve: (val: WorkerMessage) => void;
    reject: (err: Error) => void;
  }[] = [];
  private currentTasks = new Map<
    Worker,
    { resolve: (val: WorkerMessage) => void; reject: (err: Error) => void }
  >();
  private isTerminating = false;

  constructor(
    private size: number,
    private workerScript: string,
  ) {
    for (let i = 0; i < size; i++) {
      this.spawnWorker();
    }
    console.log(
      `[WorkerPool] Initialized with ${size} persistent workers for ${workerScript}`,
    );
  }

  private buildExecArgv(): string[] {
    const execArgv = [...process.execArgv, "--no-warnings"];
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
    });

    worker.stdout.on("data", (data) => {
      process.stdout.write(`[Worker ${worker.threadId}] ${data}`);
    });
    worker.stderr.on("data", (data) => {
      process.stderr.write(`[Worker ${worker.threadId}] ${data}`);
    });

    worker.on("message", (msg: WorkerMessage) =>
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

    this.workers.push({ worker, idle: true });
  }

  private onWorkerMessage(worker: Worker, msg: WorkerMessage) {
    const workerInfo = this.workers.find((w) => w.worker === worker);
    if (!workerInfo) return;

    const task = this.currentTasks.get(worker);
    console.log(
      `[WorkerPool] Message received from Worker ${worker.threadId} (task: ${!!task})`,
    );

    workerInfo.idle = true;
    this.currentTasks.delete(worker);

    if (task) {
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
        queued.reject(
          new Error("WorkerPool exhausted: all workers have crashed"),
        );
      }
      return;
    }

    // Otherwise let surviving workers pick up queued tasks
    this.nextTask();
  }

  public runTask(task: WorkerParams): Promise<WorkerMessage> {
    return new Promise((resolve, reject) => {
      this.taskQueue.push({ task, resolve, reject });
      this.nextTask();
    });
  }

  private nextTask() {
    const idleWorker = this.workers.find((w) => w.idle);
    if (idleWorker && this.taskQueue.length > 0) {
      const { task, resolve, reject } = this.taskQueue.shift()!;
      idleWorker.idle = false;
      this.currentTasks.set(idleWorker.worker, { resolve, reject });
      console.log(
        `[WorkerPool] Task assigned to Worker ${idleWorker.worker.threadId}: ${task.filePath}`,
      );
      idleWorker.worker.postMessage(task);
    }
  }

  public async terminate() {
    this.isTerminating = true;
    await Promise.all(this.workers.map((w) => w.worker.terminate()));
    this.workers = [];
    this.currentTasks.clear();
  }
}
