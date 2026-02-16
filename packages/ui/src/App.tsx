import { Route, Routes, useSearchParams } from "react-router-dom";
import { useEffect } from "react";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";

import { ProjectSettings } from "./pages/ProjectSettings";
import { GlobalSettings } from "./pages/GlobalSettings";

function App() {
  const { projectRoot: storedProjectRoot, setProjectRoot } = useProjectStore();
  const [searchParams] = useSearchParams();
  
  // Try to get projectPath from hash (via useSearchParams) or from main URL search
  const urlProjectPath = searchParams.get("projectPath") || 
                         new URLSearchParams(window.location.search).get("projectPath");
  
  const isEmpty = searchParams.get("empty") === "true" || 
                  new URLSearchParams(window.location.search).get("empty") === "true";

  useEffect(() => {
    if (urlProjectPath) {
      setProjectRoot(urlProjectPath);
    }
  }, [urlProjectPath, setProjectRoot]);

  // Use project root from URL if available, otherwise from store (if not explicitly empty)
  const projectRoot = urlProjectPath || (isEmpty ? null : storedProjectRoot);

  useEffect(() => {
    if (projectRoot) {
      const name = projectRoot.split(/[/\\]/).filter(Boolean).pop();
      document.title = name ? `${name} - react-map` : "react-map";
    } else {
      document.title = "react-map";
    }
  }, [projectRoot]);

  const handleProjectComplete = async (path: string) => {
    // Save to main process first
    const wasFocusedElsewhere = await window.ipcRenderer.invoke(
      "set-last-project",
      path,
    );
    if (wasFocusedElsewhere) return;

    // Use hash-based navigation for compatibility with HashRouter
    window.location.hash = `/?projectPath=${encodeURIComponent(path)}`;
  };

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
