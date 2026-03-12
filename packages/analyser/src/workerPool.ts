import { Worker } from "node:worker_threads";
import type { ComponentFile } from "@react-map/shared";

export interface WorkerParams {
  filePath: string;
  srcDir: string;
  viteAliases: Record<string, string>;
  packageJsonData: Record<string, unknown>;
}

export type WorkerMessage =
  | { type: "success"; result: ComponentFile }
  | { type: "error"; error: string; stack?: string };

export class WorkerPool {
  private workers: { worker: Worker; idle: boolean }[] = [];
  private taskQueue: {
    task: WorkerParams;
    resolve: (val: ComponentFile) => void;
    reject: (err: Error) => void;
  }[] = [];
  private currentTasks = new Map<
    Worker,
    { resolve: (val: ComponentFile) => void; reject: (err: Error) => void }
  >();

  constructor(
    private size: number,
    private workerScript: string,
  ) {
    for (let i = 0; i < size; i++) {
      this.spawnWorker();
    }
  }

  private getWorkerOptions() {
    const isTs = this.workerScript.endsWith(".ts");
    return isTs ? { execArgv: ["--no-warnings", "--import", "tsx"] } : {};
  }

  private spawnWorker() {
    const worker = new Worker(this.workerScript, this.getWorkerOptions());
    worker.on("message", (msg: WorkerMessage) =>
      this.onWorkerMessage(worker, msg),
    );
    worker.on("error", (err) => this.onWorkerError(worker, err));
    this.workers.push({ worker, idle: true });
  }

  private onWorkerMessage(worker: Worker, msg: WorkerMessage) {
    const workerInfo = this.workers.find((w) => w.worker === worker);
    if (workerInfo) {
      const task = this.currentTasks.get(worker);
      workerInfo.idle = true;
      this.currentTasks.delete(worker);

      if (task) {
        if (msg.type === "success") {
          task.resolve(msg.result);
        } else {
          task.reject(new Error(msg.error));
        }
      }
      this.nextTask();
    }
  }

  private onWorkerError(worker: Worker, err: Error | unknown) {
    const workerIndex = this.workers.findIndex((w) => w.worker === worker);
    if (workerIndex !== -1) {
      const task = this.currentTasks.get(worker);
      this.workers.splice(workerIndex, 1);
      this.currentTasks.delete(worker);

      if (task) {
        task.reject(err instanceof Error ? err : new Error(String(err)));
      } else {
        console.error("Worker error without task:", err);
      }

      // Avoid infinite loop if worker fails immediately
      if (task) {
        // Recreate the worker only if it was actually doing something, 
        // or add a more sophisticated throttle.
        // For now, if it failed without a task, it's likely a startup error.
        this.spawnWorker();
        this.nextTask();
      }
    }
  }

  public runTask(task: WorkerParams): Promise<ComponentFile> {
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
      idleWorker.worker.postMessage(task);
    }
  }

  public async terminate() {
    for (const w of this.workers) {
      await w.worker.terminate();
    }
  }
}
