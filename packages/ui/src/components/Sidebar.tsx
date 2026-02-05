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
import { LogOut } from "lucide-react";
import { useProjectStore } from "@/hooks/use-project-store";

interface SidebarProps {
  currentPath: string;
  projectRoot: string;
  onSelectProject: (path: string) => void | Promise<void>;
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
  isLoading,
}: SidebarProps) {
  const [subProjects, setSubProjects] = useState<SubProject[]>([]);
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
    <ShadcnSidebar collapsible="offcanvas">
      <SidebarHeader>
        <SidebarGroup className="px-0">
          <SidebarGroupContent className="flex items-center gap-2 p-2">
            <Select
              value={currentPath}
              onValueChange={(val) => onSelectProject(val)}
              disabled={isLoading}
            >
              <SelectTrigger className="w-full group-data-[collapsible=icon]:px-1 group-data-[collapsible=icon]:justify-center">
                <span className="group-data-[collapsible=icon]:hidden">
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
        </SidebarGroup>
      </SidebarHeader>
      <SidebarContent></SidebarContent>
    </ShadcnSidebar>
  );
}
