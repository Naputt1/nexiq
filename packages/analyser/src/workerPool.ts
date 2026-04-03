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

export class WorkerPool {
  private workers: { worker: Worker; idle: boolean; failures: number }[] = [];
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
  }

  private getWorkerOptions() {
    const execArgv = [...process.execArgv, "--no-warnings"];
    return {
      stdout: true,
      stderr: true,
      execArgv,
      env: {
        ...process.env,
      },
    };
  }

  private spawnWorker() {
    // Use pathToFileURL to ensure correct path resolution on all platforms
    const scriptUrl = this.workerScript.startsWith("file:")
      ? new URL(this.workerScript)
      : pathToFileURL(this.workerScript);

    const bootstrap = `
import 'tsx/esm';
import('${scriptUrl.toString()}');
`;

    const worker = new Worker(bootstrap, {
      ...this.getWorkerOptions(),
      eval: true,
      execArgv: ["--import=tsx"],
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
    worker.on("error", (err) => this.onWorkerError(worker, err));
    worker.on("exit", (code) => {
      if (code !== 0) {
        this.onWorkerError(
          worker,
          new Error(`Worker ${worker.threadId} exited with code ${code}`),
        );
      }
    });
    this.workers.push({ worker, idle: true, failures: 0 });
  }

  private onWorkerMessage(worker: Worker, msg: WorkerMessage) {
    const workerInfo = this.workers.find((w) => w.worker === worker);
    if (workerInfo) {
      const task = this.currentTasks.get(worker);
      console.log(
        `[WorkerPool] Message received from Worker ${worker.threadId} (task: ${!!task})`,
      );
      workerInfo.idle = true;
      workerInfo.failures = 0; // Reset failures on success
      this.currentTasks.delete(worker);

      if (task) {
        task.resolve(msg);
      }
      this.nextTask();
    }
  }

  private onWorkerError(worker: Worker, err: Error | unknown) {
    const workerIndex = this.workers.findIndex((w) => w.worker === worker);
    if (workerIndex !== -1) {
      const workerInfo = this.workers[workerIndex]!;
      const task = this.currentTasks.get(worker);

      if (!this.isTerminating) {
        console.error(
          `Worker error (task: ${!!task}, failures: ${workerInfo?.failures}):`,
          err,
        );
      }

      this.workers.splice(workerIndex, 1);
      this.currentTasks.delete(worker);

      if (task) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      }

      // Re-spawn worker if we haven't failed too many times
      if (workerInfo.failures < 3) {
        const newWorkerIndex = this.workers.length;
        this.spawnWorker();
        // Manually increment failures for the newly created worker info
        if (this.workers[newWorkerIndex]) {
          this.workers[newWorkerIndex].failures = workerInfo.failures + 1;
        }
        this.nextTask();
      } else {
        console.error("Worker failed too many times, not re-spawning.");
      }
    }
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
    for (const w of this.workers) {
      await w.worker.terminate();
    }
  }
}
