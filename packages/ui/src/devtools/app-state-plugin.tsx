// ... imports
import { useAppStateStore } from "../hooks/use-app-state-store";
import { useConfigStore } from "../hooks/use-config-store";
import { useGitStore } from "../hooks/useGitStore";
import { useProjectStore } from "../hooks/use-project-store";
import { JsonViewer } from "./json-viewer";
import type { UseBoundStore, StoreApi } from "zustand";

type GenericStore = UseBoundStore<StoreApi<Record<string, unknown>>>;

export const AppStatePluginComponent = () => {
  // ... (rest of the component)
  const appState = useAppStateStore();
  const configState = useConfigStore();
  const gitState = useGitStore();
  const projectState = useProjectStore();

  const combinedState = {
    app: appState,
    config: configState,
    git: gitState,
    project: projectState,
  };

  const handleEdit = (path: string[], value: unknown) => {
    const [storeName, ...restPath] = path;
    const store = (
      storeName === "app"
        ? useAppStateStore
        : storeName === "config"
          ? useConfigStore
          : storeName === "git"
            ? useGitStore
            : storeName === "project"
              ? useProjectStore
              : null
    ) as GenericStore | null;

    if (store) {
      // Very basic state update support.
      // For deep updates, we might need a deep merge or immer.
      // Assuming top-level keys for now or simple object updates.
      if (restPath.length === 1) {
        store.setState({ [restPath[0]]: value });
      } else {
        console.warn(
          "Deep updates not fully supported yet in this simple viewer",
        );
        // Try a shallow merge for 2nd level
        if (restPath.length === 2) {
          const parent = store.getState()[restPath[0]];
          if (parent && typeof parent === "object" && !Array.isArray(parent)) {
            store.setState({
              [restPath[0]]: {
                ...(parent as Record<string, unknown>),
                [restPath[1]]: value,
              },
            });
          }
        }
      }
    }
  };

  return (
    <div className="h-full flex flex-col text-white p-2 overflow-hidden">
      <div className="flex-1 overflow-auto">
        <JsonViewer data={combinedState} onEdit={handleEdit} />
      </div>
    </div>
  );
};
