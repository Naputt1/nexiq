import { Route, Routes } from "react-router-dom";
import "./App.css";
import ComponentGraph from "./componentGraph";
import { useEffect, useState } from "react";
import { SetupFlow } from "./components/setup-flow/SetupFlow";

function App() {
  const [currentProject, setCurrentProject] = useState<string | null>(() => {
    return sessionStorage.getItem("currentProject");
  });

  useEffect(() => {
    if (currentProject) {
      sessionStorage.setItem("currentProject", currentProject);
    } else {
      sessionStorage.removeItem("currentProject");
    }
  }, [currentProject]);

  if (!currentProject) {
    return <SetupFlow onComplete={(path) => setCurrentProject(path)} />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<ComponentGraph projectPath={currentProject} />}
      />
    </Routes>
  );
}

export default App;
