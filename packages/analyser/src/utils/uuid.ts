import seedrandom from "seedrandom";

let seed: string | null = null;

export const setRandomSeed = (s: string | null) => {
  seed = s;
};

export const newUUID = () => {
  if (seed == null) {
    return crypto.randomUUID();
  } else {
    const rng = seedrandom(seed);
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (rng() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }
};
