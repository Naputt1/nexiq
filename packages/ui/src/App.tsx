import { Route, Routes, useSearchParams } from "react-router-dom";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";
import { useEffect, useState } from "react";

function App() {
  const { projectRoot: storedProjectRoot, setProjectRoot: setStoredProjectRoot, _hasHydrated } = useProjectStore();
  const [searchParams] = useSearchParams();
  const urlProjectPath = searchParams.get("projectPath");
  const isEmpty = searchParams.get("empty") === "true";
  
  // Use project root from URL if available, otherwise from store (if not explicitly empty)
  const projectRoot = urlProjectPath || (isEmpty ? null : storedProjectRoot);

  useEffect(() => {
    if (_hasHydrated && !projectRoot && !urlProjectPath && !isEmpty) {
      // Try to recover from Electron store if local storage is empty and no URL param and not explicitly empty
      window.ipcRenderer.invoke("get-last-project").then((lastRoot) => {
        if (lastRoot) {
          setStoredProjectRoot(lastRoot);
        }
      });
    }
  }, [_hasHydrated, projectRoot, urlProjectPath, isEmpty, setStoredProjectRoot]);

  const handleProjectComplete = (path: string) => {
    // Update URL to include the new project path, effectively removing 'empty' flag if it was there
    window.location.search = `?projectPath=${encodeURIComponent(path)}`;
    window.ipcRenderer.invoke("set-last-project", path);
  };

  if (!_hasHydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-950 text-white">
        <div className="animate-spin text-blue-500 text-3xl">●</div>
      </div>
    );
  }

  if (!projectRoot) {
    return <SetupFlow onComplete={handleProjectComplete} />;
  }

  return (
    <Routes>
      <Route path="/" element={<ComponentGraph projectPath={projectRoot} />} />
    </Routes>
  );
}

export default App;
