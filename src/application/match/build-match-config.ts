import { squadOf } from "../../domain/contract/queries";
import type { MatchConfig, MatchParticipant } from "../../domain/match/model";
import type { PlayerProfile } from "../../domain/roster/model";
import { createMemory } from "../../domain/roster/rules";
import { instructionFor, type TeamTacticalPlan } from "../../domain/tactics/model";
import { positionFit } from "../../domain/tactics/position-fit";
import { inspectPlan, orderedAssignments } from "../../domain/tactics/rules";
import { findSlot } from "../../domain/tactics/slots";
import type { Team } from "../../domain/shared/model";
import type { World } from "../../domain/world/model";

export interface MatchSideSetup {
  clubId: string;
  /** Cópia editável do plano; o clube nunca é alterado por uma partida. */
  plan: TeamTacticalPlan;
}

export type MatchSetup = Record<Team, MatchSideSetup>;

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Traduz mundo + planos no `MatchConfig` que o motor consome. Os onze escalados entram em
 * campo na ordem do gol ao ataque; slot, encaixe e instrução viajam junto com cada
 * participante, de modo que o motor nunca precisa conhecer `TeamTacticalPlan`.
 */
export const buildMatchConfig = (world: World, setup: MatchSetup, seedOverride?: number): MatchConfig => {
  const participants: MatchParticipant[] = [];

  for (const team of ["blue", "coral"] as const) {
    const side = setup[team];
    const club = world.clubs.find(({ id }) => id === side.clubId);
    if (!club) throw new Error(`Clube ${side.clubId} não existe no catálogo.`);
    const squad = squadOf(world.players, world.contracts, club.id);
    const issues = inspectPlan(side.plan, squad);
    if (issues.length > 0) {
      throw new Error(`Plano tático inválido para ${club.name}: ${issues.map(({ kind }) => kind).join(", ")}.`);
    }

    const byId = new Map<string, PlayerProfile>(squad.map((player) => [player.id, player]));
    const shirtByPlayer = new Map(world.contracts
      .filter((contract) => contract.clubId === club.id)
      .map((contract) => [contract.playerId, contract.shirtNumber]));

    orderedAssignments(side.plan).forEach((assignment, lineupIndex) => {
      const profile = byId.get(assignment.playerId)!;
      const slot = findSlot(assignment.slotId)!;
      participants.push({
        team,
        lineupIndex,
        profile: clone(profile),
        memory: clone(world.memories[profile.id] ?? createMemory(profile)),
        shirtNumber: shirtByPlayer.get(profile.id) ?? lineupIndex + 1,
        slotId: slot.id,
        positionFit: positionFit(profile, slot).rating,
        instruction: { ...instructionFor(side.plan, slot.id) },
      });
    });
  }

  return {
    seed: seedOverride ?? world.settings.randomSeed,
    learningEnabled: world.settings.learningEnabled,
    participants,
  };
};
