import { Route, Routes } from "react-router-dom";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";
import { useEffect } from "react";

function App() {
  const { projectRoot, setProjectRoot, _hasHydrated } = useProjectStore();

  useEffect(() => {
    if (_hasHydrated && !projectRoot) {
      // Try to recover from Electron store if local storage is empty
      window.ipcRenderer.invoke("get-last-project").then((lastRoot) => {
        if (lastRoot) {
          setProjectRoot(lastRoot);
        }
      });
    }
  }, [_hasHydrated, projectRoot, setProjectRoot]);

  const handleProjectComplete = (path: string) => {
    setProjectRoot(path);
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
