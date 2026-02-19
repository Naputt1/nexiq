import { useAppStateStore } from "@/hooks/use-app-state-store";
import type { GraphViewType } from "../../electron/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Layout } from "lucide-react";
import { cn } from "@/lib/utils";

export function ViewSwitcher({ className, isCollapsed }: { className?: string; isCollapsed?: boolean }) {
  const view = useAppStateStore((s) => s.view);
  const setView = useAppStateStore((s) => s.setView);

  if (isCollapsed) {
    return (
      <div className={cn("flex justify-center p-2", className)}>
        <Layout className="h-5 w-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2 p-2", className)}>
      <label className="text-[10px] font-bold uppercase text-muted-foreground px-2">
        View
      </label>
      <Select value={view} onValueChange={(val) => setView(val as GraphViewType)}>
        <SelectTrigger className="w-full h-8 text-xs">
          <div className="flex items-center gap-2">
            <Layout className="h-3.5 w-3.5" />
            <SelectValue placeholder="Select View" />
          </div>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="component">Component View</SelectItem>
          <SelectItem value="file">File View</SelectItem>
          <SelectItem value="router">Router View</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
