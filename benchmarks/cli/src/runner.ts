import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import OpenAI from "openai";
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
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
  arguments: unknown;
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
  approach: "baseline" | "nexiq-warm" | "nexiq-skill";
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
  errorMessage?: string;
  steps: BenchmarkStep[];
}

export interface RunOptions {
  projects: string[]; // Tier names (small, mid, large, coding)
  models: LlmClient[];
  testTypes: ("single-prompt" | "planning" | "coding")[];
  approaches: ("baseline" | "nexiq-warm" | "nexiq-skill")[];
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

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

function isTransportError(e: unknown): boolean {
  const msg = (e as Error)?.message || "";
  return (
    msg.includes("Connection closed") ||
    msg.includes("connection closed") ||
    msg.includes("transport") ||
    msg.includes("Transport") ||
    msg.includes("closed") ||
    msg.includes("disconnected") ||
    msg.includes("ECONNRESET") ||
    msg.includes("EPIPE") ||
    msg.includes("timed out")
  );
}

export class McpRunner {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  public id: string = crypto.randomBytes(4).toString("hex");
  private _dead = false;
  private logStream?: fs.WriteStream;

  get dead(): boolean {
    return this._dead;
  }

  async start(serverPath: string, args: string[] = []) {
    this._dead = false;
    const logDir = path.resolve(REPO_ROOT, "benchmarks/results");
    if (!fs.existsSync(logDir)) {
      fs.mkdirSync(logDir, { recursive: true });
    }
    this.logStream = fs.createWriteStream(
      path.join(logDir, `server-${this.id}.log`),
    );
    this.transport = new StdioClientTransport({
      command: "node",
      args: ["--max-old-space-size=4096", serverPath, ...args],
      stderr: "pipe",
    });
    const stderrStream = (this.transport as unknown as { _stderrStream?: NodeJS.ReadableStream })._stderrStream;
    if (stderrStream) {
      stderrStream.setEncoding("utf8");
      stderrStream.pipe(this.logStream);
      stderrStream.pipe(process.stderr);
    }

    this.client = new Client(
      { name: "benchmark-runner", version: "1.0.0" },
      { capabilities: {} },
    );

    await withTimeout(this.client.connect(this.transport), 15_000, "connect");
  }

  async stop() {
    if (this.client) await this.client.close();
    if (this.transport) await this.transport.close();
    if (this.logStream) {
      this.logStream.end();
    }
  }

  async callTool(name: string, args: unknown) {
    if (!this.client) throw new Error("Client not started");
    try {
      return await withTimeout(
        this.client.callTool({
          name,
          arguments: args as Record<string, unknown>,
        }),
        300_000,
        `callTool(${name})`,
      );
    } catch (e) {
      this._dead = true;
      throw e;
    }
  }

  async listTools() {
    if (!this.client) throw new Error("Client not started");
    try {
      const result = await withTimeout(this.client.listTools(), 15_000, "listTools");
      return result.tools;
    } catch (e) {
      this._dead = true;
      throw e;
    }
  }
}

export class RunnerPool {
  private pool: McpRunner[] = [];
  private available: McpRunner[] = [];
  private waiting: ((runner: McpRunner) => void)[] = [];
  private serverPath = "";

  constructor(private size: number) {}

  async init(serverPath: string) {
    this.serverPath = serverPath;
    for (let i = 0; i < this.size; i++) {
      await this.spawnRunner();
    }
  }

  private async spawnRunner(): Promise<McpRunner> {
    const runner = new McpRunner();
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await runner.start(this.serverPath);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    this.pool.push(runner);
    if (this.waiting.length > 0) {
      this.waiting.shift()!(runner);
    } else {
      this.available.push(runner);
    }
    return runner;
  }

  async acquire(): Promise<McpRunner> {
    if (this.available.length > 0) {
      return this.available.pop()!;
    }
    return withTimeout(
      new Promise<McpRunner>((resolve) => {
        this.waiting.push(resolve);
      }),
      300_000,
      "acquire runner",
    );
  }

  release(runner: McpRunner) {
    if (runner.dead) {
      runner.stop().catch(() => {});
      this.retrySpawnForever();
      return;
    }
    if (this.waiting.length > 0) {
      const resolve = this.waiting.shift()!;
      resolve(runner);
    } else {
      this.available.push(runner);
    }
  }

