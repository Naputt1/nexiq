import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import OpenAI from "openai";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "../../..");
const PACKAGE_ROOT = path.resolve(__dirname, "..");

// Load .env from root first, then override with package-local .env if it exists
dotenv.config({ path: path.join(REPO_ROOT, ".env") });
dotenv.config({ path: path.join(PACKAGE_ROOT, ".env"), override: true });

// --- Types ---

// --- Types ---

export const ScenarioSchema = z.object({
  id: z.string(),
  type: z.enum(["breadth", "depth", "complexity", "coding"]),
  prompt: z.string(),
  expected_answer_contains: z.array(z.string()).optional(),
  verification_command: z.string().optional(),
  cleanup_command: z.string().optional(),
  isolation: z.boolean().optional(),
  max_iterations: z.number().optional(),
});

export const ProjectScenariosSchema = z.object({
  name: z.string(),
  root: z.string(),
  scenarios: z.array(ScenarioSchema),
});

export type Scenario = z.infer<typeof ScenarioSchema>;
export type ProjectScenarios = z.infer<typeof ProjectScenariosSchema>;

export interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

export interface BenchmarkStep {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // for tool result step
  toolName?: string; // for Gemini/standard logging
  tokens: number;
}

export interface BenchmarkResult {
  scenarioId: string;
  projectName: string;
  approach: "baseline" | "nexiq-cold" | "nexiq-warm";
  testType: "single-prompt" | "planning" | "coding";
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
  steps: BenchmarkStep[];
}

export interface RunOptions {
  projects: string[]; // Tier names (small, mid, large, coding)
  models: LlmClient[];
  testTypes: ("single-prompt" | "planning" | "coding")[];
  approaches: ("baseline" | "nexiq-cold" | "nexiq-warm")[];
  concurrency?: number;
  onProgress?: (update: ProgressUpdate) => void;
}

export interface ProgressUpdate {
  type:
    | "start"
    | "scenario-start"
    | "iteration"
    | "tool-call"
    | "scenario-end"
    | "end";
  projectName?: string;
  scenarioId?: string;
  model?: string;
  approach?: string;
  testType?: string;
  iteration?: number;
  toolName?: string;
  result?: BenchmarkResult;
  totalScenarios?: number;
  completedScenarios?: number;
  activeScenarios?: number;
}

// --- Tokenizer ---
const encoding = get_encoding("cl100k_base");
function countTokens(text: string | undefined): number {
  if (!text) return 0;
  return encoding.encode(text).length;
}

// --- MCP Client Orchestration ---

export class McpRunner {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  public id: string = crypto.randomBytes(4).toString("hex");

  async start(serverPath: string, args: string[] = []) {
    this.transport = new StdioClientTransport({
      command: "node",
      args: [serverPath, ...args],
    });

    this.client = new Client(
      { name: "benchmark-runner", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.client.connect(this.transport);
  }

  async stop() {
    if (this.client) await this.client.close();
    if (this.transport) await this.transport.close();
  }

  async callTool(name: string, args: any) {
    if (!this.client) throw new Error("Client not started");
    return await this.client.callTool({ name, arguments: args });
  }

  async listTools() {
    if (!this.client) throw new Error("Client not started");
    const result = await this.client.listTools();
    return result.tools;
  }
}

export class RunnerPool {
  private pool: McpRunner[] = [];
  private available: McpRunner[] = [];
  private waiting: ((runner: McpRunner) => void)[] = [];

  constructor(private size: number) {}

  async init(serverPath: string) {
    for (let i = 0; i < this.size; i++) {
      const runner = new McpRunner();
      await runner.start(serverPath);
      this.pool.push(runner);
      this.available.push(runner);
    }
  }

  async acquire(): Promise<McpRunner> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return new Promise((resolve) => {
      this.waiting.push(resolve);
    });
  }

  release(runner: McpRunner) {
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve(runner);
    } else {
      this.available.push(runner);
    }
  }

  async stop() {
    for (const runner of this.pool) {
      await runner.stop();
    }
  }
}

// --- LLM Client Interface ---

export interface LlmClient {
  name: string;
  displayName: string;
  chat(
    messages: BenchmarkStep[],
    tools: any[],
  ): Promise<{ content?: string; toolCalls?: ToolCall[] }>;
}

