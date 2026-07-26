import { runBenchmarks, OpenRouterClient } from "./dist/index.js";

const model = new OpenRouterClient(
  "deepseek/deepseek-v4-flash",
  "DeepSeek V4 Flash",
);

await runBenchmarks({
  projects: ["small", "mid", "large"],
  models: [model],
  testTypes: ["single-prompt", "coding"],
  approaches: ["baseline", "nexiq-skill"],
  concurrency: 1,
  onProgress: (update) => {
    if (update.type === "scenario-end" && update.result) {
      const r = update.result;
      const status = r.success ? "PASS" : "FAIL";
      console.log(`[${status}] ${r.scenarioId} ${r.approach} (${r.totalTokens} tokens, ${r.toolCallsCount} calls)`);
    }
  },
});

console.log("Benchmark complete");
process.exit(0);
