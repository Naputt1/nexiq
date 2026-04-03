import { xxh3 } from "@node-rs/xxhash";

/**
 * Generates a deterministic ID from one or more input strings or Buffers.
 * Uses xxh3 with a constant seed to ensure stability across analyses.
 */
// export function getDeterministicId(...inputs: (string | Buffer)[]): string {
//   const temp = getDeterministicId2(...inputs);
//   if (temp == "feb679a1fc1ff92") debugger;
//   return temp;
// }
export function getDeterministicId(...inputs: (string | Buffer)[]): string {
  const hasher = xxh3.Xxh3.withSeed(0n);
  for (const input of inputs) {
    hasher.update(input);
  }
  return hasher.digest().toString(16);
}
