import type {
  Lineup,
  PlayerMentalAttributes,
  PlayerMemory,
  PlayerProfile,
  PlayerSkills,
} from "./model";
import type { Team } from "../shared/model";
import { createInitialPolicy } from "./personality";

export const createMemory = (profile: PlayerProfile): PlayerMemory => ({
  playerId: profile.id,
  version: 1,
  policy: createInitialPolicy(profile),
  stats: {
    matches: 0,
    goals: 0,
    assists: 0,
    completedPasses: 0,
    failedPasses: 0,
    interceptions: 0,
    dribbles: 0,
    shots: 0,
  },
});

const isScore = (value: unknown): value is number => Number.isFinite(value) && Number(value) >= 1 && Number(value) <= 100;
const skillKeys: (keyof PlayerSkills)[] = [
  "acceleration", "sprintSpeed", "burst", "stamina", "control", "passing",
  "vision", "finishing", "defending", "kickPower", "goalkeeping",
];
const mentalKeys: (keyof PlayerMentalAttributes)[] = [
  "decisionMaking", "anticipation", "composure", "aggression",
  "teamwork", "creativity", "intensity", "adaptability",
];

export const isValidProfile = (value: unknown): value is PlayerProfile => {
  if (!value || typeof value !== "object") return false;
  const profile = value as PlayerProfile;
  const positions = ["goalkeeper", "centerBack", "fullBack", "midfielder", "forward"];
  const roles = ["finisher", "playmaker", "defender"];
  return typeof profile.id === "string"
    && typeof profile.name === "string"
    && profile.name.trim().length > 0
    && Number.isInteger(profile.number)
    && profile.number >= 1
    && profile.number <= 99
    && positions.includes(profile.position)
    && roles.includes(profile.role)
    && (profile.position !== "goalkeeper" || profile.role === "defender")
    && !!profile.skills
    && skillKeys.every((key) => isScore(profile.skills[key]))
    && !!profile.mental
    && mentalKeys.every((key) => isScore(profile.mental[key]));
};

export const validateLineups = (players: PlayerProfile[], lineups: Record<Team, Lineup>): boolean => {
  const profiles = new Map(players.map((player) => [player.id, player]));
  const allIds: string[] = [];
  let fieldCount: number | null = null;
  for (const team of ["blue", "coral"] as const) {
    const lineup = lineups[team];
    if (!lineup || lineup.fieldPlayerIds.length < 1) return false;
    // Ambos os times precisam do mesmo número de jogadores de linha (4x4, 5x5, 11x11...).
    if (fieldCount === null) fieldCount = lineup.fieldPlayerIds.length;
    else if (lineup.fieldPlayerIds.length !== fieldCount) return false;
    const goalkeeper = profiles.get(lineup.goalkeeperId);
    if (!goalkeeper || goalkeeper.position !== "goalkeeper") return false;
    if (lineup.fieldPlayerIds.some((id) => profiles.get(id)?.position === "goalkeeper" || !profiles.has(id))) return false;
    allIds.push(lineup.goalkeeperId, ...lineup.fieldPlayerIds);
  }
  // Todos distintos: (goleiro + N de linha) por time, sem repetição entre as equipes.
  return new Set(allIds).size === (fieldCount! + 1) * 2;
};
