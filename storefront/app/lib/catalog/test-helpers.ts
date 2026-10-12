// Deterministic randomness for property-style tests. Test code only; production
// modules never import this file.

/** Small seeded PRNG (mulberry32) so a failing property run is reproducible. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates shuffle of a copy; the input is untouched. */
export function shuffled<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i];
    const b = result[j];
    if (a === undefined || b === undefined) continue;
    result[i] = b;
    result[j] = a;
  }
  return result;
}

/** Picks a random subset (possibly empty) of at most `max` distinct items. */
export function randomSubset<T>(
  items: readonly T[],
  max: number,
  random: () => number,
): T[] {
  const count = Math.floor(random() * (Math.min(max, items.length) + 1));
  return shuffled(items, random).slice(0, count);
}
