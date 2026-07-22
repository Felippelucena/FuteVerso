import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState, stepMatch } from "./index";
import type { PendingPass } from "./model";

type Bucket = { total: number; intended: number; teammate: number; opponent: number; expired: number };

describe("calibracao deterministica dos passes", () => {
  it("mantem amostra e precisao por variante em doze sementes", () => {
    const buckets = new Map<string, Bucket>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createMatchState(buildMatchConfig(createDefaultProfile(), 7000 + seed));
      let tracked: PendingPass | null = null;
      const finishTracked = () => {
        if (!tracked) return;
        const key = `${tracked.range}-${tracked.trajectory}`;
        const bucket = buckets.get(key) ?? { total: 0, intended: 0, teammate: 0, opponent: 0, expired: 0 };
        bucket.total += 1;
        const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
        if (controller?.team === tracked.team) {
          bucket.teammate += 1;
          if (controller.profile.id === tracked.receiverId) bucket.intended += 1;
        } else if (controller) bucket.opponent += 1;
        else bucket.expired += 1;
        buckets.set(key, bucket);
      };

      while (!state.finished) {
        stepMatch(state, 1 / 120);
        if (tracked && (!state.pendingPass || state.pendingPass.startedAt !== tracked.startedAt)) {
          finishTracked();
          tracked = null;
        }
        if (!tracked && state.pendingPass) tracked = { ...state.pendingPass };
      }
      if (tracked) finishTracked();
    }

    const report = Object.fromEntries([...buckets].map(([key, bucket]) => [key, {
      ...bucket,
      accuracy: Number((bucket.teammate / bucket.total).toFixed(3)),
      intendedAccuracy: Number((bucket.intended / bucket.total).toFixed(3)),
    }]));
    console.info("PASS_CALIBRATION", JSON.stringify(report));
    expect([...buckets.values()].reduce((sum, bucket) => sum + bucket.total, 0)).toBeGreaterThan(400);
    for (const key of ["short-ground", "long-ground", "short-air", "long-air"]) {
      expect(buckets.get(key)?.total ?? 0).toBeGreaterThan(15);
    }
    const accuracy = (key: string) => (buckets.get(key)?.teammate ?? 0) / (buckets.get(key)?.total ?? 1);
    expect(accuracy("short-ground")).toBeGreaterThanOrEqual(0.65);
    expect(accuracy("short-ground")).toBeLessThanOrEqual(0.75);
    expect(accuracy("long-ground")).toBeGreaterThanOrEqual(0.55);
    expect(accuracy("long-ground")).toBeLessThanOrEqual(0.65);
    expect(accuracy("short-air")).toBeGreaterThanOrEqual(0.5);
    expect(accuracy("short-air")).toBeLessThanOrEqual(0.6);
    expect(accuracy("long-air")).toBeGreaterThanOrEqual(0.3);
    expect(accuracy("long-air")).toBeLessThanOrEqual(0.45);
  }, 120_000);
});
