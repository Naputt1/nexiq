import React, { useState, useEffect } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Gradient from 'ink-gradient';
import BigText from 'ink-big-text';
import { runBenchmarks, OpenRouterClient, ProgressUpdate, BenchmarkResult } from './runner.js';
import open from 'open';

type Step = 'projects' | 'models' | 'testTypes' | 'approaches' | 'openViewer' | 'running' | 'finished';

const MODELS = [
  { label: 'Gemini 3 Flash Preview', value: 'google/gemini-3-flash-preview' },
  { label: 'Claude Sonnet 4.6', value: 'anthropic/claude-sonnet-4.6' },
  { label: 'GPT-5.2 Codex', value: 'openai/gpt-5.2-codex' },
];

const PROJECTS = [
  { label: 'Small Project', value: 'small' },
  { label: 'Mid Project', value: 'mid' },
  { label: 'Large Project', value: 'large' },
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

const OPEN_VIEWER_OPTIONS = [
  { label: 'Yes', value: 'yes' },
  { label: 'No', value: 'no' },
];

interface MultiSelectorProps {
  items: { label: string; value: string }[];
  selectedValues: string[];
  onToggle: (value: string) => void;
  onConfirm: () => void;
}

const MultiSelector: React.FC<MultiSelectorProps> = ({ items, selectedValues, onToggle, onConfirm }) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : items.length - 1));
    } else if (key.downArrow) {
      setSelectedIndex(prev => (prev < items.length - 1 ? prev + 1 : 0));
    } else if (input === ' ') {
      onToggle(items[selectedIndex].value);
    } else if (key.return) {
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
              <Text color={isChecked ? 'green' : undefined}>
                {isChecked ? '[x] ' : '[ ] '}
              </Text>
              {item.label}
            </Text>
          </Box>
        );
      })}
      <Box marginTop={1}>
        <Text color="gray">(Space to toggle, Enter to confirm)</Text>
      </Box>
    </Box>
  );
};

