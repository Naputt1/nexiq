import React, { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart3,
  Clock,
  Zap,
  Target,
  FileJson,
  CheckCircle2,
  XCircle,
  Upload,
  ChevronDown,
  ChevronUp,
  Brain,
  Filter,
  Trash2,
  Plus,
  ArrowRightLeft,
  LayoutGrid,
  List,
  Check,
  Columns,
  RefreshCw,
  TrendingDown,
  BarChart as BarChartIcon,
} from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Minimal UI Components ---

const Card = ({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    className={cn(
      "bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden",
      className,
    )}
  >
    {children}
  </div>
);

const Button = ({
  children,
  onClick,
  variant = "primary",
  size = "md",
  className,
  disabled,
}: any) => {
  const variants: any = {
    primary: "bg-blue-600 text-white hover:bg-blue-700 shadow-sm",
    ghost: "hover:bg-gray-100 text-gray-600",
    outline: "border border-gray-200 hover:bg-gray-50 text-gray-700",
    danger: "bg-rose-50 text-rose-600 hover:bg-rose-100",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
  };
  const sizes: any = {
    sm: "px-3 py-1.5 text-xs",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-3 text-base font-bold",
  };
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "rounded-lg font-medium transition-all flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className,
      )}
    >
      {children}
    </button>
  );
};

const Badge = ({
  children,
  className,
  variant = "default",
}: {
  children: React.ReactNode;
  className?: string;
  variant?:
    | "default"
    | "blue"
    | "emerald"
    | "amber"
    | "rose"
    | "indigo"
    | "purple"
    | "cyan";
}) => {
  const variants: any = {
    default: "bg-gray-100 text-gray-600",
    blue: "bg-blue-100 text-blue-600",
    emerald: "bg-emerald-100 text-emerald-600",
    amber: "bg-amber-100 text-amber-600",
    rose: "bg-rose-100 text-rose-600",
    indigo: "bg-indigo-100 text-indigo-600",
    purple: "bg-purple-100 text-purple-600",
    cyan: "bg-cyan-100 text-cyan-600",
  };
  return (
    <span
      className={cn(
        "px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider",
        variants[variant],
        className,
      )}
    >
      {children}
    </span>
  );
};

// --- Types ---

interface BenchmarkResult {
  scenarioId: string;
  projectName: string;
  approach: "baseline" | "react-map-cold" | "react-map-warm";
  testType: "single-prompt" | "planning";
  model: string;
  success: boolean;
  totalTokens: number;
  toolCallsCount: number;
  latencyMs: number;
  verificationOutput?: {
    stdout: string;
    stderr: string;
    exitCode: number;
  };
  steps: any[];
  runId?: string;
  uniqueId: string; // Internal ID for comparison
}

// --- Main App ---

