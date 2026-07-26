import type { Club } from "../../domain/club/model";
import type { Contract } from "../../domain/contract/model";
import type { MatchConfig, MatchParticipant } from "../../domain/match/model";
import type { PlayerMemory, PlayerProfile } from "../../domain/roster/model";
import { createMemory } from "../../domain/roster/rules";
import { instructionFor, type TeamTacticalPlan } from "../../domain/tactics/model";
import { positionFit } from "../../domain/tactics/position-fit";
import { inspectPlan, orderedAssignments } from "../../domain/tactics/rules";
import { findSlot } from "../../domain/tactics/slots";
import type { Team } from "../../domain/shared/model";

export interface MatchSideSetup {
  clubId: string;
  /** Cópia editável do plano; o clube nunca é alterado por uma partida. */
  plan: TeamTacticalPlan;
}

/** A escolha do usuário: dois clubes e os planos com que eles entram. */
export type MatchSetup = Record<Team, MatchSideSetup>;

/** Tudo que um lado precisa em campo, já resolvido a partir do catálogo. */
export interface MatchSide {
  club: Club;
  squad: PlayerProfile[];
  /** Só pela camisa, que pertence ao vínculo e não ao jogador. */
  contracts: Contract[];
  plan: TeamTacticalPlan;
}

/**
 * Contexto da partida. Substitui o `World` inteiro que esta função recebia: agora só os dois
 * elencos e as memórias deles atravessam, e é por isso que montar uma partida deixou de
 * depender do tamanho do catálogo.
 */
export interface MatchContext {
  blue: MatchSide;
  coral: MatchSide;
  memories: Record<string, PlayerMemory>;
  seed: number;
  learningEnabled: boolean;
}

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Traduz o contexto no `MatchConfig` que o motor consome. Os onze escalados entram em campo na
 * ordem do gol ao ataque; slot, encaixe e instrução viajam junto com cada participante, de modo
 * que o motor nunca precisa conhecer `TeamTacticalPlan`.
 */
export const buildMatchConfig = (context: MatchContext): MatchConfig => {
  const participants: MatchParticipant[] = [];

  for (const team of ["blue", "coral"] as const) {
    const side = context[team];
    const issues = inspectPlan(side.plan, side.squad);
    if (issues.length > 0) {
      throw new Error(`Plano tático inválido para ${side.club.name}: ${issues.map(({ kind }) => kind).join(", ")}.`);
    }

    const byId = new Map<string, PlayerProfile>(side.squad.map((player) => [player.id, player]));
    const shirtByPlayer = new Map(side.contracts.map((contract) => [contract.playerId, contract.shirtNumber]));

    orderedAssignments(side.plan).forEach((assignment, lineupIndex) => {
      const profile = byId.get(assignment.playerId)!;
      const slot = findSlot(assignment.slotId)!;
      participants.push({
        team,
        lineupIndex,
        profile: clone(profile),
        memory: clone(context.memories[profile.id] ?? createMemory(profile)),
        shirtNumber: shirtByPlayer.get(profile.id) ?? lineupIndex + 1,
        slotId: slot.id,
        positionFit: positionFit(profile, slot).rating,
        instruction: { ...instructionFor(side.plan, slot.id) },
      });
    });
  }

  return { seed: context.seed, learningEnabled: context.learningEnabled, participants };
};
