import seedrandom from "seedrandom";

let seed: string | null = null;
let rng: seedrandom.PRNG | null = null;

export const setRandomSeed = (s: string) => {
  seed = s;
  rng = seedrandom(seed);
};

export const newUUID = () => {
  const localRng = rng;

  if (localRng == null) {
    return crypto.randomUUID();
  } else {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (localRng() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
};
