import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { runBenchmarks, OpenRouterClient, ProgressUpdate, BenchmarkResult } from './runner.js';
import open from 'open';

type Step = 'projects' | 'models' | 'testTypes' | 'approaches' | 'concurrency' | 'openViewer' | 'running' | 'finished';

const MODELS = [
  { label: 'Gemini 3 Flash Preview', value: 'google/gemini-3-flash-preview' },
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4.6' },
  { label: 'Claude Haiku 4.5', value: 'anthropic/claude-haiku-4.5' },
  { label: 'GPT-5.2 Codex', value: 'openai/gpt-5.2-codex' },
  { label: 'DeepSeek v3.2', value: 'deepseek/deepseek-v3.2' },
];

const PROJECTS = [
  { label: 'Small Project', value: 'small' },
  { label: 'Mid Project', value: 'mid' },
  { label: 'Large Project', value: 'large' },
  { label: 'Coding Scenarios', value: 'coding' },
];

const TEST_TYPES = [
  { label: 'Single Prompt', value: 'single-prompt' },
  { label: 'Planning', value: 'planning' },
];

const APPROACHES = [
  { label: 'Baseline', value: 'baseline' },
  { label: 'React Map (Cold Cache)', value: 'react-map-cold' },
  { label: 'React Map (Warm Cache)', value: 'react-map-warm' },
];

const CONCURRENCY_OPTIONS = [
  { label: '1 (Sequential)', value: '1' },
  { label: '2', value: '2' },
  { label: '3 (Recommended)', value: '3' },
  { label: '5 (Aggressive)', value: '5' },
];

const OPEN_VIEWER_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

