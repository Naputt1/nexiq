// Final serial-vs-parallel verification.
// Usage: node benchmarks/analysis/verify-large.mjs [projectName]  (default: large)
import { analyzeProject } from "@nexiq/analyser";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = process.argv[2] || "large";
const LARGE_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "benchmarks/projects", PROJECT);

function canon(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) {
    return v.map(canon).map((x) => JSON.stringify(x)).sort();
  }
  const o = {};
  for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
  return o;
}

const serial = await analyzeProject(LARGE_ROOT, { fileWorkerThreads: 1, persist: false });
const parallel = await analyzeProject(LARGE_ROOT, { fileWorkerThreads: 4, persist: false });

const filesSerial = serial.files || {};
const filesParallel = parallel.files || {};
let fileDiffs = 0;
const fields = new Map();
for (const key of Object.keys(filesSerial)) {
  const a = canon(filesSerial[key]);
  const b = canon(filesParallel[key]);
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fileDiffs++;
    for (const field of Object.keys(a)) {
      if (JSON.stringify(canon(a[field])) !== JSON.stringify(canon(b?.[field]))) {
        fields.set(field, (fields.get(field) || 0) + 1);
      }
    }
  }
}

const edgesSerial = canon(serial.edges || []);
const edgesParallel = canon(parallel.edges || []);
const dupCount = (edges) => {
  const seen = new Set();
  let dups = 0;
  for (const k of edges) {
    if (seen.has(k)) dups++;
    seen.add(k);
  }
  return dups;
};
console.log(`files: ${Object.keys(filesSerial).length} / ${Object.keys(filesParallel).length}`);
console.log(`file diffs: ${fileDiffs} (${((fileDiffs / Object.keys(filesSerial).length) * 100).toFixed(1)}%)`);
console.log("diff fields:", [...fields.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([k, v]) => `${k}(${v})`).join(" "));
console.log(`edges: serial=${(serial.edges || []).length} parallel=${(parallel.edges || []).length} canonical-equal=${JSON.stringify(edgesSerial) === JSON.stringify(edgesParallel)}`);
console.log(`edge dups: serial=${dupCount(edgesSerial)} parallel=${dupCount(edgesParallel)}`);
