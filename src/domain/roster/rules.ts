import type {
  PlayerMentalAttributes,
  PlayerMemory,
  PlayerPosition,
  PlayerProfile,
  PlayerSkills,
} from "./model";
import { createInitialPolicy } from "./personality";
import { PLAYER_POSITIONS } from "./positions";

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

// Faixa aceita para o ano de nascimento. Larga de propósito: o editor permite conteúdo
// histórico ou futuro, só barra valor absurdo vindo de save corrompido.
export const BIRTH_YEAR_RANGE = { minimum: 1900, maximum: 2100 } as const;

const isPosition = (value: unknown): value is PlayerPosition =>
  typeof value === "string" && (PLAYER_POSITIONS as readonly string[]).includes(value);

export const isValidProfile = (value: unknown): value is PlayerProfile => {
  if (!value || typeof value !== "object") return false;
  const profile = value as PlayerProfile;
  const roles = ["finisher", "playmaker", "defender"];
  return typeof profile.id === "string"
    && typeof profile.name === "string"
    && profile.name.trim().length > 0
    && typeof profile.nationality === "string"
    && profile.nationality.length === 2
    && Number.isInteger(profile.birthYear)
    && profile.birthYear >= BIRTH_YEAR_RANGE.minimum
    && profile.birthYear <= BIRTH_YEAR_RANGE.maximum
    && isPosition(profile.position)
    && Array.isArray(profile.secondaryPositions)
    && profile.secondaryPositions.every(isPosition)
    && !profile.secondaryPositions.includes(profile.position)
    && new Set(profile.secondaryPositions).size === profile.secondaryPositions.length
    // Goleiro não acumula posição de linha, e ninguém adota o gol como segunda posição:
    // a troca é bloqueada na escalação, não penalizada.
    && (profile.position === "goalkeeper" ? profile.secondaryPositions.length === 0 : !profile.secondaryPositions.includes("goalkeeper"))
    && roles.includes(profile.role)
    && (profile.position !== "goalkeeper" || profile.role === "defender")
    && !!profile.skills
    && skillKeys.every((key) => isScore(profile.skills[key]))
    && !!profile.mental
    && mentalKeys.every((key) => isScore(profile.mental[key]));
};

export const playerAge = (profile: PlayerProfile, currentYear: number): number => currentYear - profile.birthYear;
