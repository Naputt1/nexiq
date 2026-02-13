import { Route, Routes, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";

import { ProjectSettings } from "./pages/ProjectSettings";
import { GlobalSettings } from "./pages/GlobalSettings";

function App() {
  const { projectRoot: storedProjectRoot, _hasHydrated, setProjectRoot } = useProjectStore();
  const [searchParams] = useSearchParams();
  const urlProjectPath = searchParams.get("projectPath");
  const isEmpty = searchParams.get("empty") === "true";

  useEffect(() => {
    if (urlProjectPath) {
      setProjectRoot(urlProjectPath);
    }
  }, [urlProjectPath, setProjectRoot]);

  // Use project root from URL if available, otherwise from store (if not explicitly empty)
  const projectRoot = urlProjectPath || (isEmpty ? null : storedProjectRoot);

  const handleProjectComplete = async (path: string) => {
    // Save to main process first
    const wasFocusedElsewhere = await window.ipcRenderer.invoke(
      "set-last-project",
      path,
    );
    if (wasFocusedElsewhere) return;

    // Then update URL to include the new project path
    window.location.search = `?projectPath=${encodeURIComponent(path)}`;
  };

  if (!_hasHydrated) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-zinc-950 text-white">
        <div className="animate-spin text-primary text-3xl">●</div>
      </div>
    );
  }

  if (!projectRoot) {
    return <SetupFlow onComplete={handleProjectComplete} />;
  }

  return (
    <Routes>
      <Route path="/" element={<ComponentGraph projectPath={projectRoot} />} />
      <Route
        path="/project-settings"
        element={<ProjectSettings projectPath={projectRoot} />}
      />
      <Route
        path="/global-settings"
        element={<GlobalSettings projectPath={projectRoot} />}
      />
    </Routes>
  );
}

export default App;
