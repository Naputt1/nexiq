import { useEffect } from "react";
import { useWorkerStore } from "../hooks/use-worker-store";
import { JsonViewer } from "./json-viewer";
import { RefreshCcw } from "lucide-react";

export const WorkerStatePluginComponent = () => {
  const registryState = useWorkerStore((s) => s.registryState);
  const refreshRegistry = useWorkerStore((s) => s.refreshRegistry);
  const worker = useWorkerStore((s) => s.worker);

  useEffect(() => {
    if (worker) {
      refreshRegistry();
    }
  }, [worker, refreshRegistry]);

  if (!worker) {
    return <div className="text-zinc-500 p-4">No View Worker Active</div>;
  }

  return (
    <div className="h-full flex flex-col text-white p-2 overflow-hidden">
      <div className="flex items-center justify-between mb-2 px-2">
        <span className="text-xs font-semibold text-zinc-400">
          Worker Registry State
        </span>
        <button
          onClick={refreshRegistry}
          className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-white transition-colors"
          title="Refresh Registry"
        >
          <RefreshCcw size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        <JsonViewer data={registryState} />
      </div>
      {registryState && (
        <div className="text-[10px] text-zinc-500 mt-2 px-2">
          Last updated: {new Date(registryState.lastUpdated).toLocaleTimeString()}
        </div>
      )}
    </div>
  );
};
