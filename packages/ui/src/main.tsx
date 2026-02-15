import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import { BrowserRouter } from "react-router-dom";
import { scan } from "react-scan";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { AppStatePluginComponent, GraphStatePluginComponent } from "./devtools";

scan({
  enabled: true,
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
      <TanStackDevtools
        plugins={[
          {
            name: "App State",
            render: <AppStatePluginComponent />,
          },
          {
            name: "Graph State",
            render: <GraphStatePluginComponent />,
          },
        ]}
      />
    </BrowserRouter>
  </StrictMode>,
);

// Use contextBridge
window.ipcRenderer.on("main-process-message", (message: string) => {
  console.log(message);
});
