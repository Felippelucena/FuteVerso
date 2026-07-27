import type { PlayerRuntime } from "../model";

/**
 * Quem é quem no 1x1: `holder` protege a bola, `challenger` tenta tirá-la. São os dois únicos
 * papéis — ler uma finta e cravar um desarme pedem a mesma virtude (chegar no tempo certo), então
 * não há uma terceira fórmula para o marcador que enfrenta um driblador.
 */
export type DuelRole = "holder" | "challenger";

// Pesos somam 1,10 dos dois lados: os limiares e o ruído de `resolveContact` foram calibrados
// nesta escala, e a simetria é o que faz a margem (defensor − portador) valer zero entre iguais.
//
// A força de corpo entra dos dois lados, com o mesmo peso: proteger a bola e arrancá-la são a
// mesma disputa física vista de cada lado. Ela sai de `control`, que antes acumulava técnica e
// físico — o driblador leve segue driblando, mas agora perde o ombro para o zagueiro pesado.
const WEIGHTS = {
  holder: { control: 0.46, strength: 0.18, burst: 0.2, stamina: 0.16, composure: 0.1 },
  challenger: { defending: 0.42, strength: 0.18, acceleration: 0.2, control: 0.1, stamina: 0.1, aggression: 0.1 },
} as const;

/**
 * Força de duelo — a fonte única de "quem ganha um 1x1". Antes o motor tinha três fórmulas para
 * isto (contato, finta e a autoavaliação da IA) e elas discordavam: a da finta ignorava estamina e
 * cabeça, então um zagueiro exausto lia o drible tão bem quanto um inteiro.
 */
export const duelStrength = (player: PlayerRuntime, role: DuelRole): number => {
  const { skills, mental } = player.profile;
  if (role === "holder") {
    const weights = WEIGHTS.holder;
    return (skills.control * weights.control
      + skills.strength * weights.strength
      + skills.burst * weights.burst) / 100
      + player.stamina * weights.stamina
      + mental.composure / 100 * weights.composure;
  }
  const weights = WEIGHTS.challenger;
  return (skills.defending * weights.defending
    + skills.strength * weights.strength
    + skills.acceleration * weights.acceleration
    + skills.control * weights.control) / 100
    + player.stamina * weights.stamina
    + mental.aggression / 100 * weights.aggression;
};

/**
 * Vantagem do portador sobre um marcador concreto. É o que decide se vale tentar o drible: a
 * pergunta útil não é "sou bom?" em abstrato, e sim "sou melhor que este aqui?".
 */
export const duelEdge = (holder: PlayerRuntime, challenger: PlayerRuntime): number =>
  duelStrength(holder, "holder") - duelStrength(challenger, "challenger");