export default function App() {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<
    "overview" | "comparison" | "runs" | "timeline" | "compare-tasks"
  >("overview");

  // Auto-detection state
  const [detectedRunFiles, setDetectedRunFiles] = useState<string[]>([]);
  const [loadedRunFiles, setLoadedRunFiles] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Comparison Tab state
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const [compMetric, setCompMetric] = useState<
    "tokens" | "success" | "latency"
  >("tokens");
  const [compGroupBy, setCompGroupBy] = useState<
    "projectName" | "model" | "approach"
  >("projectName");
  const [compSeries, setCompSeries] = useState<
    "model" | "approach" | "testType" | "combined"
  >("combined");
  const [compRatioMode, setCompRatioMode] = useState(false);

  // Runs Tab state
  const [runMetric, setRunMetric] = useState<"tokens" | "success" | "latency">(
    "tokens",
  );

  // Filters
  const [filters, setFilters] = useState({
    models: [] as string[],
    approaches: [] as string[],
    projects: [] as string[],
    testTypes: [] as string[],
    status: "all" as "all" | "success" | "failure",
    searchTerm: "",
  });

  const uniqueModels = useMemo(
    () => Array.from(new Set(results.map((r) => r.model))),
    [results],
  );
  const uniqueApproaches = useMemo(
    () => Array.from(new Set(results.map((r) => r.approach))),
    [results],
  );
  const uniqueProjects = useMemo(
    () => Array.from(new Set(results.map((r) => r.projectName))),
    [results],
  );
  const uniqueTestTypes = useMemo(
    () => Array.from(new Set(results.map((r) => r.testType))),
    [results],
  );

  const addResults = useCallback((data: any, fileName: string) => {
    const newResults = Array.isArray(data) ? data : [data];
    const runId = fileName
      .split("/")
      .pop()
      ?.replace(/^run_/, "")
      .replace(/\.json$/, "")
      .replace(/\?url$/, "") || "";

    setResults((prev) => {
      // Avoid duplicate runs
      if (prev.some((r) => r.runId === runId)) return prev;

      const resultsWithIds = newResults.map((r, i) => {
        // Recalculate total tokens excluding system, user, and final summary
        const steps = r.steps || [];
        const isSummary = (step: any, index: number) =>
          step.role === "assistant" &&
          (!step.toolCalls || step.toolCalls.length === 0) &&
          index === steps.length - 1;

        const filteredTokens = steps.reduce(
          (acc: number, step: any, index: number) => {
            if (step.role === "system" || step.role === "user") return acc;
            if (isSummary(step, index)) return acc;
            return acc + (step.tokens || 0);
          },
          0,
        );

        return {
          ...r,
          totalTokens: filteredTokens,
          runId,
          uniqueId: `${runId}-${r.scenarioId}-${r.model}-${r.approach}-${r.testType}-${i}`,
        };
      });
      return [...prev, ...resultsWithIds];
    });
    setLoadedRunFiles((prev) => new Set([...prev, fileName]));
  }, []);

  // Auto-detect runs on mount and poll for new ones
  useEffect(() => {
    const fetchRuns = async () => {
      try {
        const response = await fetch('/api/results');
        const files: string[] = await response.json();
        setDetectedRunFiles(files.sort().reverse());
        
        // Auto-load the latest run if nothing is loaded yet
        if (files.length > 0 && loadedRunFiles.size === 0) {
            loadRun(files[0]);
        }
      } catch (err) {
        console.error("Failed to fetch runs:", err);
      }
    };

    fetchRuns();
    const interval = setInterval(fetchRuns, 5000); // Poll every 5 seconds
    return () => clearInterval(interval);
  }, [loadedRunFiles.size]);

  const loadRun = async (fileKey: string) => {
    if (loadedRunFiles.has(fileKey)) return;
    setIsLoading(true);
    try {
      // If it's a relative path from API, we can fetch it directly
      const response = await fetch(fileKey);
      const data = await response.json();
      addResults(data, fileKey);
    } catch (err) {
      console.error("Failed to load run:", fileKey, err);
    } finally {
      setIsLoading(false);
    }
  };

  const unloadRun = (runId: string) => {
    setResults((prev) => prev.filter((r) => r.runId !== runId));
    setLoadedRunFiles((prev) => {
      const next = new Set(prev);
      const fileKey = Array.from(prev).find((k) => {
        const id = k.split("/").pop()?.replace(/^run_/, "").replace(/\.json$/, "").replace(/\?url$/, "") || "";
        return id === runId;
      });
      if (fileKey) next.delete(fileKey);
      return next;
    });
  };

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      Array.from(e.dataTransfer.files).forEach((file) => {
        if (file.type === "application/json" || file.name.endsWith(".json")) {
          const reader = new FileReader();
          reader.onload = (event) => {
            try {
              const data = JSON.parse(event.target?.result as string);
              addResults(data, file.name);
            } catch (err) {
              alert("Invalid JSON file: " + file.name);
            }
          };
          reader.readAsText(file);
        }
      });
    },
    [addResults],
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          addResults(data, file.name);
        } catch (err) {
          alert("Invalid JSON file: " + file.name);
        }
      };
      reader.readAsText(file);
    });
  };

  const filteredResults = useMemo(() => {
    return results.filter((r) => {
      if (filters.models.length > 0 && !filters.models.includes(r.model))
        return false;
      if (
        filters.approaches.length > 0 &&
        !filters.approaches.includes(r.approach)
      )
        return false;
      if (
        filters.projects.length > 0 &&
        !filters.projects.includes(r.projectName)
      )
        return false;
      if (
        filters.testTypes.length > 0 &&
        !filters.testTypes.includes(r.testType)
      )
        return false;
      if (filters.status === "success" && !r.success) return false;
      if (filters.status === "failure" && r.success) return false;
      if (
        filters.searchTerm &&
        !r.scenarioId
          .toLowerCase()
          .includes(filters.searchTerm.toLowerCase()) &&
        !r.projectName.toLowerCase().includes(filters.searchTerm.toLowerCase())
      )
        return false;
      return true;
    });
  }, [results, filters]);

  const stats = useMemo(() => {
    if (filteredResults.length === 0) return null;
    const successCount = filteredResults.filter((r) => r.success).length;
    const totalTokens = filteredResults.reduce(
      (acc, r) => acc + r.totalTokens,
      0,
    );
    const avgLatency =
      filteredResults.reduce((acc, r) => acc + r.latencyMs, 0) /
      filteredResults.length;

    return {
      successRate: (successCount / filteredResults.length) * 100,
      totalTokens,
      avgLatency: Math.round(avgLatency),
      totalScenarios: filteredResults.length,
    };
  }, [filteredResults]);

  const dynamicCompData = useMemo(() => {
    // Group by the selected X-axis field (compGroupBy)
    const groupsMap = new Map<string, any>();

    // Baseline mapping for ratios
    const baselineMap = new Map<string, number>();
    if (compRatioMode) {
      filteredResults.forEach((r) => {
        if (r.approach === "baseline") {
          const key = `${r.projectName}-${r.scenarioId}-${r.model}-${r.testType}`;
          baselineMap.set(key, r.totalTokens);
        }
      });
    }

    filteredResults.forEach((r) => {
      const groupValue = r[compGroupBy] as string;
      if (!groupsMap.has(groupValue)) {
        groupsMap.set(groupValue, { name: groupValue });
      }
      const group = groupsMap.get(groupValue);

      let seriesKey = "";
      if (compSeries === "combined") {
        seriesKey = `${r.model} (${r.approach}) [${r.testType === "single-prompt" ? "S" : "P"}]`;
      } else if (compSeries === "model") {
        seriesKey = r.model;
      } else if (compSeries === "approach") {
        seriesKey = r.approach;
      } else if (compSeries === "testType") {
        seriesKey = r.testType;
      }

      if (!group[seriesKey]) {
        group[seriesKey] = { val: 0, count: 0, successCount: 0 };
      }

      let metricVal = 0;
      if (compMetric === "tokens") {
        if (compRatioMode) {
          const baselineKey = `${r.projectName}-${r.scenarioId}-${r.model}-${r.testType}`;
          const baselineTokens = baselineMap.get(baselineKey);
          if (baselineTokens && baselineTokens > 0) {
            metricVal = r.totalTokens / baselineTokens;
          } else {
            metricVal = 1.0; // Baseline to baseline ratio
          }
        } else {
          metricVal = r.totalTokens;
        }
      } else if (compMetric === "latency") {
        metricVal = r.latencyMs;
      } else if (compMetric === "success") {
        metricVal = r.success ? 100 : 0;
      }

      group[seriesKey].val += metricVal;
      group[seriesKey].count += 1;
      if (r.success) group[seriesKey].successCount += 1;
    });

    return Array.from(groupsMap.values()).map((g) => {
      const entry: any = { name: g.name };
      Object.keys(g).forEach((k) => {
        if (k !== "name") {
          entry[k] =
            compMetric === "success"
              ? (g[k].successCount / g[k].count) * 100
              : g[k].val / g[k].count;
        }
      });
      return entry;
    });
  }, [filteredResults, compMetric, compGroupBy, compSeries, compRatioMode]);

  const runsData = useMemo(() => {
    const runsMap = new Map<string, any>();

    filteredResults.forEach((r) => {
      const runId = r.runId || "unknown";
      if (!runsMap.has(runId)) {
        runsMap.set(runId, { runId });
      }
      const run = runsMap.get(runId);
      if (!run[r.model]) {
        run[r.model] = { tokens: 0, count: 0, successCount: 0, latency: 0 };
      }
      run[r.model].tokens += r.totalTokens;
      run[r.model].count += 1;
      run[r.model].latency += r.latencyMs;
      if (r.success) run[r.model].successCount += 1;
    });

    return Array.from(runsMap.values())
      .map((r) => {
        const entry: any = {
          name: r.runId.substring(0, 19).replace("T", " "),
          fullRunId: r.runId,
        };
        uniqueModels.forEach((model) => {
          if (r[model]) {
            entry[model] = Math.round(r[model].tokens / r[model].count);
            entry[`${model}_success`] =
              (r[model].successCount / r[model].count) * 100;
            entry[`${model}_latency`] = Math.round(
              r[model].latency / r[model].count,
            );
          }
        });
        return entry;
      })
      .sort((a, b) => a.fullRunId.localeCompare(b.fullRunId));
  }, [filteredResults, uniqueModels]);

  const toggleFilter = (
    type: "models" | "approaches" | "projects" | "testTypes",
    value: string,
  ) => {
    setFilters((prev) => {
      const current = prev[type] as string[];
      if (current.includes(value)) {
        return { ...prev, [type]: current.filter((v) => v !== value) };
      } else {
        return { ...prev, [type]: [...current, value] };
      }
    });
  };

  const toggleTaskSelection = (uniqueId: string) => {
    setSelectedTaskIds((prev) => {
      if (prev.includes(uniqueId)) {
        return prev.filter((id) => id !== uniqueId);
      } else {
        return [...prev, uniqueId];
      }
    });
  };

  const chartColors = [
    "#2563eb",
    "#7c3aed",
    "#db2777",
    "#ea580c",
    "#0891b2",
    "#16a34a",
    "#4f46e5",
    "#6366f1",
    "#f43f5e",
    "#10b981",
    "#f59e0b",
    "#8b5cf6",
    "#ec4899",
    "#06b6d4",
  ];

  const seriesKeys = Array.from(
    new Set(
      dynamicCompData.flatMap((d) =>
        Object.keys(d).filter((k) => k !== "name"),
      ),
    ),
  ).sort();

  const compareTasks = results.filter((r) =>
    selectedTaskIds.includes(r.uniqueId),
  );

  return (
    <div className="h-screen bg-gray-50 p-6 overflow-hidden">
      <div className="max-w-400 mx-auto flex flex-col h-full gap-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-gray-900 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">
                Benchmark Analysis
              </h1>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                {results.length} results loaded
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-white rounded-lg border border-gray-200 p-1 shadow-sm mr-2">
              <span className="text-[10px] font-black px-2 text-gray-400 uppercase tracking-widest">
                Selected: {selectedTaskIds.length}
              </span>
              {selectedTaskIds.length > 0 && (
                <>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={() => setActiveTab("compare-tasks")}
                  >
                    Compare
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedTaskIds([])}
                  >
                    Clear
                  </Button>
                </>
              )}
            </div>

            <Button
              variant="outline"
              onClick={() => {
                const input = document.createElement("input");
                input.type = "file";
                input.multiple = true;
                input.accept = ".json";
                input.onchange = (e: any) => handleFileSelect(e);
                input.click();
              }}
            >
              <Plus className="h-4 w-4" />
              Import
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setResults([]);
                setLoadedRunFiles(new Set());
                setSelectedTaskIds([]);
              }}
            >
              <Trash2 className="h-4 w-4" />
              Clear
            </Button>
          </div>
        </div>

        {/* Sidebar/Quick Select */}
        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 flex-1 min-h-0 overflow-hidden">
          <aside className="space-y-4 overflow-y-auto pr-2 custom-scrollbar pb-10">
            <Card className="p-4 bg-white">
              <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em] mb-4 flex items-center justify-between">
                Runs History
                <RefreshCw
                  className={cn(
                    "h-3 w-3 cursor-pointer",
                    isLoading && "animate-spin",
                  )}
                  onClick={() => window.location.reload()}
                />
              </h3>
              <div className="space-y-2 max-h-100 overflow-auto pr-2 custom-scrollbar">
                {detectedRunFiles.map((file) => {
                  const runId =
                    file
                      .split("/")
                      .pop()
                      ?.replace(/^run_/, "")
                      .replace(".json", "")
                      .replace("?url", "") || "";
                  const isLoaded = Array.from(loadedRunFiles).some((k) => {
                    const id = k.split("/").pop()?.replace(/^run_/, "").replace(/\.json$/, "").replace(/\?url$/, "") || "";
                    return id === runId;
                  });
                  return (
                    <div
                      key={file}
                      className={cn(
                        "p-2 rounded-lg border transition-all cursor-pointer group",
                        isLoaded
                          ? "bg-blue-50 border-blue-200 shadow-sm"
                          : "bg-gray-50 border-gray-100 hover:border-gray-300",
                      )}
                      onClick={() =>
                        isLoaded ? unloadRun(runId) : loadRun(file)
                      }
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={cn(
                            "text-xs font-bold truncate",
                            isLoaded ? "text-blue-700" : "text-gray-600",
                          )}
                        >
                          {runId.substring(0, 16).replace("T", " ")}
                        </span>
                        {isLoaded ? (
                          <Check className="h-3 w-3 text-blue-600" />
                        ) : (
                          <Plus className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100" />
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card className="p-4">
              <div className="flex items-center gap-2 mb-4">
                <Filter className="h-4 w-4 text-gray-400" />
                <span className="text-xs font-black text-gray-400 uppercase tracking-widest">
                  Global Filters
                </span>
              </div>

              <div className="space-y-4">
                <div className="relative">
                  <input
                    type="text"
                    placeholder="Search scenarios..."
                    className="w-full pl-3 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-inner bg-gray-50"
                    value={filters.searchTerm}
                    onChange={(e) =>
                      setFilters((prev) => ({
                        ...prev,
                        searchTerm: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="space-y-1">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                    Status
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {(["all", "success", "failure"] as const).map((s) => (
                      <button
                        key={s}
                        onClick={() =>
                          setFilters((prev) => ({ ...prev, status: s }))
                        }
                        className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold transition-all uppercase tracking-wider",
                          filters.status === s
                            ? "bg-gray-900 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                    Model
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {uniqueModels.map((model) => (
                      <button
                        key={model}
                        onClick={() => toggleFilter("models", model)}
                        className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold transition-all",
                          filters.models.includes(model)
                            ? "bg-blue-600 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                        )}
                      >
                        {model}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1">
                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                    Approach
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {uniqueApproaches.map((app) => (
                      <button
                        key={app}
                        onClick={() => toggleFilter("approaches", app)}
                        className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold transition-all",
                          filters.approaches.includes(app)
                            ? "bg-indigo-600 text-white"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200",
                        )}
                      >
                        {app}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </aside>

          <main className="flex flex-col gap-6 overflow-hidden">
            {/* Stats Dashboard */}
            {stats && (
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 shrink-0">
                <Card className="p-4 flex items-center gap-4 bg-blue-600 border-none shadow-lg shadow-blue-100 transition-transform hover:scale-[1.02]">
                  <div className="p-2 bg-white/10 rounded-xl">
                    <Target className="h-5 w-5 text-white" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-blue-100 uppercase tracking-widest">
                      Success Rate
                    </p>
                    <p className="text-2xl font-black text-white leading-tight">
                      {stats.successRate.toFixed(1)}%
                    </p>
                  </div>
                </Card>
                <Card className="p-4 flex items-center gap-4">
                  <div className="p-2 bg-amber-50 rounded-xl text-amber-600">
                    <Zap className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Total Tokens
                    </p>
                    <p className="text-2xl font-black text-gray-900 leading-tight">
                      {stats.totalTokens.toLocaleString()}
                    </p>
                  </div>
                </Card>
                <Card className="p-4 flex items-center gap-4">
                  <div className="p-2 bg-indigo-50 rounded-xl text-indigo-600">
                    <Clock className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Avg Latency
                    </p>
                    <p className="text-2xl font-black text-gray-900 leading-tight">
                      {stats.avgLatency}ms
                    </p>
                  </div>
                </Card>
                <Card className="p-4 flex items-center gap-4">
                  <div className="p-2 bg-emerald-50 rounded-xl text-emerald-600">
                    <BarChart3 className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                      Loaded Tasks
                    </p>
                    <p className="text-2xl font-black text-gray-900 leading-tight">
                      {filteredResults.length}
                    </p>
                  </div>
                </Card>
              </div>
            )}

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-gray-200 px-2 overflow-x-auto whitespace-nowrap scrollbar-hide shrink-0">
              {[
                { id: "overview", label: "Matrix", icon: LayoutGrid },
                { id: "comparison", label: "Comparison", icon: BarChartIcon },
                { id: "runs", label: "Trends", icon: Clock },
                { id: "timeline", label: "Timeline", icon: List },
                { id: "compare-tasks", label: "Task Diff", icon: Columns },
              ].map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={cn(
                    "px-4 py-3 text-sm font-bold flex items-center gap-2 border-b-2 transition-all",
                    activeTab === tab.id
                      ? "border-blue-600 text-blue-600 bg-blue-50/50"
                      : "border-transparent text-gray-400 hover:text-gray-600 hover:bg-gray-50",
                  )}
                >
                  <tab.icon className="h-4 w-4" />
                  {tab.label}{" "}
                  {tab.id === "compare-tasks" &&
                    selectedTaskIds.length > 0 &&
                    `(${selectedTaskIds.length})`}
                </button>
              ))}
            </div>

            {/* Tab Content Container */}
            <div className="flex-1 overflow-y-auto pr-2 custom-scrollbar min-h-0 pb-20">
              {/* Tab Content: Overview Matrix */}
              {activeTab === "overview" && (
                <Card className="p-0 border-none shadow-xl">
                  <div className="bg-gray-900 p-4">
                    <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                      <Brain className="h-4 w-4" />
                      Performance Matrix
                    </h2>
                  </div>
                  <div className="overflow-auto">
                    <table className="w-full text-sm text-left border-collapse">
                      <thead className="sticky top-0 bg-gray-50 z-10">
                        <tr className="border-b border-gray-100">
                          <th className="p-4 font-bold text-gray-600">Model</th>
                          <th className="p-4 font-bold text-gray-600">
                            Approach
                          </th>
                          <th className="p-4 font-bold text-gray-600">Type</th>
                          <th className="p-4 font-bold text-gray-600 text-center">
                            Success Rate
                          </th>
                          <th className="p-4 font-bold text-gray-600 text-right">
                            Avg Tokens
                          </th>
                          <th className="p-4 font-bold text-gray-600 text-right">
                            Avg Latency
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {uniqueModels.map((model) =>
                          uniqueApproaches.map((approach) =>
                            uniqueTestTypes.map((testType) => {
                              const rowResults = filteredResults.filter(
                                (r) =>
                                  r.model === model &&
                                  r.approach === approach &&
                                  r.testType === testType,
                              );
                              if (rowResults.length === 0) return null;

                              const successCount = rowResults.filter(
                                (r) => r.success,
                              ).length;
                              const avgTokens = Math.round(
                                rowResults.reduce(
                                  (acc, r) => acc + r.totalTokens,
                                  0,
                                ) / rowResults.length,
                              );
                              const avgLatency = Math.round(
                                rowResults.reduce(
                                  (acc, r) => acc + r.latencyMs,
                                  0,
                                ) / rowResults.length,
                              );
                              const successRate =
                                (successCount / rowResults.length) * 100;

                              return (
                                <tr
                                  key={`${model}-${approach}-${testType}`}
                                  className="hover:bg-gray-50 transition-colors group"
                                >
                                  <td className="p-4 font-bold text-gray-900">
                                    {model}
                                  </td>
                                  <td className="p-4">
                                    <Badge
                                      variant={
                                        approach === "baseline"
                                          ? "default"
                                          : "blue"
                                      }
                                    >
                                      {approach}
                                    </Badge>
                                  </td>
                                  <td className="p-4">
                                    <Badge
                                      variant={
                                        testType === "single-prompt"
                                          ? "cyan"
                                          : "purple"
                                      }
                                    >
                                      {testType === "single-prompt"
                                        ? "Single"
                                        : "Planning"}
                                    </Badge>
                                  </td>
                                  <td className="p-4">
                                    <div className="flex flex-col items-center gap-1">
                                      <span
                                        className={cn(
                                          "font-black text-lg",
                                          successRate === 100
                                            ? "text-emerald-600"
                                            : successRate > 0
                                              ? "text-amber-600"
                                              : "text-rose-600",
                                        )}
                                      >
                                        {successCount}/{rowResults.length}
                                      </span>
                                      <div className="w-20 h-1 bg-gray-100 rounded-full overflow-hidden">
                                        <div
                                          className={cn(
                                            "h-full",
                                            successRate === 100
                                              ? "bg-emerald-500"
                                              : "bg-amber-500",
                                          )}
                                          style={{ width: `${successRate}%` }}
                                        />
                                      </div>
                                    </div>
                                  </td>
                                  <td className="p-4 text-right font-mono font-bold text-gray-700">
                                    {avgTokens.toLocaleString()}
                                  </td>
                                  <td className="p-4 text-right font-mono text-gray-500">
                                    {avgLatency}ms
                                  </td>
                                </tr>
                              );
                            }),
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </Card>
              )}

              {/* Tab Content: Comparison Graph (Improved) */}
              {activeTab === "comparison" && (
                <div className="space-y-6">
                  <Card className="p-6 bg-white shadow-xl">
                    {/* Chart Controls */}
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8 p-4 bg-gray-50 rounded-2xl border border-gray-100">
                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                          Metric
                        </label>
                        <div className="flex bg-white p-1 rounded-lg border border-gray-200">
                          {(["tokens", "success", "latency"] as const).map(
                            (m) => (
                              <button
                                key={m}
                                onClick={() => setCompMetric(m)}
                                className={cn(
                                  "flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md transition-all",
                                  compMetric === m
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "text-gray-400 hover:text-gray-600",
                                )}
                              >
                                {m}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                          X-Axis Grouping
                        </label>
                        <div className="flex bg-white p-1 rounded-lg border border-gray-200">
                          {(["projectName", "model", "approach"] as const).map(
                            (g) => (
                              <button
                                key={g}
                                onClick={() => setCompGroupBy(g)}
                                className={cn(
                                  "flex-1 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md transition-all",
                                  compGroupBy === g
                                    ? "bg-blue-600 text-white shadow-md"
                                    : "text-gray-400 hover:text-gray-600",
                                )}
                              >
                                {g.replace("projectName", "Project")}
                              </button>
                            ),
                          )}
                        </div>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                          Series Legend
                        </label>
                        <select
                          className="w-full px-3 py-1.5 text-[10px] font-black uppercase tracking-wider bg-white border border-gray-200 rounded-lg outline-none"
                          value={compSeries}
                          onChange={(e) => setCompSeries(e.target.value as any)}
                        >
                          <option value="combined">Combined Details</option>
                          <option value="model">By Model</option>
                          <option value="approach">By Approach</option>
                          <option value="testType">By Test Type</option>
                        </select>
                      </div>

                      <div className="space-y-1">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest px-1">
                          Normalization
                        </label>
                        <button
                          onClick={() => setCompRatioMode(!compRatioMode)}
                          className={cn(
                            "w-full flex items-center justify-center gap-2 px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-lg border transition-all",
                            compRatioMode
                              ? "bg-amber-100 border-amber-200 text-amber-700 shadow-inner"
                              : "bg-white border-gray-200 text-gray-400",
                          )}
                          disabled={compMetric !== "tokens"}
                        >
                          <TrendingDown className="h-3 w-3" />
                          Ratio to Baseline
                        </button>
                      </div>
                    </div>

                    <h3 className="text-lg font-black text-gray-900 mb-6 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChartIcon className="h-5 w-5 text-blue-500" />
                        {compMetric === "tokens"
                          ? compRatioMode
                            ? "Token Efficiency Ratio"
                            : "Token Count"
                          : compMetric === "success"
                            ? "Success Rate %"
                            : "Avg Latency ms"}
                        <span className="text-xs font-normal text-gray-400 ml-2">
                          by{" "}
                          {compGroupBy === "projectName"
                            ? "Project"
                            : compGroupBy}
                        </span>
                      </div>
                      {compRatioMode && (
                        <Badge variant="amber" className="animate-pulse">
                          Ratio Mode
                        </Badge>
                      )}
                    </h3>

                    <div className="h-125 w-full mt-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={dynamicCompData}
                          margin={{ top: 20, right: 30, left: 20, bottom: 40 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis
                            dataKey="name"
                            axisLine={false}
                            tickLine={false}
                            tick={{
                              fill: "#94a3b8",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            dy={10}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{
                              fill: "#94a3b8",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            domain={
                              compMetric === "success"
                                ? [0, 100]
                                : compRatioMode
                                  ? [0, "auto"]
                                  : ["auto", "auto"]
                            }
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: "16px",
                              border: "none",
                              boxShadow: "0 20px 25px -5px rgb(0 0 0 / 0.1)",
                              padding: "12px",
                            }}
                            cursor={{ fill: "#f8fafc", radius: 4 }}
                          />
                          <Legend
                            iconType="circle"
                            wrapperStyle={{ paddingTop: "30px" }}
                          />
                          {seriesKeys.map((key, idx) => (
                            <Bar
                              key={key}
                              dataKey={key}
                              name={key}
                              fill={chartColors[idx % chartColors.length]}
                              radius={[6, 6, 0, 0]}
                              barSize={Math.max(10, 80 / seriesKeys.length)}
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <Card className="p-6">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">
                        By Project
                      </h3>
                      <div className="space-y-4 max-h-75 overflow-auto pr-2 custom-scrollbar">
                        {uniqueProjects.map((proj) => {
                          const projResults = filteredResults.filter(
                            (r) => r.projectName === proj,
                          );
                          const sr =
                            (projResults.filter((r) => r.success).length /
                              projResults.length) *
                            100;
                          return (
                            <div
                              key={proj}
                              className="flex items-center justify-between group"
                            >
                              <span className="text-sm font-bold text-gray-700">
                                {proj}
                              </span>
                              <Badge
                                variant={
                                  sr === 100
                                    ? "emerald"
                                    : sr > 0
                                      ? "amber"
                                      : "rose"
                                }
                              >
                                {sr.toFixed(0)}% SR
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                    <Card className="p-6">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">
                        By Model
                      </h3>
                      <div className="space-y-4">
                        {uniqueModels.map((model) => {
                          const mRes = filteredResults.filter(
                            (r) => r.model === model,
                          );
                          const avg = Math.round(
                            mRes.reduce((a, b) => a + b.totalTokens, 0) /
                              mRes.length,
                          );
                          return (
                            <div
                              key={model}
                              className="flex items-center justify-between"
                            >
                              <span className="text-sm font-bold text-gray-700">
                                {model}
                              </span>
                              <span className="text-xs font-mono text-gray-500">
                                {avg.toLocaleString()} tkns
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                    <Card className="p-6">
                      <h3 className="text-[10px] font-black uppercase tracking-widest text-gray-400 mb-4">
                        By Approach
                      </h3>
                      <div className="space-y-4">
                        {uniqueApproaches.map((app) => {
                          const aRes = filteredResults.filter(
                            (r) => r.approach === app,
                          );
                          const sr =
                            (aRes.filter((r) => r.success).length /
                              aRes.length) *
                            100;
                          return (
                            <div
                              key={app}
                              className="flex items-center justify-between"
                            >
                              <span className="text-sm font-bold text-gray-700 uppercase tracking-tighter">
                                {app}
                              </span>
                              <Badge
                                variant={
                                  sr === 100
                                    ? "emerald"
                                    : sr > 0
                                      ? "amber"
                                      : "rose"
                                }
                              >
                                {sr.toFixed(0)}% SR
                              </Badge>
                            </div>
                          );
                        })}
                      </div>
                    </Card>
                  </div>
                </div>
              )}

              {/* Tab Content: Trends */}
              {activeTab === "runs" && (
                <div className="space-y-6">
                  <Card className="p-6">
                    <div className="flex items-center justify-between mb-8">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                          <Clock className="h-5 w-5 text-blue-500" />
                          Model Performance Trends Over Runs
                        </h3>
                        <p className="text-xs text-gray-400 mt-1 uppercase tracking-widest font-bold">
                          Chronological benchmark comparison
                        </p>
                      </div>
                      <div className="flex bg-gray-100 p-1 rounded-lg border border-gray-200">
                        {(["tokens", "success", "latency"] as const).map(
                          (m) => (
                            <button
                              key={m}
                              onClick={() => setRunMetric(m)}
                              className={cn(
                                "px-3 py-1.5 text-[10px] font-black uppercase tracking-wider rounded-md transition-all",
                                runMetric === m
                                  ? "bg-white text-blue-600 shadow-sm"
                                  : "text-gray-400 hover:text-gray-600",
                              )}
                            >
                              {m === "tokens"
                                ? "Avg Tokens"
                                : m === "success"
                                  ? "Success Rate"
                                  : "Avg Latency"}
                            </button>
                          ),
                        )}
                      </div>
                    </div>

                    <div className="h-125 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart
                          data={runsData}
                          margin={{ top: 20, right: 30, left: 20, bottom: 60 }}
                        >
                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#f1f5f9"
                          />
                          <XAxis
                            dataKey="name"
                            axisLine={false}
                            tickLine={false}
                            tick={{
                              fill: "#94a3b8",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            angle={-45}
                            textAnchor="end"
                            interval={0}
                          />
                          <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{
                              fill: "#94a3b8",
                              fontSize: 10,
                              fontWeight: 700,
                            }}
                            domain={
                              runMetric === "success"
                                ? [0, 100]
                                : ["auto", "auto"]
                            }
                          />
                          <Tooltip
                            contentStyle={{
                              borderRadius: "16px",
                              border: "none",
                              boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                            }}
                          />
                          <Legend
                            verticalAlign="top"
                            height={36}
                            iconType="circle"
                            wrapperStyle={{
                              paddingTop: "0px",
                              paddingBottom: "30px",
                            }}
                          />
                          {uniqueModels.map((model, idx) => (
                            <Line
                              key={model}
                              type="monotone"
                              dataKey={
                                runMetric === "tokens"
                                  ? model
                                  : runMetric === "success"
                                    ? `${model}_success`
                                    : `${model}_latency`
                              }
                              name={model}
                              stroke={chartColors[idx % chartColors.length]}
                              strokeWidth={3}
                              dot={{
                                r: 4,
                                fill: chartColors[idx % chartColors.length],
                                strokeWidth: 2,
                                stroke: "#fff",
                              }}
                              activeDot={{ r: 6, strokeWidth: 0 }}
                            />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </Card>
                </div>
              )}

              {/* Tab Content: Timeline */}
              {activeTab === "timeline" && (
                <div className="space-y-4">
                  {filteredResults.map((result) => {
                    const id = result.uniqueId;
                    const isExpanded = expandedId === id;
                    const isSelected = selectedTaskIds.includes(id);
                    return (
                      <Card
                        key={id}
                        className={cn(
                          "transition-all border-none shadow-sm overflow-visible",
                          isExpanded
                            ? "ring-2 ring-blue-500 shadow-2xl z-10"
                            : "hover:shadow-md",
                        )}
                      >
                        <div className="flex">
                          <div
                            className={cn(
                              "w-12 flex flex-col items-center justify-center border-r border-gray-100 cursor-pointer transition-colors",
                              isSelected
                                ? "bg-emerald-50"
                                : "bg-gray-50 hover:bg-gray-100",
                            )}
                            onClick={() => toggleTaskSelection(id)}
                          >
                            <div
                              className={cn(
                                "w-5 h-5 rounded border flex items-center justify-center transition-all",
                                isSelected
                                  ? "bg-emerald-500 border-emerald-500 shadow-sm"
                                  : "border-gray-300 bg-white",
                              )}
                            >
                              {isSelected && (
                                <Check className="h-3 w-3 text-white" />
                              )}
                            </div>
                          </div>

                          <div
                            className="flex-1 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : id)
                            }
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-4">
                                {result.success ? (
                                  <div className="p-2 bg-emerald-100 rounded-full shadow-inner">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                  </div>
                                ) : (
                                  <div className="p-2 bg-rose-100 rounded-full shadow-inner">
                                    <XCircle className="h-4 w-4 text-rose-600" />
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center gap-2">
                                    <h3 className="font-bold text-gray-900 text-sm">
                                      {result.scenarioId}
                                    </h3>
                                    <Badge
                                      variant="default"
                                      className="text-[9px]"
                                    >
                                      {result.projectName}
                                    </Badge>
                                    <Badge
                                      variant={
                                        result.testType === "single-prompt"
                                          ? "cyan"
                                          : "purple"
                                      }
                                      className="text-[9px]"
                                    >
                                      {result.testType === "single-prompt"
                                        ? "Single"
                                        : "Planning"}
                                    </Badge>
                                  </div>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] font-bold text-blue-600">
                                      {result.model}
                                    </span>
                                    <span className="text-gray-300 text-[10px]">
                                      •
                                    </span>
                                    <span className="text-[10px] font-bold text-gray-400">
                                      {result.approach}
                                    </span>
                                    <span className="text-gray-300 text-[10px]">
                                      •
                                    </span>
                                    <span className="text-[10px] text-gray-400 font-mono">
                                      Run: {result.runId?.substring(0, 16)}
                                    </span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                <div className="text-right">
                                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                    Tokens
                                  </p>
                                  <p className="font-mono font-bold text-gray-900 text-sm">
                                    {result.totalTokens.toLocaleString()}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                                    Time
                                  </p>
                                  <p className="font-mono font-bold text-gray-900 text-sm">
                                    {result.latencyMs}ms
                                  </p>
                                </div>
                                {isExpanded ? (
                                  <ChevronUp className="h-4 w-4 text-gray-400" />
                                ) : (
                                  <ChevronDown className="h-4 w-4 text-gray-400" />
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {isExpanded && (
                          <div className="border-t border-gray-100 bg-gray-50/50 p-6 space-y-6 animate-in slide-in-from-top-2 duration-200">
                            {result.steps.map((step, sIdx) => (
                              <div key={sIdx} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <Badge
                                    variant={
                                      step.role === "user"
                                        ? "indigo"
                                        : step.role === "assistant"
                                          ? "emerald"
                                          : step.role === "tool"
                                            ? "purple"
                                            : "default"
                                    }
                                  >
                                    {step.role}
                                  </Badge>
                                  <span className="text-[10px] font-bold text-gray-400 font-mono">
                                    {step.tokens} tokens
                                  </span>
                                </div>

                                {step.content && (
                                  <div className="p-4 rounded-xl bg-white border border-gray-200 text-xs font-mono whitespace-pre-wrap max-h-100 overflow-auto shadow-inner text-gray-800 scrollbar-hide">
                                    {step.content}
                                  </div>
                                )}

                                {step.toolCalls && step.toolCalls.length > 0 && (
                                  <div className="grid gap-2">
                                    {step.toolCalls.map(
                                      (tc: any, tcIdx: number) => (
                                        <div
                                          key={tcIdx}
                                          className="p-4 rounded-xl bg-purple-50 border border-purple-100 text-xs"
                                        >
                                          <div className="flex items-center gap-2 font-black text-purple-700 uppercase tracking-wider text-[9px] mb-2">
                                            <Zap className="h-3 w-3" />
                                            Tool Call: {tc.name}
                                          </div>
                                          <pre className="text-[10px] text-purple-900 opacity-80 overflow-auto bg-white/50 p-3 rounded-lg border border-purple-100 shadow-inner scrollbar-hide">
                                            {JSON.stringify(
                                              tc.arguments,
                                              null,
                                              2,
                                            )}
                                          </pre>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                            {result.verificationOutput && (
                              <div className="space-y-4">
                                <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                                  <CheckCircle2 className={cn("h-4 w-4", result.verificationOutput.exitCode === 0 ? "text-emerald-500" : "text-rose-500")} />
                                  Verification Output
                                </h3>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                  {result.verificationOutput.stdout && (
                                    <div className="space-y-1">
                                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">STDOUT</p>
                                      <pre className="p-3 rounded-lg bg-gray-900 text-gray-300 text-[10px] font-mono whitespace-pre-wrap max-h-60 overflow-auto border border-gray-800 shadow-inner">
                                        {result.verificationOutput.stdout}
                                      </pre>
                                    </div>
                                  )}
                                  {result.verificationOutput.stderr && (
                                    <div className="space-y-1">
                                      <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest text-rose-400">STDERR</p>
                                      <pre className="p-3 rounded-lg bg-rose-950/30 text-rose-200 text-[10px] font-mono whitespace-pre-wrap max-h-60 overflow-auto border border-rose-900/30 shadow-inner">
                                        {result.verificationOutput.stderr}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Tab Content: Task Diff (Improved Compare) */}
              {activeTab === "compare-tasks" && (
                <div className="space-y-6">
                  {compareTasks.length === 0 ? (
                    <Card className="p-20 text-center bg-gray-50/50 border-dashed border-2 border-gray-200">
                      <Columns className="h-16 w-16 text-gray-200 mx-auto mb-4" />
                      <h3 className="text-xl font-bold text-gray-900 tracking-tight">
                        Comparison Queue Empty
                      </h3>
                      <p className="text-sm text-gray-500 mt-2 max-w-sm mx-auto">
                        Select tasks from the Timeline tab using the checkboxes
                        to see their execution history side-by-side.
                      </p>
                      <Button
                        variant="outline"
                        className="mt-8 mx-auto"
                        onClick={() => setActiveTab("timeline")}
                      >
                        Go to Timeline
                      </Button>
                    </Card>
                  ) : (
                    <div
                      className={cn(
                        "grid gap-6 items-start",
                        compareTasks.length === 1
                          ? "grid-cols-1"
                          : compareTasks.length === 2
                            ? "grid-cols-2"
                            : "grid-cols-3",
                      )}
                    >
                      {compareTasks.map((task) => (
                        <div key={task.uniqueId} className="space-y-4 min-w-0">
                          <Card className="p-4 bg-gray-900 text-white border-none shadow-xl">
                            <div className="flex items-center justify-between mb-3">
                              <Badge variant={task.success ? "emerald" : "rose"}>
                                {task.success ? "Success" : "Failure"}
                              </Badge>
                              <button
                                className="text-gray-400 hover:text-white transition-colors"
                                onClick={() =>
                                  toggleTaskSelection(task.uniqueId)
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                            <h3
                              className="font-bold text-sm mb-1 truncate"
                              title={task.scenarioId}
                            >
                              {task.scenarioId}
                            </h3>
                            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[9px] font-bold text-gray-400 uppercase tracking-widest">
                              <span className="text-blue-400">
                                {task.model}
                              </span>
                              <span>{task.approach}</span>
                              <span className="text-purple-400">
                                {task.testType}
                              </span>
                            </div>
                            <div className="mt-4 grid grid-cols-2 gap-4 border-t border-white/10 pt-4">
                              <div>
                                <p className="text-[8px] uppercase tracking-[0.2em] opacity-50 mb-1">
                                  Tokens
                                </p>
                                <p className="font-mono text-sm font-black">
                                  {task.totalTokens.toLocaleString()}
                                </p>
                              </div>
                              <div>
                                <p className="text-[8px] uppercase tracking-[0.2em] opacity-50 mb-1">
                                  Latency
                                </p>
                                <p className="font-mono text-sm font-black">
                                  {task.latencyMs}ms
                                </p>
                              </div>
                            </div>
                          </Card>

                          <div className="space-y-4">
                            {task.steps.map((step, sIdx) => (
                              <div key={sIdx} className="space-y-2 group">
                                <div className="flex items-center justify-between">
                                  <Badge
                                    variant={
                                      step.role === "user"
                                        ? "indigo"
                                        : step.role === "assistant"
                                          ? "emerald"
                                          : step.role === "tool"
                                            ? "purple"
                                            : "default"
                                    }
                                  >
                                    {step.role}
                                  </Badge>
                                  <span className="text-[9px] font-bold text-gray-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
                                    {step.tokens} tk
                                  </span>
                                </div>

                                {step.content && (
                                  <div className="p-4 rounded-xl bg-white border border-gray-200 text-[10px] font-mono whitespace-pre-wrap shadow-sm text-gray-800 leading-relaxed overflow-x-hidden">
                                    {step.content}
                                  </div>
                                )}

                                {step.toolCalls && step.toolCalls.length > 0 && (
                                  <div className="space-y-1">
                                    {step.toolCalls.map(
                                      (tc: any, tcIdx: number) => (
                                        <div
                                          key={tcIdx}
                                          className="p-3 rounded-xl bg-purple-50 border border-purple-100 text-[10px] shadow-inner"
                                        >
                                          <div className="font-black text-purple-700 uppercase text-[8px] mb-2 flex items-center gap-2">
                                            <Zap className="h-3 w-3" />
                                            {tc.name}
                                          </div>
                                          <pre className="text-[8px] text-purple-900 opacity-80 overflow-auto bg-white/40 p-2 rounded-lg border border-purple-100 scrollbar-hide">
                                            {JSON.stringify(
                                              tc.arguments,
                                              null,
                                              2,
                                            )}
                                          </pre>
                                        </div>
                                      ),
                                    )}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}
