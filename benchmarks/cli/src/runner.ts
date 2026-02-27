import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import OpenAI from "openai";
import dotenv from "dotenv";
dotenv.config({ path: "../../.env" });

// --- Types ---

export const ScenarioSchema = z.object({
  id: z.string(),
  type: z.enum(["breadth", "depth", "complexity"]),
  prompt: z.string(),
  expected_answer_contains: z.array(z.string()),
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
  approach: "baseline" | "react-map-cold" | "react-map-warm";
  testType: "single-prompt" | "planning";
  model: string;
  success: boolean;
  totalTokens: number;
  toolCallsCount: number;
  latencyMs: number;
  steps: BenchmarkStep[];
}

export interface RunOptions {
  projects: string[];
  models: LlmClient[];
  testTypes: ("single-prompt" | "planning")[];
  approaches: ("baseline" | "react-map-cold" | "react-map-warm")[];
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

  async start(serverPath: string, args: string[] = []) {
    const transport = new StdioClientTransport({
      command: "node",
      args: [serverPath, ...args],
    });

    this.client = new Client(
      { name: "benchmark-runner", version: "1.0.0" },
      { capabilities: {} },
    );

    await this.client.connect(transport);
  }

  async stop() {
    if (this.client) await this.client.close();
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
    this.openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/google-gemini/react-map",
        "X-Title": "React Map Benchmark",
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

    const response = await (this.openai.chat.completions.create as any)({
      model: this.name,
      messages: formattedMessages,
      tools: tools.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
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
  }
}

// --- Snapshot Manager ---

export class SnapshotManager {
  private baseDir: string;

  constructor(runTimestamp: string) {
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

// --- Benchmark Runner ---

export class BenchmarkRunner {
  private results: BenchmarkResult[] = [];
  private snapshots: SnapshotManager;

  constructor(runTimestamp: string) {
    this.snapshots = new SnapshotManager(runTimestamp);
  }

  async runScenario(
    project: ProjectScenarios,
    scenario: Scenario,
    approach: "baseline" | "react-map-cold" | "react-map-warm",
    testType: "single-prompt" | "planning",
    llm: LlmClient,
    mcp: McpRunner,
    onProgress?: (update: ProgressUpdate) => void,
  ): Promise<BenchmarkResult> {
    const startTime = Date.now();
    let totalTokens = 0;
    let toolCallsCount = 0;
    const steps: BenchmarkStep[] = [];

    // Resolve relative to repo root (which is two levels up from benchmarks/cli)
    const absoluteRoot = path.resolve("../../", project.root);

    // Pre-scenario setup
    if (approach === "react-map-cold") {
      const cacheDir = path.join(absoluteRoot, ".react-map", "cache");
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
          ); // Force specialized tools for react-map approach

    const pathContext = `The project is already open at "${absoluteRoot}". Use this absolute path for the 'projectPath' argument in all tool calls. 
    IMPORTANT: Do not search or explore '.git', 'node_modules', or '.react-map' directories as they contain large amounts of noise. 
    Use specialized tools like 'get_symbol_info' or 'get_component_hierarchy' when available, as they are significantly more accurate and token-efficient than generic shell commands.
    To reduce token usage, use the 'fields' parameter in tools like 'get_symbol_info' or 'get_file_outline' to return only the information you need.
    Use 'strict: true' (default) for precise symbol matching, or 'strict: false' if you need a broader search.`;

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
    const MAX_ITERATIONS = 10;
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
          if (
            !toolArgs.projectPath &&
            approach !== "baseline" &&
            tc.name.startsWith("get_")
          ) {
            toolArgs.projectPath = absoluteRoot;
          }

          const result = await mcp.callTool(tc.name, toolArgs);

          // Snapshot tool result (only for react-map specialized tools)
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
            resultContent = `${truncatedContent}

... [TRUNCATED DUE TO SIZE: ${toolTokens} tokens total] ...`;
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
        success = await this.evaluateSuccess(llm, scenario, response.content);
        break;
      } else {
        break;
      }
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
    };
    this.results.push(result);
    return result;
  }

  private async evaluateSuccess(
    llm: LlmClient,
    scenario: Scenario,
    response: string,
  ): Promise<boolean> {
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
      "../../benchmarks/results",
      `run_${timestamp}.json`,
    );
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(this.results, null, 2));
    return outFile;
  }
}

export async function runBenchmarks(options: RunOptions) {
  const timestamp = new Date().toISOString().replace(/:/g, "-");
  const runner = new BenchmarkRunner(timestamp);
  const mcp = new McpRunner();
  const serverPath = path.resolve("../../packages/server/dist/index.js");

  const totalScenariosCount =
    options.projects.length *
    options.models.length *
    options.testTypes.length *
    options.approaches.length; // This is a rough estimate as different projects have different number of scenarios

  let completedScenarios = 0;

  try {
    await mcp.start(serverPath);
    options.onProgress?.({ type: "start" });

    const sortedApproaches = [...options.approaches].sort((a, b) => {
      const order = { baseline: 0, "react-map-cold": 1, "react-map-warm": 2 };
      return order[a] - order[b];
    });

    for (const tier of options.projects) {
      const scenarioFile = path.resolve(
        `../../benchmarks/scenarios/${tier}.json`,
      );
      if (!fs.existsSync(scenarioFile)) continue;

      const projectData: ProjectScenarios = JSON.parse(
        fs.readFileSync(scenarioFile, "utf-8"),
      );

      for (const scenario of projectData.scenarios) {
        for (const model of options.models) {
          for (const testType of options.testTypes) {
            for (const approach of sortedApproaches) {
              try {
                options.onProgress?.({
                  type: "scenario-start",
                  projectName: projectData.name,
                  scenarioId: scenario.id,
                  model: model.displayName,
                  approach,
                  testType,
                });

                const result = await runner.runScenario(
                  projectData,
                  scenario,
                  approach,
                  testType,
                  model,
                  mcp,
                  options.onProgress,
                );

                completedScenarios++;
                options.onProgress?.({
                  type: "scenario-end",
                  result,
                  completedScenarios,
                });
              } catch (e) {
                console.error(`  Error running scenario: ${e}`);
              }
            }
          }
        }
      }
    }

    const resultPath = runner.saveResults(timestamp);
    options.onProgress?.({ type: "end" });
    return resultPath;
  } finally {
    await mcp.stop();
  }
}
