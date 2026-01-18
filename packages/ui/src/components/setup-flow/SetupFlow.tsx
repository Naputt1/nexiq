import { useState } from "react";
import { WelcomeStep } from "./WelcomeStep";
import { ConfigStep } from "./ConfigStep";
import type { ProjectStatus } from "./types";
import { Button } from "../ui/button";

interface SetupFlowProps {
  onComplete: (path: string) => void;
}

export function SetupFlow({ onComplete }: SetupFlowProps) {
  const [step, setStep] = useState<"welcome" | "config">("welcome");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [projectStatus, setProjectStatus] = useState<ProjectStatus | null>(null);

  const handleSelectProject = async (path: string) => {
    setSelectedPath(path);
    try {
      const status = await window.ipcRenderer.invoke("check-project-status", path);
      setProjectStatus(status);
      setStep("config");
    } catch (error) {
      console.error("Failed to check project status", error);
      // Fallback or error handling
    }
  };

  const handleConfigConfirm = () => {
    if (selectedPath) {
      onComplete(selectedPath);
    }
  };

  if (step === "welcome") {
    return <WelcomeStep onSelectProject={handleSelectProject} />;
  }

  if (step === "config" && selectedPath && projectStatus) {
    return (
      <ConfigStep
        path={selectedPath}
        status={projectStatus}
        onConfirm={handleConfigConfirm}
        onBack={() => setStep("welcome")}
      />
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-950 text-white">
      <div className="text-center">
        <div className="animate-spin text-blue-500 mb-4 text-3xl">●</div>
        <p className="text-zinc-500">Loading...</p>
        <Button onClick={() => setStep("welcome")} variant="link" className="mt-4 text-red-500">
          Reset
        </Button>
      </div>
    </div>
  );
}