export class OpenRouterClient implements LlmClient {
  private openai: OpenAI;
  constructor(
    public name: string,
    public displayName: string,
  ) {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Missing OPENROUTER_API_KEY. Please set it in a .env file (root or benchmarks/cli/.env).",
      );
    }
    this.openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: apiKey,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/google-gemini/nexiq",
        "X-Title": "Nexiq Benchmark",
      },
    });
  }

  async chat(messages: BenchmarkStep[], tools: any[]) {
    const formattedMessages = messages.map((m) => {
      if (m.role === "tool") {
        return {
          role: "tool",
          content: m.content || "",
          tool_call_id: m.toolCallId!,
        };
      }
      if (m.role === "assistant") {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls?.map((tc) => ({
            id: tc.id,
            type: "function",
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments),
            },
          })),
        } as any;
      }
      return { role: m.role as any, content: m.content || "" };
    });

    try {
      const response = await (this.openai.chat.completions.create as any)({
        model: this.name,
        messages: formattedMessages,
        tools: tools.length > 0 ? tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            description: t.description,
            parameters: t.inputSchema,
          },
        })) : undefined,
        transforms: ["middle-out"],
      });

      const message = response.choices[0]!.message;
      const toolCalls = message.tool_calls
        ?.filter((tc: any) => tc.type === "function")
        .map((tc: any) => {
          const tool = tc as any;
          return {
            id: tool.id,
            name: tool.function.name,
            arguments: JSON.parse(tool.function.arguments),
          };
        });

      return {
        content: message.content || undefined,
        toolCalls,
      };
    } catch (e: any) {
      console.error("LLM Chat API Error:", e.message);
      throw e;
    }
  }
}

// --- Snapshot Manager ---

export class SnapshotManager {
  private baseDir: string;

  constructor() {
    this.baseDir = "../../benchmarks/snapshots";
  }

  save(toolName: string, args: any, data: any) {
    const dir = path.join(this.baseDir, toolName);
    fs.mkdirSync(dir, { recursive: true });

    // Create a deterministic hash of name + arguments
    const hashInput = JSON.stringify(args);
    const hash = crypto
      .createHash("sha256")
      .update(hashInput)
      .digest("hex")
      .slice(0, 16);

    const file = path.join(dir, `${hash}.json`);
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
  }
}

