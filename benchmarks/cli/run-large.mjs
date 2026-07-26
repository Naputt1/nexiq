import { runBenchmarks, OpenRouterClient } from "./src/runner.ts";

const model = new OpenRouterClient("deepseek/deepseek-v4-flash", "DeepSeek V4 Flash");
console.log("Starting benchmark (large only, concurrency=1)...");

const start = Date.now();
await runBenchmarks({
  projects: ["large"],
  models: [model],
  testTypes: ["single-prompt", "coding"],
  approaches: ["baseline", "nexiq-skill"],
  concurrency: 1,
  onProgress: (u) => {
    if (u.type === "scenario-end" && u.result) {
      const r = u.result;
      console.log(`[${r.success ? "PASS" : "FAIL"}] ${r.scenarioId} ${r.approach} (${r.totalTokens} tokens, ${r.toolCallsCount} calls)`);
    }
  },
});
console.log(`Done in ${((Date.now() - start) / 1000 / 60).toFixed(1)} min`);
