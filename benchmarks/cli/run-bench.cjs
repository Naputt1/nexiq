const { runBenchmarks, OpenRouterClient } = require("./dist/index.js");

const model = new OpenRouterClient(
  "deepseek/deepseek-v4-flash",
  "DeepSeek V4 Flash",
);

runBenchmarks({
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
}).then(() => {
  console.log("Benchmark complete");
  process.exit(0);
}).catch((err) => {
  console.error("Benchmark failed:", err);
  process.exit(1);
});
