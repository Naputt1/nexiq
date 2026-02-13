import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import type { ProjectStatus, ReactMapConfig } from "../../electron/types";

interface SettingsProps {
  projectPath: string;
}

export function ProjectSettings({ projectPath }: SettingsProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState<ProjectStatus | null>(null);
  const [ignorePatterns, setIgnorePatterns] = useState("");
  const [selectedIgnoreSubProjects, setSelectedIgnoreSubProjects] = useState<string[]>([]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const projectRes = await window.ipcRenderer.invoke("check-project-status", projectPath);
        setStatus(projectRes);
        if (projectRes.config) {
          setIgnorePatterns((projectRes.config.ignorePatterns || []).join("\n"));
          setSelectedIgnoreSubProjects(projectRes.config.ignoreSubProjects || []);
        }
      } catch (e) {
        console.error("Failed to fetch settings", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchData();
  }, [projectPath]);

  const goBack = () => {
    navigate(`/?projectPath=${encodeURIComponent(projectPath)}`);
  };

  const handleSave = async () => {
    if (!status) return;
    setIsSaving(true);
    try {
      const patterns = ignorePatterns
        .split("\n")
        .map((p) => p.trim())
        .filter((p) => p !== "");

      const config: ReactMapConfig = {
        ...status.config,
        ignorePatterns: patterns,
        ignoreSubProjects: selectedIgnoreSubProjects,
      };

      await window.ipcRenderer.invoke("save-project-config", {
        config,
        directoryPath: projectPath,
      });

      // Navigate back to the graph
      goBack();
    } catch (err: unknown) {
      console.error("Failed to save config", err);
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSubProject = (name: string) => {
    setSelectedIgnoreSubProjects((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Project Settings</h1>
        </div>
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save Changes
        </Button>
      </div>

      <div className="grid gap-6">
        <Card className="p-6 space-y-4">
          <div>
            <h2 className="text-xl font-semibold">Ignore Files</h2>
            <p className="text-sm text-muted-foreground">
              Add glob patterns to ignore files from analysis (one per line).
              Similar to .gitignore patterns.
            </p>
          </div>
          <Textarea
            value={ignorePatterns}
            onChange={(e) => setIgnorePatterns(e.target.value)}
            placeholder="**/node_modules/**&#10;**/*.test.tsx&#10;**/ignored-folder/**"
            className="min-h-[200px] font-mono whitespace-pre"
          />
        </Card>

        {status?.isMonorepo && (
          <Card className="p-6 space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Exclude Subprojects</h2>
              <p className="text-sm text-muted-foreground">
                Select subprojects to exclude from the project selector.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {status.subProjects.map((sp) => (
                <div key={sp.name} className="flex items-center space-x-2">
                  <Checkbox
                    id={`subproject-${sp.name}`}
                    checked={selectedIgnoreSubProjects.includes(sp.name)}
                    onCheckedChange={() => toggleSubProject(sp.name)}
                  />
                  <label
                    htmlFor={`subproject-${sp.name}`}
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    {sp.name}
                  </label>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
