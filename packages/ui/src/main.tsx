import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { scan } from "react-scan";

scan({
  enabled: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);

// Use contextBridge
// eslint-disable-next-line @typescript-eslint/no-explicit-any
window.ipcRenderer.on("main-process-message", (_event: any, message: any) => {
  console.log(message);
});
