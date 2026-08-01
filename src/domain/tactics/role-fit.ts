import { clamp } from "../shared/math";
import type { PlayerProfile } from "../roster/model";
import { positionFit } from "./position-fit";
import type { TacticalSlot } from "./slots";
import type { AptitudeWeights, TacticalRole } from "./roles";

/**
 * **Aptidão do atleta para uma função** — o "quão bom ele é nisto" que o FM mostra em estrelas e o EA
 * FC em `++`. Sai inteiramente dos atributos que já existem: nenhum campo novo no jogador.
 *
 * É o que substitui o antigo `PlayerRole` (finisher/playmaker/defender), e a diferença é o ponto da
 * reforma: aquele campo *decidia* como o atleta jogava; este apenas *mede* se ele serve ao que o
 * treinador pediu. Quem decide passou a ser o plano.
 *
 * Espelha `positionFit` de propósito — mesmo formato (nível + multiplicador), mesmo consumo pelo
 * editor e pelo motor —, e as duas se combinam: não adianta ser um finalizador excelente escalado de
 * lateral.
 */
export type RoleFitLevel = "natural" | "accomplished" | "capable" | "awkward" | "unsuited";

export interface RoleFit {
  level: RoleFitLevel;
  /** 0..1 — a média ponderada dos atributos que a função pede, na escala do atributo (0-100). */
  rating: number;
}

const LEVEL_THRESHOLD: readonly { level: RoleFitLevel; from: number }[] = [
  { level: "natural", from: 0.78 },
  { level: "accomplished", from: 0.68 },
  { level: "capable", from: 0.56 },
  { level: "awkward", from: 0.44 },
  { level: "unsuited", from: 0 },
];

/**
 * A nota bruta: média dos atributos pedidos, ponderada pelos pesos da função. Normaliza pela soma dos
 * pesos, e é por isso que o catálogo pode escrever pesos em números redondos (6, 4, 2) sem que ninguém
 * precise fazê-los somar 1 à mão — um peso a mais numa função não muda a escala das outras.
 */
const weightedAverage = (profile: PlayerProfile, weights: AptitudeWeights): number => {
  let total = 0;
  let sum = 0;
  for (const [key, weight] of Object.entries(weights) as [keyof AptitudeWeights, number][]) {
    const value = key in profile.skills
      ? profile.skills[key as keyof PlayerProfile["skills"]]
      : profile.mental[key as keyof PlayerProfile["mental"]];
    total += weight;
    sum += value * weight;
  }
  return total > 0 ? clamp(sum / total / 100, 0, 1) : 0;
};

export const roleFit = (profile: PlayerProfile, role: TacticalRole): RoleFit => {
  const rating = weightedAverage(profile, role.aptitude);
  const level = LEVEL_THRESHOLD.find((entry) => rating >= entry.from)?.level ?? "unsuited";
  return { level, rating };
};

/**
 * As funções que servem a este slot, da mais para a menos apta a este atleta. É o que a tela mostra
 * ao lado do seletor, e o que responde "quem eu ponho aqui?" sem o treinador decorar o catálogo.
 */
export const rolesForSlot = (
  profile: PlayerProfile,
  slot: TacticalSlot,
  roles: readonly TacticalRole[],
): { role: TacticalRole; fit: RoleFit }[] => roles
  .filter((role) => role.positions.some((position) => slot.allowedPositions.includes(position)))
  .map((role) => ({ role, fit: roleFit(profile, role) }))
  .sort((first, second) => second.fit.rating - first.fit.rating);

/**
 * O multiplicador que o motor aplica: encaixe de posição × aptidão para a função. Um zagueiro
 * improvisado de ponta já pagava por estar fora de posição; agora paga também por não ser ponta.
 *
 * O piso não é zero fora de `blocked`: quem está mal escalado joga mal, não deixa de jogar — a mesma
 * regra que `positionFit` já aplica ao improviso.
 */
export const tacticalFit = (profile: PlayerProfile, slot: TacticalSlot, role: TacticalRole): number => {
  const position = positionFit(profile, slot);
  if (position.level === "blocked") return 0;
  return position.rating * clamp(0.7 + roleFit(profile, role).rating * 0.42, 0.7, 1);
};
