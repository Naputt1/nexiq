import { useState, useEffect } from "react";
import { Button } from "../ui/button";
import { Card } from "../ui/card";

interface WelcomeStepProps {
  onSelectProject: (path: string) => void;
}

export function WelcomeStep({ onSelectProject }: WelcomeStepProps) {
  const [recents, setRecents] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    // Load recent projects
    window.ipcRenderer.invoke("get-recent-projects").then((projects) => {
      if (Array.isArray(projects)) {
        setRecents(projects);
      }
    });
  }, []);

  const handleOpenProject = async () => {
    setIsLoading(true);
    try {
      const path = await window.ipcRenderer.invoke("select-directory");
      if (path && typeof path === "string") {
        onSelectProject(path);
      }
    } catch (e) {
      console.error("Failed to select directory", e);
    } finally {
      setIsLoading(false);
    }
  };

  const filteredRecents = recents.filter((path) =>
    path.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground p-8 w-screen">
      <div className="max-w-5xl w-full flex flex-col gap-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-blue-400 to-emerald-400 text-transparent bg-clip-text mb-4">
            Welcome to React Map
          </h1>
          <p className="text-muted-foreground text-lg">
            Visualize and analyze your React codebase.
          </p>
        </div>

        <Card className="p-6 bg-card border-border backdrop-blur-sm bg-opacity-50">
          <div className="flex flex-col gap-4">
            <Button
              onClick={handleOpenProject}
              className="w-full h-12 text-lg bg-primary hover:bg-primary/90 text-primary-foreground transition-colors"
              disabled={isLoading}
            >
              {isLoading ? "Opening..." : "Open Project Folder"}
            </Button>
            
            <div className="relative mt-4">
              <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
                <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input
                type="text"
                placeholder="Search recent projects..."
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                className="w-full bg-muted/50 border border-border rounded-md py-2 pl-10 pr-4 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary placeholder:text-muted-foreground/60"
              />
            </div>

            <div className="flex flex-col gap-2 mt-2 max-h-[300px] overflow-y-auto pr-2">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Recent Projects</h3>
              {filteredRecents.length === 0 ? (
                <p className="text-muted-foreground text-sm italic py-4 text-center">No recent projects found</p>
              ) : (
                filteredRecents.map((path) => (
                  <button
                    key={path}
                    onClick={() => onSelectProject(path)}
                    className="flex items-center w-full p-3 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors text-left group border border-transparent hover:border-border/50"
                  >
                    <div className="flex flex-col overflow-hidden">
                      <span className="text-sm font-medium text-foreground truncate group-hover:text-primary transition-colors">
                        {path.split("/").pop()}
                      </span>
                      <span className="text-xs text-muted-foreground truncate w-full" title={path}>
                        {path}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