  private async retrySpawnForever() {
    let delay = 2000;
    for (;;) {
      try {
        await this.spawnRunner();
        return;
      } catch {
        await new Promise((r) => setTimeout(r, delay));
        delay = Math.min(delay * 2, 30_000);
      }
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
    tools: unknown[],
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

  async chat(messages: BenchmarkStep[], tools: unknown[]) {
    const formattedMessages: ChatCompletionMessageParam[] = messages.map((m) => {
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
        };
      }
      return { role: m.role, content: m.content || "" };
    }) as ChatCompletionMessageParam[];

    try {
      const response = await this.openai.chat.completions.create({
        model: this.name,
        messages: formattedMessages as ChatCompletionMessageParam[],
        tools:
          tools.length > 0
            ? (tools as Array<Record<string, unknown>>).map((t) => ({
                type: "function",
                function: {
                  name: t.name as string,
                  description: t.description as string,
                  parameters: t.inputSchema as Record<string, unknown>,
                },
              }))
            : undefined,
        transforms: ["middle-out"],
      } as ChatCompletionCreateParamsNonStreaming & { transforms: string[] });

      const message = response.choices[0]!.message;
      const toolCalls = message.tool_calls
        ?.filter((tc) => tc.type === "function")
        .map((tc) => {
          return {
            id: tc.id,
            name: tc.function.name,
            arguments: JSON.parse(tc.function.arguments),
          };
        });

      return {
        content: message.content || undefined,
        toolCalls,
      };
    } catch (e: unknown) {
      console.error("LLM Chat API Error:", (e as Error).message);
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

  save(toolName: string, args: unknown, data: unknown) {
    const dir = path.join(this.baseDir, toolName);
    fs.mkdirSync(dir, { recursive: true });

    // Create a deterministic hash of name + arguments
    const hashInput = JSON.stringify(args, Object.keys(args as Record<string, unknown>).sort());
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

  private async callWithRetry<T>(
    fn: (m: McpRunner) => Promise<T>,
    mcp: McpRunner,
    requestReplacement: () => Promise<McpRunner>,
  ): Promise<{ result: T; mcp: McpRunner }> {
    let current = mcp;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await fn(current);
        return { result, mcp: current };
      } catch (e) {
        if (!current.dead) throw e;
        current = await requestReplacement();
      }
    }
    throw new Error("Max retries exceeded on dead runner");
  }

  async runScenario(
    project: ProjectScenarios,
    scenario: Scenario,
    approach: "baseline" | "nexiq-warm" | "nexiq-skill",
    testType: "single-prompt" | "planning" | "coding",
    llm: LlmClient,
    mcp: McpRunner,
    onProgress?: (update: ProgressUpdate) => void,
    requestReplacement?: () => Promise<McpRunner>,
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    let toolCallsCount = 0;
    const steps: BenchmarkStep[] = [];
    let verificationOutput: BenchmarkResult["verificationOutput"];
    let currentMcp = mcp;
    const repl = requestReplacement ?? (() => Promise.reject(new Error("No replacement available")));
    const retry = <T>(fn: (m: McpRunner) => Promise<T>) =>
      this.callWithRetry(fn, currentMcp, repl).then(({ result, mcp: m }) => {
        currentMcp = m;
        return result;
      });

    // Resolve relative to repo root
    const absoluteRoot = path.resolve(REPO_ROOT, project.root);

    // Tools setup
    const allTools = await retry((m) => m.listTools());
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
        : allTools; // All tools available — skill doc guides optimal usage

    const pathPrefix = `The project is already open at "${absoluteRoot}". Use this absolute path for the 'projectPath' argument in all tool calls.`;
    const pathContext = approach === "nexiq-skill"
      ? pathPrefix + "\n\n" +
        fs.readFileSync(
          path.resolve(REPO_ROOT, "docs/skills/nexiq-mcp.md"),
          "utf-8",
        ).replace(/^---[\s\S]*?---\n/, "")
      : pathPrefix + `
    IMPORTANT: Do not search or explore '.git', 'node_modules', or '.nexiq' directories as they contain large amounts of noise. 
    Use specialized tools like 'get_symbol_info' or 'get_component_hierarchy' when available, as they are significantly more accurate and token-efficient than generic shell commands. For field-level queries (e.g., finding which files access 'user.data.role'), use 'get_field_accesses' with the hook/component name and the field path.
    Each tool definition costs tokens every roundtrip. Include all needed parameters in one call rather than making multiple calls for the same symbol. Prefer get_symbol_info → get_symbol_content over read_file for targeted code reading.
    If you need to make changes, use 'write_file' or 'replace_file_content' or 'multi_replace_file_content'.`;

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

      const response = await this.callLlmWithRetry(llm, steps, availableTools);
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

          const toolArgs = { ...(tc.arguments as Record<string, unknown>) };
          // Override projectPath for specialized tools to prevent LLM from using wrong paths
          if (
            approach !== "baseline" &&
            (tc.name.startsWith("get_") || tc.name.startsWith("list_") || tc.name === "read_file" || tc.name === "grep_search")
          ) {
            toolArgs.projectPath = absoluteRoot;
          }

          const result = await retry((m) => m.callTool(tc.name, toolArgs));

          // Snapshot tool result (only for nexiq specialized tools)
          const genericTools = [
            "list_directory",
            "read_file",
            "grep_search",
            "run_shell_command",
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
          const verifyResult = await this.verifyCodingTask(
            absoluteRoot,
            scenario.verification_command,
            currentMcp,
          );
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
      await retry((m) =>
        m.callTool("run_shell_command", {
          command: scenario.cleanup_command,
          projectPath: absoluteRoot,
        }),
      );
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

  private async verifyCodingTask(
    projectRoot: string,
    command: string,
    mcp: McpRunner,
  ): Promise<{
    success: boolean;
    output?: { stdout: string; stderr: string; exitCode: number };
  }> {
    try {
      const response: Record<string, unknown> = await mcp.callTool(
        "run_shell_command",
        {
          command,
          projectPath: projectRoot,
        },
      );

      const sc = (response as { structuredContent?: Record<string, unknown> }).structuredContent;
      if (sc && sc.exitCode !== undefined) {
        const exitCode = sc.exitCode as number;
        if (exitCode !== 0) {
          console.error(
            `Verification command failed with exit code ${exitCode}`,
          );
          if (sc.stdout) console.error(`STDOUT: ${sc.stdout}`);
          if (sc.stderr) console.error(`STDERR: ${sc.stderr}`);
        }
        return {
          success: exitCode === 0,
          output: {
            stdout: (sc.stdout as string) || "",
            stderr: (sc.stderr as string) || "",
            exitCode,
          },
        };
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

  private async callLlmWithRetry(
    llm: LlmClient,
    steps: BenchmarkStep[],
    tools: unknown[],
    maxRetries = 3,
  ) {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await llm.chat(steps, tools);
      } catch (e) {
        lastError = e instanceof Error ? e : new Error(String(e));
        console.error(
          `LLM API error (attempt ${attempt + 1}/${maxRetries}):`,
          lastError.message,
        );
        if (attempt < maxRetries - 1) {
          const delay = 5000 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
        }
      }
    }
    throw lastError!;
  }

  reportError(
    scenarioId: string,
    projectName: string,
    approach: "baseline" | "nexiq-warm" | "nexiq-skill",
    testType: "single-prompt" | "planning" | "coding",
    model: string,
    startTime: number,
    error?: Error,
  ): BenchmarkResult {
    const result: BenchmarkResult = {
      scenarioId,
      projectName,
      approach,
      testType,
      model,
      success: false,
      totalTokens: 0,
      toolCallsCount: 0,
      latencyMs: Date.now() - startTime,
      errorMessage: error?.message,
      steps: [],
    };
    this.results.push(result);
    return result;
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
  const concurrency = options.concurrency || 2;
  const pool = new RunnerPool(concurrency);

  const tasks: {
    project: ProjectScenarios;
    scenario: Scenario;
    model: LlmClient;
    approach: "baseline" | "nexiq-warm" | "nexiq-skill";
    testType: "single-prompt" | "planning" | "coding";
  }[] = [];

  for (const tier of options.projects) {
    const scenarioFile = path.resolve(
      REPO_ROOT,
      `benchmarks/scenarios/${tier}.json`,
    );
    if (!fs.existsSync(scenarioFile)) {
      console.warn(`Scenario file not found: ${scenarioFile}`);
      continue;
    }

    const projectData: ProjectScenarios = JSON.parse(
      fs.readFileSync(scenarioFile, "utf-8"),
    );

    for (const scenario of projectData.scenarios) {
      for (const model of options.models) {
        const scenarioTestTypes =
          scenario.type === "coding" ? ["coding"] : options.testTypes;

        for (const testType of scenarioTestTypes as (
          | "single-prompt"
          | "planning"
          | "coding"
        )[]) {
          for (const approach of options.approaches as (
            | "baseline"
            | "nexiq-warm"
            | "nexiq-skill"
          )[]) {
            tasks.push({
              project: projectData,
              scenario,
              model,
              approach,
              testType,
            });
          }
        }
      }
    }
  }

  options.onProgress?.({ type: "start", totalScenarios: tasks.length });

  let completedScenarios = 0;
  let activeScenarios = 0;

  await pool.init(serverPath);

  // Process tasks with concurrency limit and directory isolation
  const activeRoots = new Map<string, number>();
  const activeIsolatedRoots = new Set<string>();
  const promisePool = new Set<Promise<void>>();
  const queue = [...tasks];

  const runTask = async (task: (typeof tasks)[0], root: string) => {
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

    let mcp = await pool.acquire();
    const taskStartTime = Date.now();
    const requestReplacement = async () => {
      const dead = mcp;
      pool.release(dead);
      mcp = await pool.acquire();
      return mcp;
    };
    try {
      const result = await orchestrator.runScenario(
        task.project,
        task.scenario,
        task.approach,
        task.testType,
        task.model,
        mcp,
        options.onProgress,
        requestReplacement,
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
      const errorResult = orchestrator.reportError(
        task.scenario.id,
        task.project.name,
        task.approach,
        task.testType,
        task.model.displayName,
        taskStartTime,
        e instanceof Error ? e : new Error(String(e)),
      );
      activeScenarios--;
      completedScenarios++;
      options.onProgress?.({
        type: "scenario-end",
        result: errorResult,
        completedScenarios,
        activeScenarios,
      });
    } finally {
      pool.release(mcp);

      const count = activeRoots.get(root) || 0;
      if (count <= 1) {
        activeRoots.delete(root);
      } else {
        activeRoots.set(root, count - 1);
      }
      if (task.scenario.isolation) {
        activeIsolatedRoots.delete(root);
      }
    }
  };

  const isTaskAvailable = (t: (typeof tasks)[0]) => {
    const r = t.project.root;
    if (t.scenario.isolation) {
      return (activeRoots.get(r) || 0) === 0;
    }
    return !activeIsolatedRoots.has(r);
  };

  while (queue.length > 0 || promisePool.size > 0) {
    // Schedule new tasks up to concurrency limit
    while (promisePool.size < concurrency && queue.length > 0) {
      let taskIndex = -1;

      // Pass 1: prefer tasks from a root not currently active (cross-project parallelism)
      if (activeRoots.size > 0) {
        taskIndex = queue.findIndex(
          (t) => !activeRoots.has(t.project.root) && isTaskAvailable(t),
        );
      }

      // Pass 2: fall back to any available task on an active root
      if (taskIndex === -1) {
        taskIndex = queue.findIndex((t) => isTaskAvailable(t));
      }

      if (taskIndex === -1) break;

      const task = queue.splice(taskIndex, 1)[0];
      const root = task.project.root;

      activeRoots.set(root, (activeRoots.get(root) || 0) + 1);
      if (task.scenario.isolation) {
        activeIsolatedRoots.add(root);
      }

      const p = runTask(task, root).finally(() => {
        promisePool.delete(p);
      });
      promisePool.add(p);
    }

    if (promisePool.size > 0) {
      // Wait for at least one task to finish
      await Promise.race(promisePool);
    } else if (queue.length > 0) {
      console.error(
        "Scheduler stuck: some tasks in queue but none can start.",
      );
      break;
    }
  }

  const resultPath = orchestrator.saveResults(timestamp);
  await pool.stop();
  options.onProgress?.({ type: "end" });
  return resultPath;
}
