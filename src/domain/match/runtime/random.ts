import type { MatchState } from "../model";

export const nextMatchRandom = (state: MatchState): number => {
  state.randomSeed = (Math.imul(state.randomSeed, 1664525) + 1013904223) >>> 0;
  return state.randomSeed / 0x100000000;
};

export const signedMatchNoise = (state: MatchState): number => nextMatchRandom(state) - nextMatchRandom(state);
