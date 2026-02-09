import { useState, useEffect } from "react";
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
} from "@/components/ui/sidebar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "./ui/button";
import { LogOut, Files, GitBranch } from "lucide-react";
import { useProjectStore } from "@/hooks/use-project-store";
import { GitPanel } from "./GitPanel";
import { cn } from "@/lib/utils";

interface SidebarProps {
  currentPath: string;
  projectRoot: string;
  onSelectProject: (path: string) => void | Promise<void>;
  onLocateFile?: (filePath: string) => void;
  isLoading?: boolean;
}

interface SubProject {
  name: string;
  path: string;
}

export function ProjectSidebar({
  currentPath,
  projectRoot,
  onSelectProject,
  onLocateFile,
  isLoading,
}: SidebarProps) {
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
  const [activeTab, setActiveTab] = useState<"projects" | "git">("projects");
  const reset = useProjectStore((state) => state.reset);

  const handleReset = () => {
    reset();
    window.ipcRenderer.invoke("set-last-project", null);
  };

  useEffect(() => {
    const fetchSubProjects = async () => {
      try {
        const status = await window.ipcRenderer.invoke(
          "check-project-status",
          projectRoot,
        );
        if (status.subProjects) {
          setSubProjects(status.subProjects);
        }
      } catch (e) {
        console.error("Failed to fetch subprojects", e);
      }
    };
    fetchSubProjects();
  }, [projectRoot]);

  return (
    <ShadcnSidebar collapsible="offcanvas" className="border-r border-border">
      <SidebarHeader className="border-b border-border p-0">
        <div className="flex items-center w-full">
          <button 
            onClick={() => setActiveTab("projects")}
            className={cn(
              "flex-1 flex items-center justify-center py-3 border-b-2 transition-colors",
              activeTab === "projects" ? "border-primary bg-accent/30" : "border-transparent hover:bg-accent/10"
            )}
          >
            <Files className={cn("h-4 w-4", activeTab === "projects" ? "text-primary" : "text-muted-foreground")} />
          </button>
          <button 
            onClick={() => setActiveTab("git")}
            className={cn(
              "flex-1 flex items-center justify-center py-3 border-b-2 transition-colors",
              activeTab === "git" ? "border-primary bg-accent/30" : "border-transparent hover:bg-accent/10"
            )}
          >
            <GitBranch className={cn("h-4 w-4", activeTab === "git" ? "text-primary" : "text-muted-foreground")} />
          </button>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {activeTab === "projects" ? (
          <SidebarGroup className="p-0">
            <SidebarHeader className="border-none">
              <SidebarGroupContent className="flex items-center gap-2 p-2 pt-4">
                <Select
                  value={currentPath}
                  onValueChange={(val) => onSelectProject(val)}
                  disabled={isLoading}
                >
                  <SelectTrigger className="w-full">
                    <span>
                      <SelectValue placeholder="Select Project" />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={projectRoot}>
                      Root ({projectRoot.split("/").pop()})
                    </SelectItem>
                    {subProjects.map((pkg) => (
                      <SelectItem key={pkg.path} value={pkg.path}>
                        {pkg.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={handleReset}
                  title="Close Project"
                  className="h-9 w-9 shrink-0"
                >
                  <LogOut className="h-4 w-4" />
                </Button>
              </SidebarGroupContent>
            </SidebarHeader>
          </SidebarGroup>
        ) : (
          <GitPanel projectRoot={projectRoot} onLocateFile={onLocateFile} />
        )}
      </SidebarContent>
    </ShadcnSidebar>
  );
}
