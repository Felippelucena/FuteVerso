import type { Lineup, PlayerProfile } from "../../domain/roster/model";
import type { Team } from "../../domain/shared/model";
import { CURRENT_SAVE_SCHEMA_VERSION } from "./save-schema";

type SaveMigration = (document: Record<string, unknown>) => Record<string, unknown>;

// Tamanho de linha do formato atual (5x5 = goleiro + 4). Quando houver seleção de modo
// (11x11, etc.), este alvo deixa de ser fixo — ver Lineup em domain/roster/model.
const TARGET_FIELD_PLAYERS = 4;

const TEAMS: readonly Team[] = ["blue", "coral"];

// Volante genérico sintetizado quando um save antigo não tem reserva no banco para completar
// a escalação. Atributos medianos com pendor defensivo/coletivo — só existe para o save não
// ficar incompleto; o jogador pode editá-lo depois na tela de elenco.
const makeReserveMidfielder = (team: Team, index: number): PlayerProfile => ({
  id: `${team}-reserve-${index}`,
  name: "Meia reserva",
  number: 15 + index,
  position: "midfielder",
  role: "defender",
  skills: {
    acceleration: 64, sprintSpeed: 64, burst: 62, stamina: 80, control: 68,
    passing: 72, vision: 70, finishing: 55, defending: 72, kickPower: 66, goalkeeping: 18,
  },
  mental: {
    decisionMaking: 70, anticipation: 70, composure: 68, aggression: 62,
    teamwork: 78, creativity: 58, intensity: 74, adaptability: 68,
  },
});

// v2 (4x4: 3 jogadores de linha) → v3 (5x5: 4 jogadores de linha). Completa cada escalação
// preservando quem já estava nela: primeiro puxa reservas do próprio elenco (não escalados),
// e só sintetiza um volante se não houver ninguém no banco. As memórias dos novos jogadores
// são preenchidas depois, em decodeSaveDocument.
const migrateV2toV3: SaveMigration = (document) => {
  const players = Array.isArray(document.players) ? (document.players as PlayerProfile[]) : [];
  const lineups = document.lineups as Partial<Record<Team, Lineup>> | undefined;
  if (lineups) {
    const usedIds = new Set<string>();
    for (const team of TEAMS) {
      const lineup = lineups[team];
      if (lineup?.goalkeeperId) usedIds.add(lineup.goalkeeperId);
      for (const id of lineup?.fieldPlayerIds ?? []) usedIds.add(id);
    }
    let reserveIndex = 0;
    for (const team of TEAMS) {
      const lineup = lineups[team];
      if (!lineup || !Array.isArray(lineup.fieldPlayerIds)) continue;
      while (lineup.fieldPlayerIds.length < TARGET_FIELD_PLAYERS) {
        const bench = players.find((player) => player.position !== "goalkeeper" && !usedIds.has(player.id));
        let id: string;
        if (bench) {
          id = bench.id;
        } else {
          let candidate = makeReserveMidfielder(team, reserveIndex);
          reserveIndex += 1;
          while (players.some((player) => player.id === candidate.id) || usedIds.has(candidate.id)) {
            candidate = makeReserveMidfielder(team, reserveIndex);
            reserveIndex += 1;
          }
          players.push(candidate);
          id = candidate.id;
        }
        usedIds.add(id);
        lineup.fieldPlayerIds.push(id);
      }
    }
  }
  document.players = players;
  document.schemaVersion = 3;
  return document;
};

// New schema migrations are registered under the version they migrate from.
export const SAVE_MIGRATIONS: Readonly<Partial<Record<number, SaveMigration>>> = {
  2: migrateV2toV3,
};

export const migrateSaveDocument = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  let document = value as Record<string, unknown>;
  let version = Number(document.schemaVersion);
  while (Number.isInteger(version) && version >= 2 && version < CURRENT_SAVE_SCHEMA_VERSION) {
    const migration = SAVE_MIGRATIONS[version];
    if (!migration) return null;
    document = migration(document);
    version = Number(document.schemaVersion);
  }
  return document;
};
