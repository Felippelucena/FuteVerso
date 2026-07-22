import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState, stepMatch } from "./index";
import type { MatchState } from "./model";

const round = (value: number): number => Number(value.toFixed(6));

const roundNumbers = (value: unknown): unknown => {
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundNumbers(item)]));
  }
  return value;
};

const hashFingerprint = (value: unknown): string => {
  const serialized = JSON.stringify(roundNumbers(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const fingerprint = (state: MatchState) => ({
  elapsed: round(state.elapsed),
  randomSeed: state.randomSeed,
  ball: {
    position: { x: round(state.ball.position.x), y: round(state.ball.position.y) },
    velocity: { x: round(state.ball.velocity.x), y: round(state.ball.velocity.y) },
    height: round(state.ball.height),
    verticalVelocity: round(state.ball.verticalVelocity),
    controllerId: state.ball.controllerId,
    lastTouchPlayerId: state.ball.lastTouchPlayerId,
  },
  players: state.players.map((player) => ({
    id: player.profile.id,
    position: { x: round(player.position.x), y: round(player.position.y) },
    velocity: { x: round(player.velocity.x), y: round(player.velocity.y) },
    energy: round(player.energy),
  })),
  stats: {
    blue: state.stats.blue,
    coral: state.stats.coral,
  },
});

const simulate = (seed: number, seconds: number) => {
  const state = createMatchState(buildMatchConfig(createDefaultProfile(), seed));
  for (let tick = 0; tick < seconds * 120; tick += 1) stepMatch(state, 1 / 120);
  return fingerprint(state);
};

describe("caracterizacao deterministica", () => {
  it("preserva o fingerprint de duas partidas", () => {
    const actual = {
      short: simulate(12_345, 15),
      long: simulate(98_765, 45),
    };
    const hashes = {
      short: hashFingerprint(actual.short),
      long: hashFingerprint(actual.long),
    };
    expect(hashes).toEqual({ short: "12610499", long: "7fb95cb0" });
  });
});
