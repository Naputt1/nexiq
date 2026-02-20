import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import type { ProjectStatus } from "./types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";

interface ConfigStepProps {
  path: string;
  status: ProjectStatus;
  onConfirm: (analysisPath?: string) => void;
  onBack: () => void;
}

export function ConfigStep({
  path: projectPath,
  status: initialStatus,
  onConfirm,
  onBack,
}: ConfigStepProps) {
  const [isSaving, setIsSaving] = useState(false);
  // Initialize analysisPath from existing config if available, otherwise default to projectPath
  const [analysisPath, setAnalysisPath] = useState(
    initialStatus.config?.analysisPath || projectPath,
  );
  const [currentStatus, setCurrentStatus] =
    useState<ProjectStatus>(initialStatus);

  // Update status when analysis path changes
  useEffect(() => {
    let active = true;
    const updateStatus = async () => {
      try {
        const newStatus = await window.ipcRenderer.invoke(
          "check-project-status",
          analysisPath,
        );
        if (active) {
          setCurrentStatus(newStatus);
        }
      } catch (e) {
        console.error("Failed to check status for", analysisPath, e);
      }
    };

    updateStatus();
    return () => {
      active = false;
    };
  }, [analysisPath]);

  const handleBrowseAnalysis = async () => {
    try {
      const path = await window.ipcRenderer.invoke("select-directory");
      if (path && typeof path === "string") {
        setAnalysisPath(path);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleConfirm = async () => {
    setIsSaving(true);
    try {
      // Merge existing config with new analysis settings
      const baseConfig = currentStatus.config ||
        initialStatus.config || {
          entry: "src/index.tsx",
        };

      const configToSave = {
        ...baseConfig,
        analysisPath: analysisPath !== projectPath ? analysisPath : undefined,
      };

      await window.ipcRenderer.invoke("save-project-config", {
        config: configToSave,
        directoryPath: projectPath,
      });

      // Trigger analysis
      await window.ipcRenderer.invoke(
        "analyze-project",
        analysisPath,
        projectPath,
      );

      onConfirm(analysisPath);
    } catch (error) {
      console.error("Failed to save config:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8 w-screen">
      <div className="w-full max-w-5xl flex flex-col gap-6">
        <Button
          onClick={onBack}
          variant="ghost"
          className="self-start text-muted-foreground hover:text-foreground"
        >
          ← Back
        </Button>

        <Card className="p-6 bg-card border-border">
          <h2 className="text-2xl font-bold mb-4 text-primary">
            Configure Project
          </h2>

          <div className="space-y-4 mb-6">
            {/* Main Project Path (Read Only) */}
            <div className="p-4 bg-muted/30 rounded border border-border">
              <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
                Project Root
              </label>
              <div className="font-mono text-sm text-muted-foreground break-all">
                {projectPath}
              </div>
            </div>

            {/* Analysis Directory Selector */}
            <div className="p-4 bg-muted/30 rounded border border-border">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-muted-foreground uppercase tracking-wider">
                  Analysis Target
                </label>
                <div className="flex gap-2">
                  {initialStatus.subProjects &&
                    initialStatus.subProjects.length > 0 && (
                      <Select
                        // className="bg-zinc-900 border border-zinc-700 text-xs rounded px-2 py-1 outline-none focus:border-blue-500"
                        value={
                          initialStatus.subProjects.find(
                            (p) => p.path === analysisPath,
                          )
                            ? analysisPath
                            : "custom"
                        }
                        onValueChange={(e) => {
                          if (e !== "custom") {
                            setAnalysisPath(e);
                          }
                        }}
                      >
                        <SelectTrigger className="w-full group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:justify-center">
                          <span className="group-data-[collapsible=icon]:hidden">
                            <SelectValue placeholder="Select Project" />
                          </span>
                        </SelectTrigger>

                        <SelectContent>
                          <SelectItem value={projectPath}>
                            Root ({projectPath.split("/").pop()})
                          </SelectItem>
                          {initialStatus.subProjects.map((pkg) => (
                            <SelectItem key={pkg.path} value={pkg.path}>
                              {pkg.name}
                            </SelectItem>
                          ))}
                          <SelectItem value="custom">Custom...</SelectItem>
                        </SelectContent>
                      </Select>
                    )}
                  <Button
                    onClick={handleBrowseAnalysis}
                    variant="outline"
                    size="sm"
                    className="h-6 text-xs border-border"
                  >
                    Browse
                  </Button>
                </div>
              </div>
              <div className="font-mono text-sm text-muted-foreground break-all">
                {analysisPath}
              </div>
              {analysisPath !== projectPath && (
                <p className="text-xs text-amber-500/80 mt-2">
                  Analyzing: {analysisPath}
                  <br />
                  Saving Config to: {projectPath}
                </p>
              )}
            </div>

            {/* Derived Status */}
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-muted/30 rounded border border-border">
                <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
                  Type
                </label>
                <div className="text-sm font-medium capitalize text-muted-foreground">
                  {currentStatus.projectType}
                </div>
              </div>
              <div className="p-4 bg-muted/30 rounded border border-border">
                <label className="text-xs text-muted-foreground uppercase tracking-wider block mb-1">
                  Structure
                </label>
                <div className="text-sm font-medium text-muted-foreground">
                  {currentStatus.isMonorepo ? "Monorepo" : "Single Project"}
                </div>
              </div>
            </div>

            {/* Config found status */}
            {initialStatus.hasConfig && (
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <span className="text-sm text-emerald-500/80">
                  Updating existing configuration
                </span>
              </div>
            )}

            {!initialStatus.hasConfig && (
              <div className="p-3 bg-amber-500/10 border border-amber-500/20 rounded flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-amber-500"></div>
                <span className="text-sm text-amber-500/80">
                  New configuration will be created
                </span>
              </div>
            )}
          </div>

          <Button
            onClick={handleConfirm}
            className="w-full bg-primary hover:bg-primary/90 text-primary-foreground"
            disabled={isSaving}
          >
            {isSaving
              ? "Setting up..."
              : initialStatus.hasConfig
                ? "Save & Load"
                : "Initialize Project"}
          </Button>
        </Card>
      </div>
    </div>
  );
}
