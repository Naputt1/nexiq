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

interface SidebarProps {
  currentPath: string;
  projectRoot: string;
  onSelectProject: (path: string) => void;
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
          <SidebarGroupContent>
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
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarHeader>
      <SidebarContent></SidebarContent>
    </ShadcnSidebar>
  );
}
