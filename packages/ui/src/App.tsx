import { Route, Routes, useSearchParams } from "react-router-dom";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { SetupFlow } from "./components/setup-flow/SetupFlow";
import { useProjectStore } from "./hooks/use-project-store";

function App() {
  const { projectRoot: storedProjectRoot, _hasHydrated } = useProjectStore();
  const [searchParams] = useSearchParams();
  const urlProjectPath = searchParams.get("projectPath");
  const isEmpty = searchParams.get("empty") === "true";

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
