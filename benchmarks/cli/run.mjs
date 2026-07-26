import { runBenchmarks, OpenRouterClient } from "./src/runner.ts";

const model = new OpenRouterClient("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash");
console.log("Starting benchmark...");

const startTime = Date.now();
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

console.log(`Done in ${((Date.now() - startTime) / 1000 / 60).toFixed(1)} min`);
