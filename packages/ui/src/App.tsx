import { Route, Routes } from "react-router-dom";
import "./App.css";
import ComponentGraph from "./componentGraph";
import Dashboard from "./dashboard";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/component-graph" element={<ComponentGraph />} />
    </Routes>
  );
}

export default App;
