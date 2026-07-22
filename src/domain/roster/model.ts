import type { Team } from "../shared/model";

export type PlayerPosition = "goalkeeper" | "centerBack" | "fullBack" | "midfielder" | "forward";
export type PlayerRole = "finisher" | "playmaker" | "defender";

export interface PlayerSkills {
  acceleration: number;
  sprintSpeed: number;
  burst: number;
  stamina: number;
  control: number;
  passing: number;
  vision: number;
  finishing: number;
  defending: number;
  kickPower: number;
  goalkeeping: number;
}

export interface PlayerMentalAttributes {
  decisionMaking: number;
  anticipation: number;
  composure: number;
  aggression: number;
  teamwork: number;
  creativity: number;
  intensity: number;
  adaptability: number;
}

export interface PlayerProfile {
  id: string;
  name: string;
  number: number;
  position: PlayerPosition;
  role: PlayerRole;
  skills: PlayerSkills;
  mental: PlayerMentalAttributes;
}

export interface PlayerPolicy {
  shoot: number;
  pass: number;
  dribble: number;
  press: number;
  mark: number;
  cover: number;
}

export interface PlayerCareerStats {
  matches: number;
  goals: number;
  assists: number;
  completedPasses: number;
  failedPasses: number;
  interceptions: number;
  dribbles: number;
  shots: number;
}

export interface PlayerMemory {
  playerId: string;
  version: number;
  policy: PlayerPolicy;
  stats: PlayerCareerStats;
}

export interface Lineup {
  goalkeeperId: string;
  fieldPlayerIds: [string, string, string];
}

export interface GameProfile {
  players: PlayerProfile[];
  lineups: Record<Team, Lineup>;
  memories: Record<string, PlayerMemory>;
  settings: {
    learningEnabled: boolean;
    randomSeed: number;
  };
}
