import type { CountryCode } from "../shared/model";

// Doze posições cobrindo a grade tática. As siglas em português (GOL, ZAG, VOL, MEI, ATA...)
// ficam em presentation/app/labels.ts; o domínio usa identificadores em inglês como o resto
// do código. A linha e o lado natural de cada posição estão em positions.ts.
export type PlayerPosition =
  | "goalkeeper"
  | "centerBack" | "rightBack" | "leftBack"
  | "defensiveMid" | "centerMid" | "rightMid" | "leftMid" | "attackingMid"
  | "rightWing" | "leftWing" | "striker";

// Posição diz onde o jogador atua; função diz como ele decide. Os dois eixos são
// independentes: um centerMid pode ser playmaker ou defender.
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
  nationality: CountryCode;
  birthYear: number;
  position: PlayerPosition;
  // Posições em que o jogador atua sem penalidade de improviso, além da principal.
  secondaryPositions: PlayerPosition[];
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
