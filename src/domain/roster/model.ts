import type { CountryCode } from "../shared/model";

// Doze posições cobrindo a grade tática. As siglas em português (GOL, ZAG, VOL, MEI, ATA...)
// ficam em presentation/app/labels.ts; o domínio usa identificadores em inglês como o resto
// do código. A linha e o lado natural de cada posição estão em positions.ts.
export type PlayerPosition =
  | "goalkeeper"
  | "centerBack" | "rightBack" | "leftBack"
  | "defensiveMid" | "centerMid" | "rightMid" | "leftMid" | "attackingMid"
  | "rightWing" | "leftWing" | "striker";

// A posição diz onde o jogador atua. **Como ele decide não mora mais aqui**: havia um campo `role`
// com três valores (finisher/playmaker/defender) que era, na prática, uma função tática escondida
// dentro do atleta — quem definia o comportamento era um enum de nascença, e não quem escala o time.
// Função e dever passaram a ser input do plano (`domain/tactics/roles`), e a aptidão do atleta para
// cada função sai dos atributos que já existem (`domain/tactics/role-fit`).

export interface PlayerSkills {
  acceleration: number;
  sprintSpeed: number;
  burst: number;
  stamina: number;
  control: number;
  /**
   * Força de corpo: proteger a bola, aguentar o ombro, ganhar a dividida no contato. É o físico
   * do duelo, distinto de `control` (a técnica) e de `kickPower` (a força do chute) — antes
   * `control` acumulava os dois papéis e um jogador não podia ser forte e ruim de bola.
   */
  strength: number;
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
