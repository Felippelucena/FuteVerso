import type { PlayerProfile } from "../roster/model";
import {
  NEUTRAL_MENTALITY,
  TEAM_SIZE,
  type TeamTacticalPlan,
} from "./model";
import { positionFit } from "./position-fit";
import { findSlot, GOALKEEPER_SLOT_ID, slotOrder, type TacticalSlotId } from "./slots";
import { PRESS_TRIGGERS } from "./vocabulary";

export type TacticalPlanIssueKind =
  | "wrong-size"
  | "unknown-slot"
  | "duplicate-slot"
  | "duplicate-player"
  | "unknown-player"
  | "missing-goalkeeper"
  | "blocked-position"
  | "bench-conflict";

export interface TacticalPlanIssue {
  kind: TacticalPlanIssueKind;
  slotId?: string;
  playerId?: string;
}

export const createEmptyPlan = (): TeamTacticalPlan => ({
  formationId: null,
  assignments: [],
  bench: [],
  mentality: { ...NEUTRAL_MENTALITY },
  buildUpStyle: "auto",
  defensiveBlock: "auto",
  pressTriggers: [...PRESS_TRIGGERS],
  instructions: {},
});

/**
 * Lista tudo que impede o plano de entrar em campo. Devolve todos os problemas de uma vez,
 * e não o primeiro, porque o editor destaca cada slot com defeito ao mesmo tempo.
 */
export const inspectPlan = (plan: TeamTacticalPlan, players: PlayerProfile[]): TacticalPlanIssue[] => {
  const issues: TacticalPlanIssue[] = [];
  const byId = new Map(players.map((player) => [player.id, player]));
  const seenSlots = new Set<string>();
  const seenPlayers = new Set<string>();

  if (!Array.isArray(plan.assignments) || plan.assignments.length !== TEAM_SIZE) {
    issues.push({ kind: "wrong-size" });
  }

  for (const assignment of plan.assignments ?? []) {
    const slot = findSlot(assignment.slotId);
    if (!slot) {
      issues.push({ kind: "unknown-slot", slotId: assignment.slotId });
      continue;
    }
    if (seenSlots.has(slot.id)) issues.push({ kind: "duplicate-slot", slotId: slot.id });
    seenSlots.add(slot.id);
    if (seenPlayers.has(assignment.playerId)) issues.push({ kind: "duplicate-player", playerId: assignment.playerId });
    seenPlayers.add(assignment.playerId);

    const player = byId.get(assignment.playerId);
    if (!player) {
      issues.push({ kind: "unknown-player", slotId: slot.id, playerId: assignment.playerId });
      continue;
    }
    if (positionFit(player, slot).level === "blocked") {
      issues.push({ kind: "blocked-position", slotId: slot.id, playerId: assignment.playerId });
    }
  }

  if (!seenSlots.has(GOALKEEPER_SLOT_ID)) issues.push({ kind: "missing-goalkeeper" });

  const seenBench = new Set<string>();
  for (const playerId of plan.bench ?? []) {
    if (!byId.has(playerId)) issues.push({ kind: "unknown-player", playerId });
    else if (seenPlayers.has(playerId) || seenBench.has(playerId)) issues.push({ kind: "bench-conflict", playerId });
    seenBench.add(playerId);
  }

  return issues;
};

export const isValidPlan = (plan: TeamTacticalPlan, players: PlayerProfile[]): boolean =>
  inspectPlan(plan, players).length === 0;

/** Titulares do gol ao ataque — a ordem em que o motor recebe os participantes. */
export const orderedAssignments = (plan: TeamTacticalPlan): TeamTacticalPlan["assignments"] =>
  [...plan.assignments].sort((first, second) => {
    const firstSlot = findSlot(first.slotId);
    const secondSlot = findSlot(second.slotId);
    if (!firstSlot || !secondSlot) return 0;
    return slotOrder(firstSlot) - slotOrder(secondSlot);
  });

export const assignedPlayerIds = (plan: TeamTacticalPlan): string[] =>
  plan.assignments.map((assignment) => assignment.playerId);

export const slotOfPlayer = (plan: TeamTacticalPlan, playerId: string): TacticalSlotId | null =>
  plan.assignments.find((assignment) => assignment.playerId === playerId)?.slotId ?? null;
