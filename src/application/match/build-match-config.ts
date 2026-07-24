import { squadOf } from "../../domain/contract/queries";
import type { MatchConfig, MatchParticipant } from "../../domain/match/model";
import type { PlayerProfile } from "../../domain/roster/model";
import { createMemory } from "../../domain/roster/rules";
import type { TeamTacticalPlan } from "../../domain/tactics/model";
import { positionFit } from "../../domain/tactics/position-fit";
import { inspectPlan, orderedAssignments } from "../../domain/tactics/rules";
import { findSlot, GOALKEEPER_SLOT_ID, type TacticalSlot } from "../../domain/tactics/slots";
import type { Team } from "../../domain/shared/model";
import type { World } from "../../domain/world/model";

export interface MatchSideSetup {
  clubId: string;
  /** Cópia editável do plano; o clube nunca é alterado por uma partida. */
  plan: TeamTacticalPlan;
}

export type MatchSetup = Record<Team, MatchSideSetup>;

/**
 * Jogadores de linha que o motor coloca em campo por time, além do goleiro.
 *
 * O plano tático já escala onze titulares, mas a simulação continua calibrada para quatro
 * jogadores de linha — pressão, cobertura e espaçamento foram ajustados nesse formato. Até
 * a virada para 11x11, os titulares excedentes ficam de fora e `selectStarters` escolhe um
 * recorte com forma de time (um defensor, dois meias, um atacante) em vez de cortar pela
 * ordem da lista.
 */
export const ENGINE_FIELD_PLAYERS = 4;

type Band = "defense" | "midfield" | "attack";

const bandOf = (slot: TacticalSlot): Band =>
  slot.zone.column <= 2 ? "defense" : slot.zone.column <= 6 ? "midfield" : "attack";

const BAND_QUOTA: Record<Band, number> = { defense: 1, midfield: 2, attack: 1 };

interface Starter {
  playerId: string;
  slot: TacticalSlot;
}

/** Do centro para as pontas: com poucos jogadores, o miolo do campo importa mais. */
const centrality = (slot: TacticalSlot): number => Math.abs(slot.zone.row - 4);

export const selectStarters = (plan: TeamTacticalPlan, fieldPlayers = ENGINE_FIELD_PLAYERS): Starter[] => {
  const resolved = orderedAssignments(plan)
    .map((assignment) => ({ playerId: assignment.playerId, slot: findSlot(assignment.slotId) }))
    .filter((entry): entry is Starter => entry.slot !== null);

  const goalkeeper = resolved.find((entry) => entry.slot.id === GOALKEEPER_SLOT_ID);
  if (!goalkeeper) throw new Error("O plano tático não escala um goleiro.");
  const outfield = resolved.filter((entry) => entry.slot.id !== GOALKEEPER_SLOT_ID);
  if (outfield.length <= fieldPlayers) return [goalkeeper, ...outfield];

  const byBand = new Map<Band, Starter[]>();
  for (const entry of outfield) {
    const band = bandOf(entry.slot);
    const bucket = byBand.get(band) ?? [];
    bucket.push(entry);
    byBand.set(band, bucket);
  }
  for (const bucket of byBand.values()) {
    bucket.sort((first, second) => centrality(first.slot) - centrality(second.slot)
      || first.slot.zone.column - second.slot.zone.column
      || first.slot.id.localeCompare(second.slot.id));
  }

  const chosen: Starter[] = [];
  for (const band of ["defense", "midfield", "attack"] as const) {
    chosen.push(...(byBand.get(band) ?? []).slice(0, BAND_QUOTA[band]));
  }
  // Faixa vazia (um 0-4-0, por exemplo) deixa vagas: completa com quem ficou de fora,
  // sempre priorizando o miolo, para os dois times entrarem com o mesmo número.
  if (chosen.length < fieldPlayers) {
    const picked = new Set(chosen.map((entry) => entry.playerId));
    const spare = outfield
      .filter((entry) => !picked.has(entry.playerId))
      .sort((first, second) => centrality(first.slot) - centrality(second.slot)
        || first.slot.zone.column - second.slot.zone.column
        || first.slot.id.localeCompare(second.slot.id));
    chosen.push(...spare.slice(0, fieldPlayers - chosen.length));
  }

  return [goalkeeper, ...chosen.slice(0, fieldPlayers)];
};

const clone = <T>(value: T): T => structuredClone(value);

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

    selectStarters(side.plan).forEach((starter, lineupIndex) => {
      const profile = byId.get(starter.playerId)!;
      participants.push({
        team,
        lineupIndex,
        profile: clone(profile),
        memory: clone(world.memories[profile.id] ?? createMemory(profile)),
        shirtNumber: shirtByPlayer.get(profile.id) ?? lineupIndex + 1,
      });
    });
  }

  return {
    seed: seedOverride ?? world.settings.randomSeed,
    learningEnabled: world.settings.learningEnabled,
    participants,
  };
};

/** Encaixe de cada titular no slot em que foi escalado — insumo da penalidade de improviso. */
export const starterFits = (plan: TeamTacticalPlan, squad: PlayerProfile[]): Map<string, number> => {
  const byId = new Map(squad.map((player) => [player.id, player]));
  const fits = new Map<string, number>();
  for (const assignment of plan.assignments) {
    const slot = findSlot(assignment.slotId);
    const player = byId.get(assignment.playerId);
    if (!slot || !player) continue;
    fits.set(player.id, positionFit(player, slot).rating);
  }
  return fits;
};