// --- Benchmark Runner Pool Orchestrator ---

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private snapshots: SnapshotManager;

  constructor() {
    this.snapshots = new SnapshotManager();
  }

  async runScenario(
    project: ProjectScenarios,
    scenario: Scenario,
    approach: "baseline" | "nexiq-cold" | "nexiq-warm",
    testType: "single-prompt" | "planning" | "coding",
    llm: LlmClient,
    mcp: McpRunner,
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    let toolCallsCount = 0;
    const steps: BenchmarkStep[] = [];
    let verificationOutput: BenchmarkResult["verificationOutput"];

    // Resolve relative to repo root
    const absoluteRoot = path.resolve(REPO_ROOT, project.root);

    // Pre-scenario setup
    if (approach === "nexiq-cold") {
      const cacheDir = path.join(absoluteRoot, ".nexiq", "cache");
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true });
      }
    }

    // Initialize MCP with project (Always call it to set context)
    await mcp.callTool("open_project", { projectPath: absoluteRoot });

    // Tools setup
    const allTools = await mcp.listTools();
    const availableTools =
      approach === "baseline"
        ? allTools.filter((t) =>
            [
              "list_directory",
              "read_file",
              "grep_search",
              "run_shell_command",
            ].includes(t.name),
          )
        : allTools.filter(
            (t) => !["grep_search", "run_shell_command"].includes(t.name),
          ); // Force specialized tools for nexiq approach

    const pathContext = `The project is already open at "${absoluteRoot}". Use this absolute path for the 'projectPath' argument in all tool calls. 
    IMPORTANT: Do not search or explore '.git', 'node_modules', or '.nexiq' directories as they contain large amounts of noise. 
    Use specialized tools like 'get_symbol_info' or 'get_component_hierarchy' when available, as they are significantly more accurate and token-efficient than generic shell commands.
    To reduce token usage, use the 'fields' parameter in tools like 'get_symbol_info' or 'get_file_outline' to return only the information you need.
    Use 'strict: true' (default) for precise symbol matching, or 'strict: false' if you need a broader search.
    If you need to make changes, use the 'write_file' or 'replace_file_content' or 'multi_replace_file_content' tools.`;

    // Interaction setup based on testType
    if (testType === "planning") {
      const systemMsg: BenchmarkStep = {
        role: "system",
        content: `You are an expert software engineer tasked with solving this discovery problem: "${scenario.prompt}". 
        ${pathContext}
        1. Explore the project structure and source code using the available tools. 
        2. Create a detailed, step-by-step plan for how you will find the required information. 
        3. Execute your plan meticulously and provide the final answer.`,
        tokens: 0,
      };
      systemMsg.tokens = countTokens(systemMsg.content);
      steps.push(systemMsg);
      totalTokens += systemMsg.tokens;
    } else if (testType === "coding") {
      const systemMsg: BenchmarkStep = {
        role: "system",
        content: `You are an expert software engineer tasked with completing this coding task: "${scenario.prompt}". 
        ${pathContext}
        1. Understand the requirements and explore the codebase.
        2. Implement the changes requested.
        3. Verify your work using any available testing tools if applicable.
        4. Once you are finished, provide a summary of the changes made.`,
        tokens: 0,
      };
      systemMsg.tokens = countTokens(systemMsg.content);
      steps.push(systemMsg);
      totalTokens += systemMsg.tokens;
    } else {
      const systemMsg: BenchmarkStep = {
        role: "system",
        content: pathContext,
        tokens: 0,
      };
      systemMsg.tokens = countTokens(systemMsg.content);
      steps.push(systemMsg);
      totalTokens += systemMsg.tokens;
    }

    steps.push({
      role: "user",
      content: scenario.prompt,
      tokens: countTokens(scenario.prompt),
    });
    totalTokens += steps[steps.length - 1].tokens;

    let iterations = 0;
    const MAX_ITERATIONS = scenario.max_iterations || 15;
    let success = false;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      onProgress?.({
        type: "iteration",
        iteration: iterations,
        projectName: project.name,
        scenarioId: scenario.id,
        model: llm.displayName,
        approach,
        testType,
      });

      const response = await llm.chat(steps, availableTools);
      const assistantMessage: BenchmarkStep = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        tokens:
          countTokens(response.content) +
          (response.toolCalls
            ? countTokens(JSON.stringify(response.toolCalls))
            : 0),
      };
      steps.push(assistantMessage);
      totalTokens += assistantMessage.tokens;

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          toolCallsCount++;
          onProgress?.({
            type: "tool-call",
            toolName: tc.name,
            projectName: project.name,
            scenarioId: scenario.id,
            model: llm.displayName,
            approach,
            testType,
          });

          const toolArgs = { ...tc.arguments };
          // Inject projectPath if missing and it's a specialized tool
          if (
            !toolArgs.projectPath &&
            approach !== "baseline" &&
            (tc.name.startsWith("get_") || tc.name.startsWith("list_"))
          ) {
            toolArgs.projectPath = absoluteRoot;
          }

          const result = await mcp.callTool(tc.name, toolArgs);

          // Snapshot tool result (only for nexiq specialized tools)
          const genericTools = [
            "list_directory",
            "read_file",
            "grep_search",
            "run_shell_command",
            "open_project",
          ];
          if (!genericTools.includes(tc.name)) {
            this.snapshots.save(tc.name, toolArgs, {
              arguments: toolArgs,
              result,
            });
          }

          let resultContent = JSON.stringify(result);
          let toolTokens = countTokens(resultContent);

          const MAX_TOOL_TOKENS = 30000;
          if (toolTokens > MAX_TOOL_TOKENS) {
            const truncatedContent = resultContent.slice(
              0,
              MAX_TOOL_TOKENS * 4,
            );
            resultContent = `${truncatedContent}\n\n... [TRUNCATED DUE TO SIZE: ${toolTokens} tokens total] ...`;
            toolTokens = countTokens(resultContent);
          }

          const toolMessage: BenchmarkStep = {
            role: "tool",
            content: resultContent,
            toolCallId: tc.id,
            toolName: tc.name,
            tokens: toolTokens,
          };
          steps.push(toolMessage);
          totalTokens += toolTokens;
        }
      } else if (response.content) {
        // Evaluate completion
        if (testType === "coding" && scenario.verification_command) {
          const verifyResult = await this.verifyCodingTask(absoluteRoot, scenario.verification_command, mcp);
          success = verifyResult.success;
          verificationOutput = verifyResult.output;
        } else {
          success = await this.evaluateSuccess(llm, scenario, response.content);
        }
        break;
      } else {
        break;
      }
    }

    // Cleanup
    if (scenario.cleanup_command) {
      await mcp.callTool("run_shell_command", {
        command: scenario.cleanup_command,
        cwd: absoluteRoot,
      });
    }

    const result: BenchmarkResult = {
      scenarioId: scenario.id,
      projectName: project.name,
      approach,
      testType,
      model: llm.displayName,
      success,
      totalTokens,
      toolCallsCount,
      latencyMs: Date.now() - startTime,
      steps,
      verificationOutput,
    };
    this.results.push(result);
    return result;
  }

  private async verifyCodingTask(projectRoot: string, command: string, mcp: McpRunner): Promise<{ success: boolean; output?: { stdout: string; stderr: string; exitCode: number } }> {
    try {
      const response: any = await mcp.callTool("run_shell_command", {
        command,
        projectPath: projectRoot,
      });
      
      const content = response.content?.[0];
      if (content?.type === "text") {
        try {
          const result = JSON.parse(content.text);
          if (result.exitCode !== 0) {
            console.error(`Verification command failed with exit code ${result.exitCode}`);
            if (result.stdout) console.error(`STDOUT: ${result.stdout}`);
            if (result.stderr) console.error(`STDERR: ${result.stderr}`);
          }
          return { 
            success: result.exitCode === 0, 
            output: { 
              stdout: result.stdout || "", 
              stderr: result.stderr || "", 
              exitCode: result.exitCode 
            } 
          };
        } catch (e) {
          console.error("Failed to parse verification result:", e, content.text);
          return { success: false };
        }
      }
      return { success: false };
    } catch (e) {
      console.error("Verification command failed:", e);
      return { success: false };
    }
  }

  private async evaluateSuccess(
    llm: LlmClient,
    scenario: Scenario,
    response: string,
  ): Promise<boolean> {
    if (!scenario.expected_answer_contains) {
        // If no expectation, check if llm thinks it succeeded
        return true; 
    }

    const evalPrompt = `
You are an objective evaluator for a software engineering benchmark.
A model was asked: "${scenario.prompt}"
The expected answer should contain or refer to: ${scenario.expected_answer_contains.join(", ")}

The model's final response was:
"${response}"

Determine if the model's response is correct and helpful. 
- It MUST provide the information requested in the prompt.
- It MUST be factually consistent with the expected terms.
- If the model says it "cannot find" something that is expected to be there, it is a FAILURE.
- If the model provides a generic answer without the specific details requested, it is a FAILURE.

Respond with ONLY the word "SUCCESS" if it is correct, or "FAILURE" if it is incorrect.
`;

    try {
      const evalResult = await llm.chat(
        [
          {
            role: "system",
            content: "You are a strict benchmark evaluator.",
            tokens: 0,
          },
          { role: "user", content: evalPrompt, tokens: 0 },
        ],
        [],
      );

      return (
        evalResult.content?.trim().toUpperCase().includes("SUCCESS") ?? false
      );
    } catch (e) {
      console.error("Evaluation failed, falling back to simple check:", e);
      const answer = response.toLowerCase();
      return scenario.expected_answer_contains.every((term) =>
        answer.includes(term.toLowerCase()),
      );
    }
  }

  saveResults(timestamp: string): string {
    const outFile = path.join(
      REPO_ROOT,
      "benchmarks/results",
      `run_${timestamp}.json`,
    );
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(this.results, null, 2));
    return outFile;
  }
}

