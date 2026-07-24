import type { PlayerPosition, PlayerProfile, PlayerSkills } from "./model";

type SkillWeights = Partial<Record<keyof PlayerSkills, number>>;

// Peso de cada atributo na nota geral, por posição. Serve para ordenar elencos, sugerir
// escalação e mostrar a força de um clube — o motor nunca lê estes números: ele usa os
// atributos brutos. Mudar um peso muda listas e sugestões, jamais a simulação.
const WEIGHTS: Record<PlayerPosition, SkillWeights> = {
  goalkeeper: { goalkeeping: 6, defending: 1.4, control: 0.8, passing: 0.8, kickPower: 0.6, acceleration: 0.4 },
  centerBack: { defending: 4, kickPower: 1.2, control: 1, passing: 1.2, sprintSpeed: 1.2, stamina: 1, acceleration: 1 },
  rightBack: { defending: 2.6, sprintSpeed: 2, stamina: 2, acceleration: 1.8, passing: 1.4, control: 1.2, vision: 0.8 },
  leftBack: { defending: 2.6, sprintSpeed: 2, stamina: 2, acceleration: 1.8, passing: 1.4, control: 1.2, vision: 0.8 },
  defensiveMid: { defending: 3, passing: 2.2, stamina: 2, vision: 1.6, control: 1.4, kickPower: 0.8 },
  centerMid: { passing: 2.8, vision: 2.6, control: 2.2, stamina: 1.8, defending: 1.4, finishing: 0.8 },
  rightMid: { passing: 2, vision: 1.8, control: 2, sprintSpeed: 1.8, stamina: 1.8, acceleration: 1.6, defending: 1 },
  leftMid: { passing: 2, vision: 1.8, control: 2, sprintSpeed: 1.8, stamina: 1.8, acceleration: 1.6, defending: 1 },
  attackingMid: { vision: 2.8, passing: 2.4, control: 2.6, finishing: 1.8, acceleration: 1.2, burst: 1 },
  rightWing: { acceleration: 2.4, sprintSpeed: 2.4, burst: 2, control: 2.2, finishing: 1.6, passing: 1.2 },
  leftWing: { acceleration: 2.4, sprintSpeed: 2.4, burst: 2, control: 2.2, finishing: 1.6, passing: 1.2 },
  striker: { finishing: 4, control: 2, burst: 1.8, acceleration: 1.6, kickPower: 1.4, sprintSpeed: 1.2 },
};

export const playerOverall = (profile: Pick<PlayerProfile, "position" | "skills">): number => {
  const weights = WEIGHTS[profile.position];
  let total = 0;
  let divisor = 0;
  for (const [skill, weight] of Object.entries(weights) as [keyof PlayerSkills, number][]) {
    total += profile.skills[skill] * weight;
    divisor += weight;
  }
  return divisor > 0 ? Math.round(total / divisor) : 0;
};
