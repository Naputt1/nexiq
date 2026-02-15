import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowLeft, Save, Loader2 } from "lucide-react";
import type { CustomColors } from "../../electron/types";
import { Input } from "@/components/ui/input";

interface GlobalSettingsProps {
  projectPath?: string;
}

export function GlobalSettings({ projectPath }: GlobalSettingsProps) {
  const navigate = useNavigate();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [appTheme, setAppTheme] = useState<"dark" | "light">("dark");
  const [autoReload, setAutoReload] = useState<boolean>(true);
  const [customColors, setCustomColors] = useState<CustomColors>({});

  const goBack = () => {
    if (projectPath) {
      navigate(`/?projectPath=${encodeURIComponent(projectPath)}`);
    } else {
      navigate("/");
    }
  };

  useEffect(() => {
    const fetchGlobalConfig = async () => {
      try {
        const globalConfig = await window.ipcRenderer.invoke(
          "get-global-config",
        );
        if (globalConfig) {
          setAppTheme(globalConfig.theme);
          setAutoReload(
            globalConfig.autoReload !== undefined
              ? globalConfig.autoReload
              : true,
          );
          setCustomColors(globalConfig.customColors || {});
        }
      } catch (e) {
        console.error("Failed to fetch global config", e);
      } finally {
        setIsLoading(false);
      }
    };
    fetchGlobalConfig();
  }, []);

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await window.ipcRenderer.invoke("save-global-config", {
        theme: appTheme,
        autoReload: autoReload,
        customColors: customColors,
      });

      // Apply app theme immediately
      if (appTheme === "dark") {
        document.documentElement.classList.add("dark");
      } else {
        document.documentElement.classList.remove("dark");
      }

      // Navigate back
      goBack();
    } catch (err: unknown) {
      console.error("Failed to save global config", err);
    } finally {
      setIsSaving(false);
    }
  };

  const ColorInput = ({ label, colorKey, defaultValue }: { label: string; colorKey: keyof CustomColors; defaultValue: string }) => (
    <div className="flex items-center gap-4">
      <Input
        type="color"
        value={customColors[colorKey] || defaultValue}
        onChange={(e) => setCustomColors({ ...customColors, [colorKey]: e.target.value })}
        className="w-12 h-8 p-1"
      />
      <label className="text-xs">{label}</label>
    </div>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  const isDark = appTheme === "dark";

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={goBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-3xl font-bold tracking-tight">Global Settings</h1>
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
        <Card className="p-6 space-y-6">
          <div className="space-y-4">
            <div>
              <h2 className="text-xl font-semibold">Appearance</h2>
              <p className="text-sm text-muted-foreground">
                Customize the look and feel of the application.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2 text-start">
                <label className="text-sm font-medium">Application Theme</label>
                <select
                  value={appTheme}
                  onChange={(e) =>
                    setAppTheme(e.target.value as "dark" | "light")
                  }
                  className="w-full p-2 rounded-md border border-input bg-background"
                >
                  <option value="dark">Dark</option>
                  <option value="light">Light</option>
                </select>
              </div>
              <div className="flex items-center space-x-2 pt-8">
                <Checkbox
                  id="auto-reload"
                  checked={autoReload}
                  onCheckedChange={(checked) => setAutoReload(!!checked)}
                />
                <div className="grid gap-1.5 leading-none">
                  <label
                    htmlFor="auto-reload"
                    className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                  >
                    Auto-reload on file changes
                  </label>
                  <p className="text-xs text-muted-foreground">
                    Automatically re-analyze and refresh the graph when you save
                    files.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <div className="space-y-6 pt-6 border-t border-border">
            <h2 className="text-xl font-semibold">Appearance & Colors</h2>
            
            <div className="space-y-4">
              <h3 className="text-sm font-semibold opacity-70">Graph Base</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ColorInput label="Node Highlight" colorKey="nodeHighlight" defaultValue={isDark ? "#3b82f6" : "#2563eb"} />
                <ColorInput label="Combo Highlight" colorKey="comboHighlight" defaultValue={isDark ? "#3b82f6" : "#2563eb"} />
                <ColorInput label="Arrow Color" colorKey="arrowColor" defaultValue={isDark ? "#888888" : "#424242"} />
                <ColorInput label="Label Color" colorKey="labelColor" defaultValue={isDark ? "#ffffff" : "#000000"} />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-sm font-semibold opacity-70">Graph Node Types</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ColorInput label="Component" colorKey="componentNode" defaultValue={isDark ? "#3b82f6" : "#2563eb"} />
                <ColorInput label="Hook" colorKey="hookNode" defaultValue={isDark ? "#8b5cf6" : "#7c3aed"} />
                <ColorInput label="Callback" colorKey="callbackNode" defaultValue="#ef4444" />
                <ColorInput label="State" colorKey="stateNode" defaultValue="#ef4444" />
                <ColorInput label="Memo" colorKey="memoNode" defaultValue="#ef4444" />
                <ColorInput label="Ref" colorKey="refNode" defaultValue="#ef4444" />
                <ColorInput label="Effect" colorKey="effectNode" defaultValue="#eab308" />
                <ColorInput label="Prop" colorKey="propNode" defaultValue="#22c55e" />
                <ColorInput label="Render" colorKey="renderNode" defaultValue="#3b82f6" />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-sm font-semibold opacity-70">Git Status Colors</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ColorInput label="Git Added" colorKey="gitAdded" defaultValue="#22c55e" />
                <ColorInput label="Git Modified" colorKey="gitModified" defaultValue="#f59e0b" />
                <ColorInput label="Git Deleted" colorKey="gitDeleted" defaultValue="#ef4444" />
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/50">
              <h3 className="text-sm font-semibold opacity-70">Code Style (Props/Detail)</h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <ColorInput label="Keyword" colorKey="typeKeyword" defaultValue="#c084fc" />
                <ColorInput label="Literal" colorKey="typeLiteral" defaultValue="#fdba74" />
                <ColorInput label="String" colorKey="typeString" defaultValue="#86efac" />
                <ColorInput label="Number" colorKey="typeNumber" defaultValue="#93c5fd" />
                <ColorInput label="Boolean" colorKey="typeBoolean" defaultValue="#fde047" />
                <ColorInput label="Punctuation" colorKey="typePunctuation" defaultValue="#6b7280" />
                <ColorInput label="Reference" colorKey="typeReference" defaultValue="#60a5fa" />
                <ColorInput label="Component" colorKey="typeComponent" defaultValue="#67e8f9" />
                <ColorInput label="Default" colorKey="typeDefault" defaultValue="#d1d5db" />
                <ColorInput label="Generics" colorKey="genericsColor" defaultValue="#fde047" />
              </div>
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
