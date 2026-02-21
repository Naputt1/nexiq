#!/usr/bin/env npx tsx
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import fs from "fs";
import path from "path";
import { get_encoding } from "tiktoken";
import { z } from "zod";
import OpenAI from "openai";
import "dotenv/config";

// --- Types ---

const ScenarioSchema = z.object({
  id: z.string(),
  type: z.enum(["breadth", "depth", "complexity"]),
  prompt: z.string(),
  expected_answer_contains: z.array(z.string()),
});

const ProjectScenariosSchema = z.object({
  name: z.string(),
  root: z.string(),
  scenarios: z.array(ScenarioSchema),
});

type Scenario = z.infer<typeof ScenarioSchema>;
type ProjectScenarios = z.infer<typeof ProjectScenariosSchema>;

interface ToolCall {
  id: string;
  name: string;
  arguments: any;
}

interface BenchmarkStep {
  role: "user" | "assistant" | "tool" | "system";
  content?: string;
  toolCalls?: ToolCall[];
  toolCallId?: string; // for tool result step
  toolName?: string; // for Gemini/standard logging
  tokens: number;
}

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
  steps: BenchmarkStep[];
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
      { capabilities: {} }
    );

    await this.client.connect(transport);
    console.log("Connected to MCP server");
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

interface LlmClient {
  name: string;
  displayName: string;
  chat(messages: BenchmarkStep[], tools: any[]): Promise<{ content?: string; toolCalls?: ToolCall[] }>;
}

class OpenRouterClient implements LlmClient {
  private openai: OpenAI;
  constructor(public name: string, public displayName: string) {
    this.openai = new OpenAI({
      baseURL: "https://openrouter.ai/api/v1",
      apiKey: process.env.OPENROUTER_API_KEY,
      defaultHeaders: {
        "HTTP-Referer": "https://github.com/google-gemini/react-map",
        "X-Title": "React Map Benchmark",
      }
    });
  }

  async chat(messages: BenchmarkStep[], tools: any[]) {
    const formattedMessages = messages.map(m => {
      if (m.role === "tool") {
        return { role: "tool", content: m.content || "", tool_call_id: m.toolCallId! };
      }
      if (m.role === "assistant") {
        return {
          role: "assistant",
          content: m.content || null,
          tool_calls: m.toolCalls?.map(tc => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
          }))
        } as any;
      }
      return { role: m.role as any, content: m.content || "" };
    });

    const response = await (this.openai.chat.completions.create as any)({
      model: this.name,
      messages: formattedMessages,
      tools: tools.map(t => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema
        }
      })),
      transforms: ["middle-out"]
    });

    const message = response.choices[0]!.message;
    const toolCalls = message.tool_calls
      ?.filter((tc: any) => tc.type === "function")
      .map((tc: any) => {
        const tool = tc as any;
        return {
          id: tool.id,
          name: tool.function.name,
          arguments: JSON.parse(tool.function.arguments)
        };
      });

    return {
      content: message.content || undefined,
      toolCalls
    };
  }
}

// --- Benchmark Runner ---

class BenchmarkRunner {
  private results: BenchmarkResult[] = [];

