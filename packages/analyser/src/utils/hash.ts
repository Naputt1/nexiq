import { xxh3 } from "@node-rs/xxhash";

function hashInputs(inputs: (string | Buffer)[]): string {
  const hasher = xxh3.Xxh3.withSeed(0n);
  for (const input of inputs) {
    hasher.update(input);
  }
  return hasher.digest().toString(16);
}

const MAX_CACHE = 200_000;
const cache = new Map<string, string>();

/**
 * Generates a deterministic ID from one or more input strings or Buffers.
 * Uses xxh3 with a constant seed to ensure stability across analyses.
 *
 * Short, frequently-repeated inputs (names, file keys) are memoized: they are
 * hashed thousands of times per file and the xxh3 hasher + digest allocation
 * showed up as a top hotspot in profiling. Long inputs (e.g. serialized data
 * used for content hashes) are unique per call and skip the cache to avoid
 * polluting it.
 */
export function getDeterministicId(...inputs: (string | Buffer)[]): string {
  if (inputs.length > 0) {
    let total = 0;
    for (const input of inputs) {
      total += input.length;
    }
    if (total <= 128) {
      const key =
        inputs.length === 1
          ? (inputs[0] as unknown as string)
          : inputs
              .map((x) => (typeof x === "string" ? x : x.toString("base64")))
              .join("\u0001");
      const hit = cache.get(key);
      if (hit !== undefined) {
        return hit;
      }
      if (cache.size >= MAX_CACHE) {
        cache.clear();
      }
      const id = hashInputs(inputs);
      cache.set(key, id);
      return id;
    }
  }
  return hashInputs(inputs);
}
