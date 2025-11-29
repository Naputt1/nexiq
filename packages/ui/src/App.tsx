import { Route, Routes } from "react-router-dom";
import "./App.css";
import FileGraphViewer from "./file-graph";
import FileGraphViewerG6 from "./file-graph-g6";
import GraphViewer from "./graph";
import FileViewerG6 from "./file-g6";
import CusKonvoTestHook from "./cus-konvo";
import Dashboard from "./dashboard";

function App() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/view" element={<GraphViewer />} />
      <Route path="/cus-konvo" element={<CusKonvoTestHook />} />
      <Route path="/graph" element={<FileGraphViewer />} />
      <Route path="/g6" element={<FileGraphViewerG6 />} />
      <Route path="/file" element={<FileViewerG6 />} />
    </Routes>
  );
}

export default App;