interface MultiSelectorProps {
  items: { label: string; value: string }[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  onConfirm: () => void;
  single?: boolean;
}

const MultiSelector: React.FC<MultiSelectorProps> = ({ items, selectedValues, onToggle, onConfirm, single }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      onToggle(items[selectedIndex].value);
    } else if (key.return) {
      if (single) {
          onToggle(items[selectedIndex].value);
      }
      onConfirm();
    }
  });

  return (
    <Box flexDirection="column">
      {items.map((item, index) => {
        const isSelected = index === selectedIndex;
        const isChecked = selectedValues.includes(item.value);
        return (
          <Box key={item.value}>
            <Text>
              {isSelected ? '> ' : '  '}
              {!single && (
                <Text color={isChecked ? 'green' : undefined}>
                    {isChecked ? '[x] ' : '[ ] '}
                </Text>
              )}
              <Text color={isChecked && single ? 'blue' : undefined}>
                {item.label}
              </Text>
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">{single ? '(Enter to select and confirm)' : '(Space to toggle, Enter to confirm)'}</Text>
      </Box>
    </Box>
  );
};

interface TaskStatus {
    projectName: string;
    scenarioId: string;
    model: string;
    approach: string;
    testType: string;
    status: 'queued' | 'running' | 'success' | 'failure';
    iteration?: number;
    lastTool?: string;
    tokens?: number;
}

const App = () => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('projects');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedTestTypes, setSelectedTestTypes] = useState<string[]>([]);
  const [selectedApproaches, setSelectedApproaches] = useState<string[]>([]);
  const [concurrency, setConcurrency] = useState<number>(3);
  const [openViewerWhenDone, setOpenViewerWhenDone] = useState<boolean>(true);
  
  const [tasks, setTasks] = useState<Record<string, TaskStatus>>({});
  const [totalScenarios, setTotalScenarios] = useState(0);
  const [completedCount, setCompletedCount] = useState(0);
  const [finishedResultPath, setFinishedResultPath] = useState<string | null>(null);

  const startBenchmarks = async () => {
    setStep('running');
    const models = selectedModels.map(m => {
      const modelInfo = MODELS.find(mi => mi.value === m);
      return new OpenRouterClient(m, modelInfo?.label || m);
    });

    try {
      const resultPath = await runBenchmarks({
        projects: selectedProjects,
        models,
        testTypes: selectedTestTypes as any,
        approaches: selectedApproaches as any,
        concurrency,
        onProgress: (update) => {
          if (update.type === 'start') {
              setTotalScenarios(update.totalScenarios || 0);
          } else if (update.type === 'scenario-start') {
              const taskId = `${update.projectName}-${update.scenarioId}-${update.model}-${update.approach}-${update.testType}`;
              setTasks(prev => ({
                  ...prev,
                  [taskId]: {
                      projectName: update.projectName!,
                      scenarioId: update.scenarioId!,
                      model: update.model!,
                      approach: update.approach!,
                      testType: update.testType!,
                      status: 'running',
                  }
              }));
          } else if (update.type === 'iteration') {
              const taskId = `${update.projectName}-${update.scenarioId}-${update.model}-${update.approach}-${update.testType}`;
              setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...prev[taskId], iteration: update.iteration }
              }));
          } else if (update.type === 'tool-call') {
              const taskId = `${update.projectName}-${update.scenarioId}-${update.model}-${update.approach}-${update.testType}`;
              setTasks(prev => ({
                  ...prev,
                  [taskId]: { ...prev[taskId], lastTool: update.toolName }
              }));
          } else if (update.type === 'scenario-end') {
              setCompletedCount(update.completedScenarios || 0);
              if (update.result) {
                  const r = update.result;
                  const taskId = `${r.projectName}-${r.scenarioId}-${r.model}-${r.approach}-${r.testType}`;
                  setTasks(prev => ({
                      ...prev,
                      [taskId]: { 
                          ...prev[taskId], 
                          status: r.success ? 'success' : 'failure',
                          tokens: r.totalTokens
                      }
                  }));
              }
          }
        }
      });

      setFinishedResultPath(resultPath);
      setStep('finished');

      if (openViewerWhenDone) {
        setTimeout(() => {
            open('http://localhost:5173').catch(e => console.error("Failed to open browser:", e));
        }, 500);
      }
    } catch (err) {
      console.error(err);
      exit();
    }
  };

  const renderTree = () => {
      const projects = Array.from(new Set(Object.values(tasks).map(t => t.projectName)));
      
      return (
          <Box flexDirection="column">
              {projects.map(p => {
                  const projectTasks = Object.values(tasks).filter(t => t.projectName === p);
                  const successCount = projectTasks.filter(t => t.status === 'success').length;
                  const runningCount = projectTasks.filter(t => t.status === 'running').length;
                  
                  return (
                      <Box key={p} flexDirection="column" marginLeft={2}>
                          <Text bold color="cyan">
                              {p} <Text color="gray">({successCount}/{projectTasks.length} done, {runningCount} active)</Text>
                          </Text>
                          {projectTasks.map((t, i) => {
                              const taskId = `${t.projectName}-${t.scenarioId}-${t.model}-${t.approach}-${t.testType}`;
                              let statusIcon = <Text color="gray">○</Text>;
                              if (t.status === 'running') statusIcon = <Text color="yellow"><Spinner type="dots" /></Text>;
                              if (t.status === 'success') statusIcon = <Text color="green">✔</Text>;
                              if (t.status === 'failure') statusIcon = <Text color="red">✘</Text>;
                              
                              return (
                                  <Box key={taskId} marginLeft={2}>
                                      {statusIcon}
                                      <Text> {t.scenarioId} </Text>
                                      <Text color="gray">[{t.model} / {t.approach}] </Text>
                                      {t.status === 'running' && (
                                          <Text color="blue">
                                              It: {t.iteration || 0} {t.lastTool ? `| Tool: ${t.lastTool}` : ''}
                                          </Text>
                                      )}
                                      {t.status === 'success' && <Text color="green">({t.tokens} tox)</Text>}
                                  </Box>
                              );
                          })}
                      </Box>
                  );
              })}
          </Box>
      );
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Gradient name="cristal">
        <BigText text="React Map" />
      </Gradient>
      <Text color="cyan">Benchmark CLI v1.1.0 (Parallel)</Text>
      <Box marginY={1} />

      {step === 'projects' && (
        <Box flexDirection="column">
          <Text color="green">Select Projects to Benchmark:</Text>
          <MultiSelector
            items={PROJECTS}
            selectedValues={selectedProjects}
            onToggle={(v) => setSelectedProjects(prev => prev.includes(v) ? prev.filter(p => p !== v) : [...prev, v])}
            onConfirm={() => selectedProjects.length > 0 && setStep('models')}
          />
        </Box>
      )}

      {step === 'models' && (
        <Box flexDirection="column">
          <Text color="green">Select Models:</Text>
          <MultiSelector
            items={MODELS}
            selectedValues={selectedModels}
            onToggle={(v) => setSelectedModels(prev => prev.includes(v) ? prev.filter(p => p !== v) : [...prev, v])}
            onConfirm={() => selectedModels.length > 0 && setStep('testTypes')}
          />
        </Box>
      )}

      {step === 'testTypes' && (
        <Box flexDirection="column">
          <Text color="green">Select Test Types:</Text>
          <MultiSelector
            items={TEST_TYPES}
            selectedValues={selectedTestTypes}
            onToggle={(v) => setSelectedTestTypes(prev => prev.includes(v) ? prev.filter(p => p !== v) : [...prev, v])}
            onConfirm={() => selectedTestTypes.length > 0 && setStep('approaches')}
          />
        </Box>
      )}

      {step === 'approaches' && (
        <Box flexDirection="column">
          <Text color="green">Select Approaches:</Text>
          <MultiSelector
            items={APPROACHES}
            selectedValues={selectedApproaches}
            onToggle={(v) => setSelectedApproaches(prev => prev.includes(v) ? prev.filter(p => p !== v) : [...prev, v])}
            onConfirm={() => selectedApproaches.length > 0 && setStep('concurrency')}
          />
        </Box>
      )}

      {step === 'concurrency' && (
        <Box flexDirection="column">
          <Text color="green">Select Parallel Workers:</Text>
          <MultiSelector
            items={CONCURRENCY_OPTIONS}
            selectedValues={[concurrency.toString()]}
            onToggle={(v) => setConcurrency(parseInt(v))}
            onConfirm={() => setStep('openViewer')}
            single
          />
        </Box>
      )}

      {step === 'openViewer' && (
        <Box flexDirection="column">
          <Text color="green">Open viewer automatically when done?</Text>
          <MultiSelector
            items={OPEN_VIEWER_OPTIONS}
            selectedValues={[openViewerWhenDone ? 'yes' : 'no']}
            onToggle={(value) => setOpenViewerWhenDone(value === 'yes')}
            onConfirm={() => startBenchmarks()}
            single
          />
        </Box>
      )}

      {step === 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text bold> Running Benchmarks ({completedCount}/{totalScenarios})</Text>
          </Box>
          <Box borderStyle="round" borderColor="blue" paddingX={1} marginTop={1}>
              {renderTree()}
          </Box>
        </Box>
      )}

      {step === 'finished' && (
        <Box flexDirection="column">
          <Text color="green" bold>Benchmarks Finished!</Text>
          <Text>Results saved to: <Text color="cyan" underline>{finishedResultPath}</Text></Text>
          <Box marginY={1} borderStyle="double" flexDirection="column" paddingX={1} borderColor="green">
             <Text bold color="yellow">SUMMARY</Text>
             <Text>Total Scenarios: {completedCount}</Text>
             <Text>Success Rate: {completedCount > 0 ? ((Object.values(tasks).filter(r => r.status === 'success').length / completedCount) * 100).toFixed(1) : 0}%</Text>
             <Text>Total Tokens: {Object.values(tasks).reduce((acc, r) => acc + (r.tokens || 0), 0).toLocaleString()}</Text>
          </Box>
          <Box flexDirection="column">
              <Text color="gray">Press Enter to exit or Ctrl+C</Text>
              {openViewerWhenDone && (
                <Box marginTop={1}>
                  <Text color="blue">Opening viewer at http://localhost:5173...</Text>
                </Box>
              )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default App;
