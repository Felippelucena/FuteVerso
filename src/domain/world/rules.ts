import type { Club } from "../club/model";
import type { Contract } from "../contract/model";
import { contractsOfClub, squadOf } from "../contract/queries";
import type { PlayerProfile } from "../roster/model";
import { createMemory } from "../roster/rules";
import { autoPickPlan } from "../tactics/auto-lineup";
import { defaultFormation, findFormation } from "../tactics/formations";
import { TEAM_SIZE, type TeamTacticalPlan } from "../tactics/model";
import { positionFit } from "../tactics/position-fit";
import { findSlot } from "../tactics/slots";
import type { World } from "./model";

const clone = <T>(value: T): T => structuredClone(value);

/**
 * Reescreve o plano para caber no elenco atual: descarta titulares que saíram do clube ou
 * que caíram em slot bloqueado e recompõe o que faltar. Preserva quem continua válido, para
 * que vender um reserva não desmonte a escalação inteira.
 */
export const repairPlan = (plan: TeamTacticalPlan, squad: PlayerProfile[]): TeamTacticalPlan => {
  const byId = new Map(squad.map((player) => [player.id, player]));
  const seenSlots = new Set<string>();
  const seenPlayers = new Set<string>();
  const assignments = plan.assignments.filter((assignment) => {
    const slot = findSlot(assignment.slotId);
    const player = byId.get(assignment.playerId);
    if (!slot || !player) return false;
    if (seenSlots.has(slot.id) || seenPlayers.has(player.id)) return false;
    if (positionFit(player, slot).level === "blocked") return false;
    seenSlots.add(slot.id);
    seenPlayers.add(player.id);
    return true;
  });

  const bench = plan.bench.filter((playerId) => byId.has(playerId) && !seenPlayers.has(playerId));
  const kept: TeamTacticalPlan = { ...plan, assignments, bench: [...new Set(bench)] };
  if (assignments.length === TEAM_SIZE) return kept;

  // Faltou titular: completa a partir do preset guardado (ou do padrão), sem mexer em quem
  // já estava escalado.
  const formation = (plan.formationId ? findFormation(plan.formationId) : null) ?? defaultFormation();
  const openSlots = formation.slots.filter((slotId) => !seenSlots.has(slotId));
  const spare = squad.filter((player) => !seenPlayers.has(player.id));
  const filler = autoPickPlan(spare, { ...formation, slots: openSlots });
  return {
    ...kept,
    assignments: [...assignments, ...filler.assignments],
    bench: filler.bench,
  };
};

const repairClub = (club: Club, players: PlayerProfile[], contracts: Contract[]): Club => ({
  ...club,
  defaultPlan: repairPlan(club.defaultPlan, squadOf(players, contracts, club.id)),
});

/**
 * Devolve um mundo internamente coerente. Aplicado sempre que o mundo entra em memória —
 * seja vindo do banco, de um import ou do gerador — para que nenhuma tela precise lidar com
 * contrato órfão, camisa repetida ou escalação com jogador que não existe mais.
 */
export const repairWorld = (world: World): World => {
  const players = world.players.filter((player, index, all) => all.findIndex(({ id }) => id === player.id) === index);
  const playerIds = new Set(players.map((player) => player.id));
  const clubs = world.clubs.filter((club, index, all) => all.findIndex(({ id }) => id === club.id) === index);
  const clubIds = new Set(clubs.map((club) => club.id));

  const claimedPlayers = new Set<string>();
  const takenShirts = new Map<string, Set<number>>();
  const contracts: Contract[] = [];
  for (const contract of world.contracts) {
    if (!playerIds.has(contract.playerId) || !clubIds.has(contract.clubId)) continue;
    if (contract.status === "expired") {
      contracts.push(contract);
      continue;
    }
    // Um jogador só defende um clube por vez; o primeiro vínculo encontrado prevalece.
    if (claimedPlayers.has(contract.playerId)) continue;
    claimedPlayers.add(contract.playerId);
    const shirts = takenShirts.get(contract.clubId) ?? new Set<number>();
    let shirtNumber = contract.shirtNumber;
    while (shirts.has(shirtNumber) && shirtNumber < 99) shirtNumber += 1;
    shirts.add(shirtNumber);
    takenShirts.set(contract.clubId, shirts);
    contracts.push(shirtNumber === contract.shirtNumber ? contract : { ...contract, shirtNumber });
  }

  const memories = Object.fromEntries(players.map((player) => [
    player.id,
    world.memories[player.id] ?? createMemory(player),
  ]));

  return {
    players,
    clubs: clubs.map((club) => repairClub(club, players, contracts)),
    contracts,
    memories,
    settings: { ...world.settings },
  };
};

export type WorldIssueKind =
  | "duplicate-player"
  | "duplicate-club"
  | "duplicate-contract"
  | "orphan-contract"
  | "duplicate-shirt"
  | "missing-memory"
  | "incomplete-squad";

export interface WorldIssue {
  kind: WorldIssueKind;
  playerId?: string;
  clubId?: string;
}

/** Diagnóstico sem efeito colateral — usado por testes e pela tela de manutenção do editor. */
export const inspectWorld = (world: World): WorldIssue[] => {
  const issues: WorldIssue[] = [];
  const seenPlayers = new Set<string>();
  for (const player of world.players) {
    if (seenPlayers.has(player.id)) issues.push({ kind: "duplicate-player", playerId: player.id });
    seenPlayers.add(player.id);
    if (!world.memories[player.id]) issues.push({ kind: "missing-memory", playerId: player.id });
  }

  const seenClubs = new Set<string>();
  for (const club of world.clubs) {
    if (seenClubs.has(club.id)) issues.push({ kind: "duplicate-club", clubId: club.id });
    seenClubs.add(club.id);
    if (squadOf(world.players, world.contracts, club.id).length < TEAM_SIZE) {
      issues.push({ kind: "incomplete-squad", clubId: club.id });
    }
    const shirts = new Set<number>();
    for (const contract of contractsOfClub(world.contracts, club.id)) {
      if (shirts.has(contract.shirtNumber)) issues.push({ kind: "duplicate-shirt", clubId: club.id, playerId: contract.playerId });
      shirts.add(contract.shirtNumber);
    }
  }

  const engaged = new Set<string>();
  for (const contract of world.contracts) {
    if (!seenPlayers.has(contract.playerId) || !seenClubs.has(contract.clubId)) {
      issues.push({ kind: "orphan-contract", playerId: contract.playerId, clubId: contract.clubId });
      continue;
    }
    if (contract.status === "expired") continue;
    if (engaged.has(contract.playerId)) issues.push({ kind: "duplicate-contract", playerId: contract.playerId });
    engaged.add(contract.playerId);
  }

  return issues;
};

export const cloneWorld = (world: World): World => clone(world);
