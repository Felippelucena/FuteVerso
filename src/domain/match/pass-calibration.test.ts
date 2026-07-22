import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState, stepMatch } from "./index";
import type { PendingPass } from "./model";
import { evaluateForwardRunway } from "./runtime/dribble-runway";

type Bucket = { total: number; intended: number; teammate: number; opponent: number; expired: number };

describe("calibracao deterministica da partida", () => {
  it("mantem passes, piques e energia nas faixas em doze sementes", () => {
    const buckets = new Map<string, Bucket>();
    const touches = { short: 0, medium: 0, long: 0 };
    const energy = {
      midfielder: { sum: 0, samples: 0, belowHalf: 0, atFloor: 0 },
      forward: { sum: 0, samples: 0, belowHalf: 0, atFloor: 0 },
    };
    let clearRunwaySamples = 0;
    let carryingWithClearRunway = 0;
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createMatchState(buildMatchConfig(createDefaultProfile(), 7000 + seed));
      let tracked: PendingPass | null = null;
      let nextWorkloadSample = 0;
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
        if (state.elapsed + 0.000_001 >= nextWorkloadSample) {
          nextWorkloadSample += 0.25;
          const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
          if (controller && evaluateForwardRunway(state, controller).distance >= 23) {
            clearRunwaySamples += 1;
            if (controller.intent === "carrying") carryingWithClearRunway += 1;
          }
          for (const player of state.players) {
            if (player.profile.position !== "midfielder" && player.profile.position !== "forward") continue;
            const role = energy[player.profile.position];
            role.sum += player.energy;
            role.samples += 1;
            if (player.energy < 0.5) role.belowHalf += 1;
            if (player.energy <= 0.351) role.atFloor += 1;
          }
        }
      }
      if (tracked) finishTracked();
      touches.short += state.stats.blue.shortSprintDribbles + state.stats.coral.shortSprintDribbles;
      touches.medium += state.stats.blue.mediumSprintDribbles + state.stats.coral.mediumSprintDribbles;
      touches.long += state.stats.blue.longSprintDribbles + state.stats.coral.longSprintDribbles;
    }

    const report = Object.fromEntries([...buckets].map(([key, bucket]) => [key, {
      ...bucket,
      accuracy: Number((bucket.teammate / bucket.total).toFixed(3)),
      intendedAccuracy: Number((bucket.intended / bucket.total).toFixed(3)),
    }]));
    console.info("PASS_CALIBRATION", JSON.stringify(report));
    const totalTouches = touches.short + touches.medium + touches.long;
    const touchReport = {
      perMatch: totalTouches / 12,
      distribution: {
        short: touches.short / totalTouches,
        medium: touches.medium / totalTouches,
        long: touches.long / totalTouches,
      },
      carryWithClearRunway: carryingWithClearRunway / clearRunwaySamples,
      energy: Object.fromEntries(Object.entries(energy).map(([position, role]) => [position, {
        average: role.sum / role.samples,
        belowHalf: role.belowHalf / role.samples,
        atFloor: role.atFloor / role.samples,
      }])),
    };
    console.info("WORKLOAD_CALIBRATION", JSON.stringify(touchReport));
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
    expect(touchReport.perMatch).toBeGreaterThanOrEqual(18);
    expect(touchReport.perMatch).toBeLessThanOrEqual(32);
    expect(touchReport.distribution.short).toBeGreaterThanOrEqual(0.35);
    expect(touchReport.distribution.short).toBeLessThanOrEqual(0.55);
    expect(touchReport.distribution.medium).toBeGreaterThanOrEqual(0.3);
    expect(touchReport.distribution.medium).toBeLessThanOrEqual(0.45);
    expect(touchReport.distribution.long).toBeGreaterThanOrEqual(0.1);
    expect(touchReport.distribution.long).toBeLessThanOrEqual(0.25);
    expect(touchReport.carryWithClearRunway).toBeLessThanOrEqual(0.5);
    expect(touchReport.energy.midfielder.average).toBeGreaterThanOrEqual(0.6);
    expect(touchReport.energy.midfielder.average).toBeLessThanOrEqual(0.85);
    expect(touchReport.energy.forward.average).toBeGreaterThanOrEqual(0.58);
    expect(touchReport.energy.forward.average).toBeLessThanOrEqual(0.82);
    expect(touchReport.energy.midfielder.belowHalf).toBeLessThan(0.25);
    expect(touchReport.energy.forward.belowHalf).toBeLessThan(0.25);
    expect(touchReport.energy.midfielder.atFloor).toBeLessThan(0.05);
    expect(touchReport.energy.forward.atFloor).toBeLessThan(0.05);
  }, 120_000);
});