export async function runBenchmarks(options: RunOptions) {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const orchestrator = new BenchmarkRunner();
  const serverPath = path.resolve(REPO_ROOT, "packages/server/dist/index.js");
  const concurrency = options.concurrency || 3;
  const pool = new RunnerPool(concurrency);

  const tasks: { 
    project: ProjectScenarios; 
    scenario: Scenario; 
    model: LlmClient; 
    approach: "baseline" | "nexiq-cold" | "nexiq-warm"; 
    testType: "single-prompt" | "planning" | "coding" 
  }[] = [];

  for (const tier of options.projects) {
    const scenarioFile = path.resolve(REPO_ROOT, `benchmarks/scenarios/${tier}.json`);
    if (!fs.existsSync(scenarioFile)) {
        console.warn(`Scenario file not found: ${scenarioFile}`);
        continue;
    }

    const projectData: ProjectScenarios = JSON.parse(fs.readFileSync(scenarioFile, "utf-8"));

    for (const scenario of projectData.scenarios) {
      for (const model of options.models) {
        const scenarioTestTypes = (scenario.type === 'coding') ? ["coding"] : options.testTypes;

        for (const testType of scenarioTestTypes) {
           for (const approach of options.approaches) {
             tasks.push({ project: projectData, scenario, model, approach, testType: testType as any });
           }
        }
      }
    }
  }

  options.onProgress?.({ type: "start", totalScenarios: tasks.length });

  let completedScenarios = 0;
  let activeScenarios = 0;

  await pool.init(serverPath);

  const runTask = async (task: typeof tasks[0]) => {
    activeScenarios++;
    options.onProgress?.({
      type: "scenario-start",
      projectName: task.project.name,
      scenarioId: task.scenario.id,
      model: task.model.displayName,
      approach: task.approach,
      testType: task.testType,
      activeScenarios,
    });

    const mcp = await pool.acquire();
    try {
      const result = await orchestrator.runScenario(
        task.project,
        task.scenario,
        task.approach,
        task.testType,
        task.model,
        mcp,
        options.onProgress,
      );

      completedScenarios++;
      activeScenarios--;
      options.onProgress?.({
        type: "scenario-end",
        result,
        completedScenarios,
        activeScenarios,
      });
    } catch (e) {
      console.error(`Error running scenario ${task.scenario.id}:`, e);
      activeScenarios--;
      completedScenarios++; // Still mark as completed to avoid hanging UI
      options.onProgress?.({
          type: "scenario-end",
          completedScenarios,
          activeScenarios,
      });
    } finally {
      pool.release(mcp);
    }
  };

  // Process tasks with concurrency limit and directory isolation
  const activeRoots = new Map<string, number>(); // root -> number of active tasks
  const activeIsolatedRoots = new Set<string>(); // roots used by isolated tasks
  const promisePool = new Set<Promise<any>>();
  const queue = [...tasks];

  while (queue.length > 0 || promisePool.size > 0) {
    // Try to start new tasks up to concurrency
    let taskStarted = false;
    while (promisePool.size < concurrency && queue.length > 0) {
      // Find a task that can run given current active roots
      const taskIndex = queue.findIndex(t => {
        const root = t.project.root;
        if (t.scenario.isolation) {
          // Isolated task needs root to be completely free
          return (activeRoots.get(root) || 0) === 0;
        } else {
          // Non-isolated task needs root to not be used by an isolated task
          return !activeIsolatedRoots.has(root);
        }
      });

      if (taskIndex === -1) break; // No task can start right now (waiting for roots to clear)

      const task = queue.splice(taskIndex, 1)[0];
      const root = task.project.root;
      
      // Mark root as in use
      activeRoots.set(root, (activeRoots.get(root) || 0) + 1);
      if (task.scenario.isolation) {
        activeIsolatedRoots.add(root);
      }

      const p: Promise<any> = runTask(task).then(() => {
        // Cleanup root usage
        const count = activeRoots.get(root) || 0;
        if (count <= 1) {
          activeRoots.delete(root);
        } else {
          activeRoots.set(root, count - 1);
        }

        if (task.scenario.isolation) {
          activeIsolatedRoots.delete(root);
        }
        promisePool.delete(p);
      });
      
      promisePool.add(p);
      taskStarted = true;
    }

    if (promisePool.size > 0) {
      // Wait for at least one task to finish before trying to schedule more
      await Promise.race(promisePool);
    } else if (queue.length > 0 && !taskStarted) {
      // This shouldn't happen if the logic is correct, but avoid infinite loop
      console.error("Scheduler stuck: some tasks in queue but none can start and none are running.");
      break;
    }
  }

  const resultPath = orchestrator.saveResults(timestamp);
  await pool.stop();
  options.onProgress?.({ type: "end" });
  return resultPath;
}
