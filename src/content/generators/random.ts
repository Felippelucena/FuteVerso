/**
 * Aleatoriedade do conteúdo. Independente do RNG da partida (domain/match/runtime/random),
 * que muta a semente do estado a cada consulta e não pode ser usado fora da simulação.
 * Mesma semente, mesmo catálogo — é isso que torna o mundo gerado reproduzível e testável.
 */
export interface ContentRandom {
  next(): number;
  /** Inteiro entre `min` e `max`, ambos inclusive. */
  int(min: number, max: number): number;
  float(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  /** Verdadeiro com a probabilidade dada (0 a 1). */
  chance(probability: number): boolean;
  /** Normal aproximada por soma de uniformes; corta em ±3 desvios. */
  gaussian(mean: number, deviation: number): number;
  shuffle<T>(items: readonly T[]): T[];
}

export const createRandom = (seed: number): ContentRandom => {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };

  const float = (min: number, max: number): number => min + next() * (max - min);

  const random: ContentRandom = {
    next,
    float,
    int: (min, max) => Math.floor(float(min, max + 1)),
    pick: (items) => items[Math.min(items.length - 1, Math.floor(next() * items.length))],
    chance: (probability) => next() < probability,
    gaussian: (mean, deviation) => {
      const sum = next() + next() + next() + next() + next() + next();
      return mean + (sum - 3) * deviation;
    },
    shuffle: (items) => {
      const copy = [...items];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap], copy[index]];
      }
      return copy;
    },
  };
  return random;
};
