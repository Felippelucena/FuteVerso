import { DEFAULT_MATCH_SEED } from "./config";
import type {
  AutoballSave,
  Lineup,
  PlayerMentalAttributes,
  PlayerMemory,
  PlayerProfile,
  PlayerSkills,
  Team,
} from "./model";
import { createInitialPolicy, createMentalAttributes } from "./personality";

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

const skills = (values: Partial<PlayerSkills>): PlayerSkills => ({
  acceleration: 65,
  sprintSpeed: 65,
  burst: 65,
  stamina: 70,
  control: 65,
  passing: 65,
  vision: 65,
  finishing: 60,
  defending: 60,
  kickPower: 65,
  goalkeeping: 20,
  ...values,
});

export const DEFAULT_PLAYERS: PlayerProfile[] = [
  { id: "nilo-gk", name: "Caio", number: 1, position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 84, defending: 74, passing: 62, vision: 67 }), mental: createMentalAttributes("disciplined", { composure: 88 }) },
  { id: "nilo-cb", name: "Bento", number: 4, position: "centerBack", role: "defender", skills: skills({ defending: 82, kickPower: 72, stamina: 77 }), mental: createMentalAttributes("intense", { teamwork: 80 }) },
  { id: "nilo-mid", name: "Iuri", number: 8, position: "midfielder", role: "playmaker", skills: skills({ passing: 84, vision: 86, control: 79, stamina: 80 }), mental: createMentalAttributes("cerebral") },
  { id: "nilo-fw", name: "Nilo", number: 7, position: "forward", role: "finisher", skills: skills({ acceleration: 84, sprintSpeed: 83, burst: 88, finishing: 82, control: 78 }), mental: createMentalAttributes("bold") },
  { id: "maya-gk", name: "Lia", number: 1, position: "goalkeeper", role: "defender", skills: skills({ goalkeeping: 86, defending: 72, passing: 68, vision: 70 }), mental: createMentalAttributes("cerebral", { creativity: 58 }) },
  { id: "maya-cb", name: "Cora", number: 3, position: "centerBack", role: "defender", skills: skills({ defending: 84, acceleration: 69, stamina: 78 }), mental: createMentalAttributes("disciplined") },
  { id: "maya-mid", name: "Tess", number: 6, position: "midfielder", role: "playmaker", skills: skills({ passing: 82, vision: 84, control: 84, acceleration: 72 }), mental: createMentalAttributes("creative") },
  { id: "maya-fw", name: "Maya", number: 10, position: "forward", role: "finisher", skills: skills({ finishing: 86, control: 86, passing: 70, burst: 76 }), mental: createMentalAttributes("creative", { composure: 84, aggression: 64 }) },
];

export const DEFAULT_LINEUPS: Record<Team, Lineup> = {
  blue: { goalkeeperId: "nilo-gk", fieldPlayerIds: ["nilo-cb", "nilo-mid", "nilo-fw"] },
  coral: { goalkeeperId: "maya-gk", fieldPlayerIds: ["maya-cb", "maya-mid", "maya-fw"] },
};

export const createDefaultSave = (): AutoballSave => ({
  schemaVersion: 2,
  players: DEFAULT_PLAYERS.map((player) => ({ ...player, skills: { ...player.skills }, mental: { ...player.mental } })),
  lineups: {
    blue: { ...DEFAULT_LINEUPS.blue, fieldPlayerIds: [...DEFAULT_LINEUPS.blue.fieldPlayerIds] },
    coral: { ...DEFAULT_LINEUPS.coral, fieldPlayerIds: [...DEFAULT_LINEUPS.coral.fieldPlayerIds] },
  },
  memories: Object.fromEntries(DEFAULT_PLAYERS.map((player) => [player.id, createMemory(player)])),
  settings: { learningEnabled: true, randomSeed: DEFAULT_MATCH_SEED },
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
  for (const team of ["blue", "coral"] as const) {
    const lineup = lineups[team];
    if (!lineup || lineup.fieldPlayerIds.length !== 3) return false;
    const goalkeeper = profiles.get(lineup.goalkeeperId);
    if (!goalkeeper || goalkeeper.position !== "goalkeeper") return false;
    if (lineup.fieldPlayerIds.some((id) => profiles.get(id)?.position === "goalkeeper" || !profiles.has(id))) return false;
    allIds.push(lineup.goalkeeperId, ...lineup.fieldPlayerIds);
  }
  return new Set(allIds).size === 8;
};
