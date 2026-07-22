import { describe, expect, it } from "vitest";
import { buildMatchConfig } from "../../application/match/build-match-config";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import { createMatchState, stepMatch } from "./index";
import { FIELD } from "./config";
import type { PendingPass } from "./model";
import { evaluateForwardRunway } from "./runtime/dribble-runway";
import { evaluateShotOpportunity } from "./runtime/shot-opportunity";

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
    const attack = { crosses: 0, eligibleCrosses: 0, directCrosses: 0, firstTimeShots: 0, shots: 0, longShots: 0, aggressiveBreaks: 0 };
    let safetySamples = 0;
    let advancedSafetySamples = 0;
    let exposedShapeSamples = 0;
    let clearChanceSamples = 0;
    let decisiveClearChances = 0;
    const activeClearChances = new Map<string, { startedAt: number; expiresAt: number }>();
    for (let seed = 1; seed <= 12; seed += 1) {
      const state = createMatchState(buildMatchConfig(createDefaultProfile(), 7000 + seed));
      let tracked: PendingPass | null = null;
      let trackedFirstTimeShots = 0;
      let nextWorkloadSample = 0;
      const finishTracked = () => {
        if (!tracked) return;
        const key = `${tracked.range}-${tracked.trajectory}`;
        const bucket = buckets.get(key) ?? { total: 0, intended: 0, teammate: 0, opponent: 0, expired: 0 };
        bucket.total += 1;
        const resolution = [...state.cognitiveEvents].reverse().find((event) => event.type === "passResolved" && event.passId === tracked?.id);
        const controller = state.players.find((player) => player.profile.id === (resolution?.controllerId ?? state.ball.controllerId));
        if (resolution?.outcome === "received" || resolution?.outcome === "otherTeammate" || controller?.team === tracked.team) {
          bucket.teammate += 1;
          if (resolution?.outcome === "received" || controller?.profile.id === tracked.receiverId) bucket.intended += 1;
        } else if (resolution?.outcome === "intercepted" || controller) bucket.opponent += 1;
        else bucket.expired += 1;
        buckets.set(key, bucket);
        if (tracked.purpose === "cross" && (resolution?.outcome === "received" || resolution?.outcome === "otherTeammate" || controller?.team === tracked.team)) {
          attack.eligibleCrosses += 1;
          const currentFirstTimeShots = state.stats.blue.firstTimeShots + state.stats.coral.firstTimeShots;
          if (currentFirstTimeShots > trackedFirstTimeShots) attack.directCrosses += 1;
        }
      };

      while (!state.finished) {
        stepMatch(state, 1 / 120);
        for (const [playerId, chance] of activeClearChances) {
          const shot = state.events.find((event) => event.type === "shot-taken" && event.playerId === playerId && event.time >= chance.startedAt);
          const pass = state.pendingPass?.passerId === playerId && state.pendingPass.startedAt >= chance.startedAt;
          if (shot || pass) {
            clearChanceSamples += 1;
            decisiveClearChances += 1;
            activeClearChances.delete(playerId);
          } else if (state.elapsed >= chance.expiresAt) {
            clearChanceSamples += 1;
            activeClearChances.delete(playerId);
          }
        }
        if (tracked && (!state.pendingPass || state.pendingPass.startedAt !== tracked.startedAt)) {
          finishTracked();
          tracked = null;
        }
        if (!tracked && state.pendingPass) {
          tracked = { ...state.pendingPass };
          trackedFirstTimeShots = state.stats.blue.firstTimeShots + state.stats.coral.firstTimeShots;
        }
        if (state.elapsed + 0.000_001 >= nextWorkloadSample) {
          nextWorkloadSample += 0.25;
          const controller = state.players.find((player) => player.profile.id === state.ball.controllerId);
          if (controller && evaluateForwardRunway(state, controller).distance >= 23) {
            clearRunwaySamples += 1;
            if (controller.intent === "carrying") carryingWithClearRunway += 1;
          }
          if (controller) {
            const opponents = state.players.filter((player) => player.team !== controller.team);
            const shot = evaluateShotOpportunity(controller, opponents, state);
            if (shot && !shot.blocked && shot.distance < FIELD.width * 0.18 && !activeClearChances.has(controller.profile.id)) {
              activeClearChances.set(controller.profile.id, { startedAt: state.elapsed, expiresAt: state.elapsed + 0.75 });
            }
            const safetyId = state.tactics[controller.team].collectivePlan?.safetyPlayerId;
            const safety = state.players.find((player) => player.profile.id === safetyId);
            if (state.tactics[controller.team].phase === "finalThird" && safety) {
              safetySamples += 1;
              const progress = safety.team === "blue" ? safety.position.x / FIELD.width : (FIELD.width - safety.position.x) / FIELD.width;
              if (progress > 0.5) advancedSafetySamples += 1;
              const direction = controller.team === "blue" ? 1 : -1;
              const outfield = state.players.filter((player) => player.team === controller.team && player.profile.position !== "goalkeeper");
              const threatExists = opponents.some((opponent) => opponent.profile.position !== "goalkeeper"
                && direction * (state.ball.position.x - opponent.position.x) > 0);
              if (threatExists && outfield.every((player) => direction * (player.position.x - state.ball.position.x) > 0)) exposedShapeSamples += 1;
            }
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
      clearChanceSamples += activeClearChances.size;
      activeClearChances.clear();
      if (tracked) finishTracked();
      touches.short += state.stats.blue.shortSprintDribbles + state.stats.coral.shortSprintDribbles;
      touches.medium += state.stats.blue.mediumSprintDribbles + state.stats.coral.mediumSprintDribbles;
      touches.long += state.stats.blue.longSprintDribbles + state.stats.coral.longSprintDribbles;
      for (const team of ["blue", "coral"] as const) {
        attack.crosses += state.stats[team].crosses;
        attack.firstTimeShots += state.stats[team].firstTimeShots;
        attack.shots += state.stats[team].shots;
        attack.longShots += state.stats[team].longShots;
        attack.aggressiveBreaks += state.stats[team].aggressiveBreaks;
      }
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
    const attackReport = {
      ...attack,
      directCrossRate: attack.directCrosses / Math.max(1, attack.eligibleCrosses),
      longShotRate: attack.longShots / Math.max(1, attack.shots),
      advancedSafetyRate: advancedSafetySamples / Math.max(1, safetySamples),
      exposedShapeSamples,
      decisiveClearChanceRate: decisiveClearChances / Math.max(1, clearChanceSamples),
    };
    console.info("ATTACK_CALIBRATION", JSON.stringify(attackReport));
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
    expect(attackReport.directCrossRate).toBeGreaterThanOrEqual(0.15);
    expect(attackReport.directCrossRate).toBeLessThanOrEqual(0.35);
    expect(attackReport.longShotRate).toBeGreaterThanOrEqual(0.1);
    expect(attackReport.longShotRate).toBeLessThanOrEqual(0.25);
    expect(attackReport.decisiveClearChanceRate).toBeGreaterThanOrEqual(0.7);
    expect(attackReport.advancedSafetyRate).toBeGreaterThanOrEqual(0.25);
    expect(attackReport.advancedSafetyRate).toBeLessThanOrEqual(0.5);
    expect(attackReport.exposedShapeSamples).toBe(0);
  }, 120_000);
});
