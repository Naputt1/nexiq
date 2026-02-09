import { xxh3 } from "@node-rs/xxhash";

/**
 * Generates a deterministic ID from a given input string or Buffer.
 * Uses xxh3 with a constant seed to ensure stability across analyses.
 */
export function getDeterministicId(input: string | Buffer): string {
  const hasher = xxh3.Xxh3.withSeed(0n);
  hasher.update(input);
  return hasher.digest().toString(16);
}
