import { Route, Routes } from "react-router-dom";
import "./App.css";
import FileGraphViewer from "./file-graph";
import FileGraphViewerG6 from "./file-graph-g6";
import GraphViewer from "./graph";
import FileViewerG6 from "./file-g6";
import FileKonvo from "./knovo";
import CusKonvo from "./cus-konvo";
import CusKonvoTest from "./cus-konvo-test";
import AppTest from "./perf-circle";
import CusKonvoTestHook from "./cus-konvo-test-use";

function App() {
  return (
    <Routes>
      <Route path="/view" element={<GraphViewer />} />
      <Route path="/konvo" element={<FileKonvo />} />
      <Route path="/cus-konvo" element={<CusKonvo />} />
      <Route path="/cus-konvo/test" element={<CusKonvoTest />} />
      <Route path="/cus-konvo/hook" element={<CusKonvoTestHook />} />
      <Route path="/graph" element={<FileGraphViewer />} />
      <Route path="/g6" element={<FileGraphViewerG6 />} />
      <Route path="/file" element={<FileViewerG6 />} />
      <Route path="/test" element={<AppTest />} />
    </Routes>
  );
}

export default App;