  async runScenario(
    project: ProjectScenarios,
    scenario: Scenario,
    approach: "baseline" | "react-map-cold" | "react-map-warm",
    testType: "single-prompt" | "planning",
    llm: LlmClient,
    mcp: McpRunner
  ): Promise<BenchmarkResult> {
    console.log(`\n>>> Scenario ${scenario.id} (${project.name}) | Model: ${llm.displayName} | Approach: ${approach} | Type: ${testType}`);
    
    const startTime = Date.now();
    let totalTokens = 0;
    let toolCallsCount = 0;
    const steps: BenchmarkStep[] = [];
    const absoluteRoot = path.resolve(project.root);

    // Pre-scenario setup
    if (approach === "react-map-cold") {
      const cacheDir = path.join(project.root, ".react-map", "cache");
      if (fs.existsSync(cacheDir)) {
        fs.rmSync(cacheDir, { recursive: true });
      }
    }

    // Initialize MCP with project (Always call it to set context)
    await mcp.callTool("open_project", { projectPath: absoluteRoot });

    // Tools setup
    const allTools = await mcp.listTools();
    const availableTools = approach === "baseline" 
      ? allTools.filter(t => ["list_directory", "read_file", "grep_search", "run_shell_command"].includes(t.name))
      : allTools;

    const pathContext = `The project is already open at "${absoluteRoot}". Use this absolute path for the 'projectPath' argument in all tool calls. 
    IMPORTANT: Do not search or explore '.git', 'node_modules', or '.react-map' directories as they contain large amounts of noise. 
    Use specialized tools like 'get_symbol_info' or 'get_component_hierarchy' when available, as they are significantly more accurate and token-efficient than generic shell commands.`;

    // Interaction setup based on testType
    if (testType === "planning") {
      const systemMsg: BenchmarkStep = {
        role: "system",
        content: `You are an expert software engineer tasked with solving this discovery problem: "${scenario.prompt}". 
        ${pathContext}
        1. Explore the project structure and source code using the available tools. 
        2. Create a detailed, step-by-step plan for how you will find the required information. 
        3. Execute your plan meticulously and provide the final answer.`,
        tokens: 0
      };
      systemMsg.tokens = countTokens(systemMsg.content);
      steps.push(systemMsg);
      totalTokens += systemMsg.tokens;
    } else {
       // For single-prompt, we can add context to the first user message or a system message
       const systemMsg: BenchmarkStep = {
          role: "system",
          content: pathContext,
          tokens: 0
       };
       systemMsg.tokens = countTokens(systemMsg.content);
       steps.push(systemMsg);
       totalTokens += systemMsg.tokens;
    }

    steps.push({ 
      role: "user", 
      content: scenario.prompt, 
      tokens: countTokens(scenario.prompt) 
    });
    totalTokens += steps[steps.length - 1].tokens;

    let iterations = 0;
    const MAX_ITERATIONS = 10;
    let success = false;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      console.log(`Iteration ${iterations}...`);

      const response = await llm.chat(steps, availableTools);
      const assistantMessage: BenchmarkStep = {
        role: "assistant",
        content: response.content,
        toolCalls: response.toolCalls,
        tokens: countTokens(response.content) + (response.toolCalls ? countTokens(JSON.stringify(response.toolCalls)) : 0)
      };
      steps.push(assistantMessage);
      totalTokens += assistantMessage.tokens;

      if (response.toolCalls && response.toolCalls.length > 0) {
        for (const tc of response.toolCalls) {
          toolCallsCount++;
          console.log(`  Tool Call: ${tc.name}`);
          const toolArgs = { ...tc.arguments };
          if (!toolArgs.projectPath && approach !== "baseline" && tc.name.startsWith("get_")) {
             toolArgs.projectPath = path.resolve(project.root);
          }

          const result = await mcp.callTool(tc.name, toolArgs);
          let resultContent = JSON.stringify(result);
          let toolTokens = countTokens(resultContent);

          const MAX_TOOL_TOKENS = 30000;
          if (toolTokens > MAX_TOOL_TOKENS) {
            console.warn(`  Tool output too large (${toolTokens} tokens). Truncating...`);
            // Truncate based on character count as a heuristic, then refine with tokenizer
            const truncatedContent = resultContent.slice(0, MAX_TOOL_TOKENS * 4); 
            resultContent = `${truncatedContent}\n\n... [TRUNCATED DUE TO SIZE: ${toolTokens} tokens total] ...`;
            toolTokens = countTokens(resultContent);
          }

          const toolMessage: BenchmarkStep = {
            role: "tool",
            content: resultContent,
            toolCallId: tc.id,
            toolName: tc.name,
            tokens: toolTokens
          };
          steps.push(toolMessage);
          totalTokens += toolTokens;
        }
      } else if (response.content) {
        console.log("Final answer received.");
        const answer = response.content.toLowerCase();
        success = scenario.expected_answer_contains.every(term => answer.includes(term.toLowerCase()));
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
      steps
    };
    this.results.push(result);
    return result;
  }

  saveResults() {
    const timestamp = new Date().toISOString().replace(/:/g, "-");
    const outFile = path.join("benchmarks/results", `run_${timestamp}.json`);
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(this.results, null, 2));
    console.log(`\nResults saved to ${outFile}`);
  }
}

// --- Main ---

async function main() {
  const runner = new BenchmarkRunner();
  const mcp = new McpRunner();
  const serverPath = path.resolve("packages/server/dist/index.js");

  const projects = ["small", "mid", "large"];
  
  const models: LlmClient[] = [];
  if (process.env.OPENROUTER_API_KEY) {
    models.push(new OpenRouterClient("google/gemini-3-flash-preview", "Gemini 3 Flash Preview"));
    models.push(new OpenRouterClient("anthropic/claude-sonnet-4.6", "Claude Sonnet 4.6"));
    models.push(new OpenRouterClient("openai/gpt-5.2-codex", "GPT-5.2 Codex"));
  } else {
    console.error("OPENROUTER_API_KEY not found.");
    return;
  }

  try {
    await mcp.start(serverPath);

    for (const tier of projects) {
      const scenarioFile = path.join("benchmarks/scenarios", `${tier}.json`);
      if (!fs.existsSync(scenarioFile)) continue;
      
      const projectData: ProjectScenarios = JSON.parse(fs.readFileSync(scenarioFile, "utf-8"));

      for (const scenario of projectData.scenarios) {
        for (const model of models) {
          for (const testType of ["single-prompt", "planning"] as const) {
            for (const approach of ["baseline", "react-map-warm"] as const) {
               try {
                  const result = await runner.runScenario(projectData, scenario, approach, testType, model, mcp);
                  console.log(`  Result: ${result.success ? "SUCCESS" : "FAILED"}, Tokens: ${result.totalTokens}, Calls: ${result.toolCallsCount}`);
               } catch (e) {
                  console.error(`  Error running scenario: ${e}`);
               }
            }
          }
        }
      }
    }

    runner.saveResults();
  } finally {
    await mcp.stop();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
