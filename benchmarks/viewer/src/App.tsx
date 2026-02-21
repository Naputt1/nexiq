import React, { useState, useMemo, useCallback } from 'react';
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
  List
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Minimal UI Components ---

const Card = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <div className={cn("bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden", className)}>
    {children}
  </div>
);

const Button = ({ children, onClick, variant = 'primary', size = 'md', className }: any) => {
  const variants: any = {
    primary: 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm',
    ghost: 'hover:bg-gray-100 text-gray-600',
    outline: 'border border-gray-200 hover:bg-gray-50 text-gray-700',
    danger: 'bg-rose-50 text-rose-600 hover:bg-rose-100'
  };
  const sizes: any = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base font-bold'
  };
  return (
    <button onClick={onClick} className={cn("rounded-lg font-medium transition-all flex items-center gap-2 disabled:opacity-50", variants[variant], sizes[size], className)}>
      {children}
    </button>
  );
};

const Badge = ({ children, className, variant = 'default' }: { children: React.ReactNode; className?: string; variant?: 'default' | 'blue' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'purple' }) => {
  const variants: any = {
    default: 'bg-gray-100 text-gray-600',
    blue: 'bg-blue-100 text-blue-600',
    emerald: 'bg-emerald-100 text-emerald-600',
    amber: 'bg-amber-100 text-amber-600',
    rose: 'bg-rose-100 text-rose-600',
    indigo: 'bg-indigo-100 text-indigo-600',
    purple: 'bg-purple-100 text-purple-600'
  };
  return (
    <span className={cn("px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider", variants[variant], className)}>
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
  steps: any[];
  runId?: string; // To track different file loads
}

// --- Main App ---

export default function App() {
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'comparison' | 'timeline'>('overview');
  
  // Filters
  const [filters, setFilters] = useState({
    models: [] as string[],
    approaches: [] as string[],
    projects: [] as string[],
    status: 'all' as 'all' | 'success' | 'failure',
    searchTerm: ''
  });

  const uniqueModels = useMemo(() => Array.from(new Set(results.map(r => r.model))), [results]);
  const uniqueApproaches = useMemo(() => Array.from(new Set(results.map(r => r.approach))), [results]);
  const uniqueProjects = useMemo(() => Array.from(new Set(results.map(r => r.projectName))), [results]);

  const addResults = useCallback((data: any) => {
    const newResults = Array.isArray(data) ? data : [data];
    const runId = new Date().toISOString();
    setResults(prev => [...prev, ...newResults.map(r => ({ ...r, runId }))]);
  }, []);

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    Array.from(e.dataTransfer.files).forEach(file => {
      if (file.type === "application/json") {
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target?.result as string);
            addResults(data);
          } catch (err) {
            alert("Invalid JSON file: " + file.name);
          }
        };
        reader.readAsText(file);
      }
    });
  }, [addResults]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    Array.from(e.target.files || []).forEach(file => {
      const reader = new FileReader();
      reader.onload = (event) => {
        try {
          const data = JSON.parse(event.target?.result as string);
          addResults(data);
        } catch (err) {
          alert("Invalid JSON file: " + file.name);
        }
      };
      reader.readAsText(file);
    });
  };

  const filteredResults = useMemo(() => {
    return results.filter(r => {
      if (filters.models.length > 0 && !filters.models.includes(r.model)) return false;
      if (filters.approaches.length > 0 && !filters.approaches.includes(r.approach)) return false;
      if (filters.projects.length > 0 && !filters.projects.includes(r.projectName)) return false;
      if (filters.status === 'success' && !r.success) return false;
      if (filters.status === 'failure' && r.success) return false;
      if (filters.searchTerm && !r.scenarioId.toLowerCase().includes(filters.searchTerm.toLowerCase()) && !r.projectName.toLowerCase().includes(filters.searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [results, filters]);

  const stats = useMemo(() => {
    if (filteredResults.length === 0) return null;
    const successCount = filteredResults.filter(r => r.success).length;
    const totalTokens = filteredResults.reduce((acc, r) => acc + r.totalTokens, 0);
    const avgLatency = filteredResults.reduce((acc, r) => acc + r.latencyMs, 0) / filteredResults.length;
    
    return {
      successRate: (successCount / filteredResults.length) * 100,
      totalTokens,
      avgLatency: Math.round(avgLatency),
      totalScenarios: filteredResults.length
    };
  }, [filteredResults]);

  const comparisonData = useMemo(() => {
    // Group by Project and then Model/Approach
    const projectMap = new Map<string, any>();
    
    filteredResults.forEach(r => {
      if (!projectMap.has(r.projectName)) {
        projectMap.set(r.projectName, { name: r.projectName });
      }
      const proj = projectMap.get(r.projectName);
      const key = `${r.model} (${r.approach})`;
      if (!proj[key]) {
        proj[key] = { tokens: 0, count: 0, successCount: 0 };
      }
      proj[key].tokens += r.totalTokens;
      proj[key].count += 1;
      if (r.success) proj[key].successCount += 1;
    });

    return Array.from(projectMap.values()).map(p => {
      const entry: any = { name: p.name };
      Object.keys(p).forEach(k => {
        if (k !== 'name') {
          entry[k] = Math.round(p[k].tokens / p[k].count);
          entry[`${k}_success`] = (p[k].successCount / p[k].count) * 100;
        }
      });
      return entry;
    });
  }, [filteredResults]);

  const toggleFilter = (type: 'models' | 'approaches' | 'projects', value: string) => {
    setFilters(prev => {
      const current = prev[type] as string[];
      if (current.includes(value)) {
        return { ...prev, [type]: current.filter(v => v !== value) };
      } else {
        return { ...prev, [type]: [...current, value] };
      }
    });
  };

  if (results.length === 0) {
    return (
      <div 
        className={cn(
          "min-h-screen flex flex-col items-center justify-center p-8 transition-colors",
          isDragging ? "bg-blue-50" : "bg-gray-50"
        )}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
      >
        <div className="max-w-md w-full text-center space-y-6">
          <div className="p-8 bg-white rounded-3xl shadow-2xl border-2 border-dashed border-gray-200">
            <div className="p-4 bg-blue-50 w-fit mx-auto rounded-2xl mb-4">
              <Upload className="h-12 w-12 text-blue-500" />
            </div>
            <h1 className="text-3xl font-black text-gray-900 tracking-tight">Benchmark Viewer</h1>
            <p className="text-gray-500 mt-2">
              Drag and drop your <code className="bg-gray-100 px-1 rounded">run_*.json</code> files here to analyze and compare results.
            </p>
            <div className="mt-8 flex flex-col gap-3">
              <label className="cursor-pointer inline-flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-4 rounded-xl font-bold hover:bg-blue-700 transition-all shadow-lg shadow-blue-200 hover:-translate-y-0.5 active:translate-y-0">
                <input type="file" className="hidden" onChange={handleFileSelect} accept=".json" multiple />
                Select Result Files
              </label>
              <p className="text-xs text-gray-400">Multiple files are supported for comparison.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const chartColors = [
    '#2563eb', '#7c3aed', '#db2777', '#ea580c', '#0891b2', '#16a34a', '#4f46e5'
  ];

  const keysToCompare = Array.from(new Set(
    comparisonData.flatMap(d => Object.keys(d).filter(k => k !== 'name' && !k.endsWith('_success')))
  ));

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-[1400px] mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="p-2 bg-gray-900 rounded-lg">
              <BarChart3 className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-black text-gray-900 tracking-tight">Benchmark Analysis</h1>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">{results.length} results loaded</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => {
               const input = document.createElement('input');
               input.type = 'file';
               input.multiple = true;
               input.accept = '.json';
               input.onchange = (e: any) => handleFileSelect(e);
               input.click();
            }}>
              <Plus className="h-4 w-4" />
              Add More Files
            </Button>
            <Button variant="danger" onClick={() => setResults([])}>
              <Trash2 className="h-4 w-4" />
              Clear All
            </Button>
          </div>
        </div>

        {/* Filters */}
        <Card className="p-4 bg-white border-none shadow-sm flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 pr-4 border-r border-gray-100">
            <Filter className="h-4 w-4 text-gray-400" />
            <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">Filters</span>
          </div>
          
          <div className="flex flex-wrap items-center gap-2 flex-1">
            <div className="relative">
              <input 
                type="text" 
                placeholder="Search scenarios..." 
                className="pl-3 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
                value={filters.searchTerm}
                onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
              />
            </div>

            {/* Models Filter */}
            <div className="flex flex-wrap gap-1">
              {uniqueModels.map(model => (
                <button
                  key={model}
                  onClick={() => toggleFilter('models', model)}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                    filters.models.includes(model) ? "bg-blue-600 text-white shadow-md shadow-blue-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {model}
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-100 mx-1" />

            {/* Approaches Filter */}
            <div className="flex flex-wrap gap-1">
              {uniqueApproaches.map(app => (
                <button
                  key={app}
                  onClick={() => toggleFilter('approaches', app)}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all",
                    filters.approaches.includes(app) ? "bg-indigo-600 text-white shadow-md shadow-indigo-100" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {app}
                </button>
              ))}
            </div>

            <div className="w-px h-6 bg-gray-100 mx-1" />

            {/* Status Filter */}
            <div className="flex gap-1">
              {(['all', 'success', 'failure'] as const).map(s => (
                <button
                  key={s}
                  onClick={() => setFilters(prev => ({ ...prev, status: s }))}
                  className={cn(
                    "px-2 py-1 rounded-md text-[10px] font-bold transition-all uppercase tracking-wider",
                    filters.status === s ? "bg-gray-900 text-white shadow-md" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </Card>

        {/* Stats */}
        {stats && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="p-6 flex items-center gap-4 bg-blue-600 border-none shadow-lg shadow-blue-100">
              <div className="p-3 bg-white/10 rounded-2xl">
                <Target className="h-6 w-6 text-white" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-blue-100 uppercase tracking-widest">Success Rate</p>
                <p className="text-3xl font-black text-white leading-tight">{stats.successRate.toFixed(1)}%</p>
              </div>
            </Card>
            <Card className="p-6 flex items-center gap-4">
              <div className="p-3 bg-amber-50 rounded-2xl">
                <Zap className="h-6 w-6 text-amber-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Total Tokens</p>
                <p className="text-3xl font-black text-gray-900 leading-tight">{stats.totalTokens.toLocaleString()}</p>
              </div>
            </Card>
            <Card className="p-6 flex items-center gap-4">
              <div className="p-3 bg-indigo-50 rounded-2xl">
                <Clock className="h-6 w-6 text-indigo-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Avg Latency</p>
                <p className="text-3xl font-black text-gray-900 leading-tight">{stats.avgLatency}ms</p>
              </div>
            </Card>
            <Card className="p-6 flex items-center gap-4">
              <div className="p-3 bg-emerald-50 rounded-2xl">
                <BarChart3 className="h-6 w-6 text-emerald-600" />
              </div>
              <div>
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Filtered Results</p>
                <p className="text-3xl font-black text-gray-900 leading-tight">{filteredResults.length}</p>
              </div>
            </Card>
          </div>
        )}

        {/* Tabs */}
        <div className="flex items-center gap-4 border-b border-gray-200 px-2">
          <button 
            onClick={() => setActiveTab('overview')}
            className={cn(
              "px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition-all",
              activeTab === 'overview' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Overview
          </button>
          <button 
            onClick={() => setActiveTab('comparison')}
            className={cn(
              "px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition-all",
              activeTab === 'comparison' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"
            )}
          >
            <ArrowRightLeft className="h-4 w-4" />
            Comparison Graph
          </button>
          <button 
            onClick={() => setActiveTab('timeline')}
            className={cn(
              "px-4 py-2 text-sm font-bold flex items-center gap-2 border-b-2 transition-all",
              activeTab === 'timeline' ? "border-blue-600 text-blue-600" : "border-transparent text-gray-400 hover:text-gray-600"
            )}
          >
            <List className="h-4 w-4" />
            Timeline
          </button>
        </div>

        {/* Tab Content: Overview */}
        {activeTab === 'overview' && (
          <Card className="p-0 border-none shadow-xl">
            <div className="bg-gray-900 p-4">
              <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-gray-400 flex items-center gap-2">
                <Brain className="h-4 w-4" />
                Performance Matrix
              </h2>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="p-4 font-bold text-gray-600">Model</th>
                    <th className="p-4 font-bold text-gray-600">Approach</th>
                    <th className="p-4 font-bold text-gray-600 text-center">Success Rate</th>
                    <th className="p-4 font-bold text-gray-600 text-right">Avg Tokens</th>
                    <th className="p-4 font-bold text-gray-600 text-right">Avg Latency</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {uniqueModels.map(model => (
                    uniqueApproaches.map(approach => {
                      const rowResults = filteredResults.filter(r => r.model === model && r.approach === approach);
                      if (rowResults.length === 0) return null;
                      
                      const successCount = rowResults.filter(r => r.success).length;
                      const avgTokens = Math.round(rowResults.reduce((acc, r) => acc + r.totalTokens, 0) / rowResults.length);
                      const avgLatency = Math.round(rowResults.reduce((acc, r) => acc + r.latencyMs, 0) / rowResults.length);
                      const successRate = (successCount / rowResults.length) * 100;

                      return (
                        <tr key={`${model}-${approach}`} className="hover:bg-gray-50 transition-colors">
                          <td className="p-4 font-bold text-gray-900">{model}</td>
                          <td className="p-4">
                            <Badge variant={approach === 'baseline' ? 'default' : 'blue'}>{approach}</Badge>
                          </td>
                          <td className="p-4">
                            <div className="flex flex-col items-center gap-1">
                              <span className={cn(
                                "font-black text-lg",
                                successRate === 100 ? 'text-emerald-600' : successRate > 0 ? 'text-amber-600' : 'text-rose-600'
                              )}>
                                {successCount}/{rowResults.length}
                              </span>
                              <div className="w-20 h-1 bg-gray-100 rounded-full overflow-hidden">
                                <div className={cn("h-full", successRate === 100 ? 'bg-emerald-500' : 'bg-amber-500')} style={{ width: `${successRate}%` }} />
                              </div>
                            </div>
                          </td>
                          <td className="p-4 text-right font-mono font-bold text-gray-700">{avgTokens.toLocaleString()}</td>
                          <td className="p-4 text-right font-mono text-gray-500">{avgLatency}ms</td>
                        </tr>
                      );
                    })
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* Tab Content: Comparison Graph */}
        {activeTab === 'comparison' && (
          <div className="grid grid-cols-1 gap-6">
            <Card className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                <Brain className="h-5 w-5 text-blue-500" />
                Token Efficiency Comparison (Lower is Better)
              </h3>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                      dy={10}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      cursor={{ fill: '#f8fafc' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                    {keysToCompare.map((key, idx) => (
                      <Bar 
                        key={key} 
                        dataKey={key} 
                        name={key}
                        fill={chartColors[idx % chartColors.length]} 
                        radius={[4, 4, 0, 0]}
                        barSize={20}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card className="p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-500" />
                Success Rate Comparison (%)
              </h3>
              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={comparisonData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                      dy={10}
                    />
                    <YAxis 
                      domain={[0, 100]}
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <Tooltip 
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      cursor={{ fill: '#f8fafc' }}
                    />
                    <Legend iconType="circle" wrapperStyle={{ paddingTop: '20px' }} />
                    {keysToCompare.map((key, idx) => (
                      <Bar 
                        key={`${key}_success`} 
                        name={`${key} SR`}
                        dataKey={`${key}_success`} 
                        fill={chartColors[idx % chartColors.length]} 
                        radius={[4, 4, 0, 0]}
                        barSize={20}
                      />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card className="p-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">By Project</h3>
                <div className="space-y-4">
                  {uniqueProjects.map(proj => {
                    const projResults = filteredResults.filter(r => r.projectName === proj);
                    const successRate = (projResults.filter(r => r.success).length / projResults.length) * 100;
                    return (
                      <div key={proj} className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-700">{proj}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gray-400">{projResults.length} runs</span>
                          <Badge variant={successRate === 100 ? 'emerald' : successRate > 0 ? 'amber' : 'rose'}>{successRate.toFixed(0)}% SR</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
              <Card className="p-6">
                <h3 className="text-sm font-black uppercase tracking-widest text-gray-400 mb-4">By Model</h3>
                <div className="space-y-4">
                  {uniqueModels.map(model => {
                    const modelResults = filteredResults.filter(r => r.model === model);
                    const avgTokens = Math.round(modelResults.reduce((acc, r) => acc + r.totalTokens, 0) / modelResults.length);
                    return (
                      <div key={model} className="flex items-center justify-between">
                        <span className="text-sm font-bold text-gray-700">{model}</span>
                        <div className="flex items-center gap-3">
                          <span className="text-xs font-mono text-gray-400">{avgTokens.toLocaleString()} tokens avg</span>
                          <Badge variant="indigo">{modelResults.length} runs</Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            </div>
          </div>
        )}

        {/* Tab Content: Timeline */}
        {activeTab === 'timeline' && (
          <div className="space-y-4">
            {filteredResults.map((result, idx) => {
              const id = `${result.scenarioId}-${idx}`;
              const isExpanded = expandedId === id;
              return (
                <Card key={id} className={cn("transition-all border-none shadow-sm", isExpanded ? "ring-2 ring-blue-500 shadow-2xl" : "")}>
                  <div 
                    className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                    onClick={() => setExpandedId(isExpanded ? null : id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        {result.success ? (
                          <div className="p-2 bg-emerald-100 rounded-full"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></div>
                        ) : (
                          <div className="p-2 bg-rose-100 rounded-full"><XCircle className="h-4 w-4 text-rose-600" /></div>
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <h3 className="font-bold text-gray-900 text-sm">{result.scenarioId}</h3>
                            <Badge variant="default" className="text-[9px]">{result.projectName}</Badge>
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] font-bold text-blue-600">{result.model}</span>
                            <span className="text-gray-300 text-[10px]">•</span>
                            <span className="text-[10px] font-bold text-gray-400">{result.approach}</span>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-6">
                        <div className="text-right">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Tokens</p>
                          <p className="font-mono font-bold text-gray-900 text-sm">{result.totalTokens.toLocaleString()}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Time</p>
                          <p className="font-mono font-bold text-gray-900 text-sm">{result.latencyMs}ms</p>
                        </div>
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <div className="border-t border-gray-100 bg-gray-50/50 p-6 space-y-6">
                      {result.steps.map((step, sIdx) => (
                        <div key={sIdx} className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Badge 
                              variant={
                                step.role === 'user' ? 'indigo' :
                                step.role === 'assistant' ? 'emerald' :
                                step.role === 'tool' ? 'purple' : 'default'
                              }
                            >
                              {step.role}
                            </Badge>
                            <span className="text-[10px] font-bold text-gray-400 font-mono">
                              {step.tokens} tokens
                            </span>
                          </div>
                          
                          {step.content && (
                            <div className="p-4 rounded-xl bg-white border border-gray-200 text-xs font-mono whitespace-pre-wrap max-h-[300px] overflow-auto shadow-inner text-gray-800">
                              {step.content}
                            </div>
                          )}

                          {step.toolCalls && step.toolCalls.length > 0 && (
                            <div className="grid gap-2">
                              {step.toolCalls.map((tc: any, tcIdx: number) => (
                                <div key={tcIdx} className="p-4 rounded-xl bg-purple-50 border border-purple-100 text-xs">
                                  <div className="flex items-center gap-2 font-black text-purple-700 uppercase tracking-wider text-[9px] mb-2">
                                    <Zap className="h-3 w-3" />
                                    Tool Call: {tc.name}
                                  </div>
                                  <pre className="text-[10px] text-purple-900 opacity-80 overflow-auto bg-white/50 p-3 rounded-lg border border-purple-100 shadow-inner">
                                    {JSON.stringify(tc.arguments, null, 2)}
                                  </pre>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