const App = () => {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('projects');
  const [selectedProjects, setSelectedProjects] = useState<string[]>([]);
  const [selectedModels, setSelectedModels] = useState<string[]>([]);
  const [selectedTestTypes, setSelectedTestTypes] = useState<string[]>([]);
  const [selectedApproaches, setSelectedApproaches] = useState<string[]>([]);
  const [openViewerWhenDone, setOpenViewerWhenDone] = useState<boolean>(true);
  
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [results, setResults] = useState<BenchmarkResult[]>([]);
  const [finishedResultPath, setFinishedResultPath] = useState<string | null>(null);

  useInput((_input, key) => {
    if (key.return && step === 'finished') {
      exit();
    }
  });

  const toggleProject = (value: string) => {
    setSelectedProjects(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const toggleModel = (value: string) => {
    setSelectedModels(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const toggleTestType = (value: string) => {
    setSelectedTestTypes(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

  const toggleApproach = (value: string) => {
    setSelectedApproaches(prev => prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]);
  };

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
        onProgress: (update) => {
          setProgress(update);
          if (update.type === 'scenario-end' && update.result) {
            setResults(prev => [...prev, update.result!]);
          }
        }
      });

      setFinishedResultPath(resultPath);
      setStep('finished');

      if (openViewerWhenDone) {
        open('http://localhost:5173');
      }
    } catch (err) {
      console.error(err);
      exit();
    }
  };

  return (
    <Box flexDirection="column" padding={1}>
      <Gradient name="cristal">
        <BigText text="React Map" />
      </Gradient>
      <Text color="cyan">Benchmark CLI v1.0.0</Text>
      <Box marginY={1} />

      {step === 'projects' && (
        <Box flexDirection="column">
          <Text color="green">Select Projects to Benchmark:</Text>
          <MultiSelector
            key="projects"
            items={PROJECTS}
            selectedValues={selectedProjects}
            onToggle={toggleProject}
            onConfirm={() => selectedProjects.length > 0 && setStep('models')}
          />
        </Box>
      )}

      {step === 'models' && (
        <Box flexDirection="column">
          <Text color="green">Select Models:</Text>
          <MultiSelector
            key="models"
            items={MODELS}
            selectedValues={selectedModels}
            onToggle={toggleModel}
            onConfirm={() => selectedModels.length > 0 && setStep('testTypes')}
          />
        </Box>
      )}

      {step === 'testTypes' && (
        <Box flexDirection="column">
          <Text color="green">Select Test Types:</Text>
          <MultiSelector
            key="testTypes"
            items={TEST_TYPES}
            selectedValues={selectedTestTypes}
            onToggle={toggleTestType}
            onConfirm={() => selectedTestTypes.length > 0 && setStep('approaches')}
          />
        </Box>
      )}

      {step === 'approaches' && (
        <Box flexDirection="column">
          <Text color="green">Select Approaches:</Text>
          <MultiSelector
            key="approaches"
            items={APPROACHES}
            selectedValues={selectedApproaches}
            onToggle={toggleApproach}
            onConfirm={() => selectedApproaches.length > 0 && setStep('openViewer')}
          />
        </Box>
      )}

      {step === 'openViewer' && (
        <Box flexDirection="column">
          <Text color="green">Open viewer automatically when done?</Text>
          <MultiSelector
            key="openViewer"
            items={OPEN_VIEWER_OPTIONS}
            selectedValues={[openViewerWhenDone ? 'yes' : 'no']}
            onToggle={(value) => setOpenViewerWhenDone(value === 'yes')}
            onConfirm={() => startBenchmarks()}
          />
        </Box>
      )}

      {step === 'running' && (
        <Box flexDirection="column">
          <Box>
            <Text color="yellow">
              <Spinner type="dots" />
            </Text>
            <Text> Running Benchmarks...</Text>
          </Box>
          {progress && (
            <Box flexDirection="column" marginTop={1} borderStyle="round" paddingX={1} borderColor="blue">
              <Text>Current Scenario: <Text color="blue" bold>{progress.projectName}</Text> / <Text color="magenta">{progress.scenarioId}</Text></Text>
              <Text>Model: <Text color="cyan">{progress.model}</Text></Text>
              <Text>Approach: <Text color="yellow">{progress.approach}</Text></Text>
              <Text>Type: <Text color="white">{progress.testType}</Text></Text>
              {progress.type === 'iteration' && <Text>Iteration: <Text bold>{progress.iteration}</Text></Text>}
              {progress.type === 'tool-call' && <Text color="gray">  Tool: <Text color="white" italic>{progress.toolName}</Text></Text>}
              <Box marginTop={1}>
                <Text>Completed: <Text color="green" bold>{progress.completedScenarios || 0}</Text></Text>
              </Box>
            </Box>
          )}
          <Box marginTop={1} flexDirection="column">
            <Text color="green" bold>Results so far ({results.length}):</Text>
            {results.slice(-5).map((r, i) => (
              <Text key={i}>
                {r.success ? <Text color="green">✔</Text> : <Text color="red">✘</Text>} {r.projectName} - {r.scenarioId} ({r.model}) - {r.totalTokens} tokens
              </Text>
            ))}
          </Box>
        </Box>
      )}

      {step === 'finished' && (
        <Box flexDirection="column">
          <Text color="green" bold>Benchmarks Finished!</Text>
          <Text>Results saved to: <Text color="cyan" underline>{finishedResultPath}</Text></Text>
          <Box marginY={1} borderStyle="double" flexDirection="column" paddingX={1} borderColor="green">
             <Text bold color="yellow">SUMMARY</Text>
             <Text>Total Scenarios: {results.length}</Text>
             <Text>Success Rate: {results.length > 0 ? ((results.filter(r => r.success).length / results.length) * 100).toFixed(1) : 0}%</Text>
             <Text>Total Tokens: {results.reduce((acc, r) => acc + r.totalTokens, 0).toLocaleString()}</Text>
          </Box>
          <Text color="gray">Press Enter to exit or Ctrl+C</Text>
          {openViewerWhenDone && (
            <Box marginTop={1}>
              <Text color="blue">Opening viewer at http://localhost:5173...</Text>
              <Text color="gray">(Make sure to run 'pnpm benchmark:view' if it's not already running)</Text>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};


export default App;
