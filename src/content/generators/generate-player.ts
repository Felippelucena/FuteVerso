import type { PlayerMentalAttributes, PlayerPosition, PlayerProfile, PlayerSkills } from "../../domain/roster/model";
import { createMentalAttributes, MENTAL_PRESETS, type MentalPreset } from "../../domain/roster/personality";
import type { CountryCode } from "../../domain/shared/model";
import { nameCatalogFor } from "../names";
import type { ContentRandom } from "./random";

/**
 * Deslocamento de cada atributo em relação à qualidade-alvo do jogador. Um atacante de
 * qualidade 75 nasce com finalização perto de 83 e marcação perto de 50 — é o que dá
 * identidade a cada posição em vez de gerar jogadores medianos em tudo.
 */
const ARCHETYPES: Record<PlayerPosition, Partial<Record<keyof PlayerSkills, number>>> = {
  goalkeeper: { goalkeeping: 10, defending: -6, finishing: -40, control: -14, strength: 4, passing: -8, vision: -8, acceleration: -12, sprintSpeed: -12, burst: -14, kickPower: -4, stamina: -10 },
  centerBack: { defending: 10, strength: 10, kickPower: 2, stamina: 0, finishing: -22, vision: -8, control: -8, acceleration: -8, sprintSpeed: -5, burst: -8, goalkeeping: -50 },
  rightBack: { defending: 3, stamina: 8, sprintSpeed: 7, acceleration: 6, passing: 0, strength: -3, finishing: -18, vision: -4, kickPower: -3, goalkeeping: -50 },
  leftBack: { defending: 3, stamina: 8, sprintSpeed: 7, acceleration: 6, passing: 0, strength: -3, finishing: -18, vision: -4, kickPower: -3, goalkeeping: -50 },
  defensiveMid: { defending: 8, stamina: 8, strength: 5, passing: 4, vision: 2, finishing: -14, burst: -6, acceleration: -4, goalkeeping: -50 },
  centerMid: { passing: 8, vision: 8, control: 5, stamina: 6, defending: -2, finishing: -8, goalkeeping: -50 },
  rightMid: { stamina: 9, sprintSpeed: 6, acceleration: 5, passing: 4, control: 3, defending: -4, strength: -4, finishing: -8, goalkeeping: -50 },
  leftMid: { stamina: 9, sprintSpeed: 6, acceleration: 5, passing: 4, control: 3, defending: -4, strength: -4, finishing: -8, goalkeeping: -50 },
  attackingMid: { vision: 10, control: 8, passing: 7, finishing: 2, defending: -20, strength: -8, stamina: -3, goalkeeping: -50 },
  rightWing: { acceleration: 10, sprintSpeed: 10, burst: 9, control: 6, finishing: 2, defending: -24, strength: -10, goalkeeping: -50 },
  leftWing: { acceleration: 10, sprintSpeed: 10, burst: 9, control: 6, finishing: 2, defending: -24, strength: -10, goalkeeping: -50 },
  striker: { finishing: 11, control: 5, burst: 6, strength: 7, kickPower: 4, acceleration: 3, defending: -26, passing: -8, vision: -6, stamina: -4, goalkeeping: -50 },
};

/**
 * Personalidades típicas por posição — enviesadas, não determinísticas.
 *
 * Eram duas tabelas: posição → função (`PlayerRole`) → personalidade. A função saiu do atleta e virou
 * escolha do treinador, e com ela saiu a indireção: o que a primeira tabela de fato codificava era
 * "onde ele joga sugere que tipo de gente ele é", que é o que sobrou escrito aqui, direto.
 */
const DEFENSIVE_MINDS: [MentalPreset, number][] = [["disciplined", 0.38], ["intense", 0.3], ["balanced", 0.2], ["cerebral", 0.12]];
const CREATOR_MINDS: [MentalPreset, number][] = [["cerebral", 0.34], ["creative", 0.3], ["balanced", 0.22], ["disciplined", 0.14]];
const ATTACKING_MINDS: [MentalPreset, number][] = [["bold", 0.36], ["creative", 0.28], ["intense", 0.2], ["balanced", 0.16]];

const PRESET_WEIGHTS: Record<PlayerPosition, [MentalPreset, number][]> = {
  goalkeeper: DEFENSIVE_MINDS,
  centerBack: DEFENSIVE_MINDS,
  rightBack: DEFENSIVE_MINDS,
  leftBack: DEFENSIVE_MINDS,
  defensiveMid: DEFENSIVE_MINDS,
  centerMid: CREATOR_MINDS,
  rightMid: CREATOR_MINDS,
  leftMid: CREATOR_MINDS,
  attackingMid: CREATOR_MINDS,
  rightWing: ATTACKING_MINDS,
  leftWing: ATTACKING_MINDS,
  striker: ATTACKING_MINDS,
};

// Posições secundárias plausíveis: vizinhas na linha ou no corredor.
const NEIGHBOURS: Record<PlayerPosition, PlayerPosition[]> = {
  goalkeeper: [],
  centerBack: ["defensiveMid", "rightBack", "leftBack"],
  rightBack: ["rightMid", "centerBack", "rightWing"],
  leftBack: ["leftMid", "centerBack", "leftWing"],
  defensiveMid: ["centerMid", "centerBack"],
  centerMid: ["defensiveMid", "attackingMid", "rightMid", "leftMid"],
  rightMid: ["rightWing", "centerMid", "rightBack"],
  leftMid: ["leftWing", "centerMid", "leftBack"],
  attackingMid: ["centerMid", "striker", "leftWing", "rightWing"],
  rightWing: ["rightMid", "striker", "attackingMid"],
  leftWing: ["leftMid", "striker", "attackingMid"],
  striker: ["attackingMid", "rightWing", "leftWing"],
};

const SKILL_KEYS: (keyof PlayerSkills)[] = [
  "acceleration", "sprintSpeed", "burst", "stamina", "control", "strength", "passing",
  "vision", "finishing", "defending", "kickPower", "goalkeeping",
];

const MENTAL_KEYS: (keyof PlayerMentalAttributes)[] = [
  "decisionMaking", "anticipation", "composure", "aggression",
  "teamwork", "creativity", "intensity", "adaptability",
];

const clampScore = (value: number): number => Math.max(1, Math.min(100, Math.round(value)));

const weightedPick = <T>(random: ContentRandom, entries: [T, number][]): T => {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = random.next() * total;
  for (const [value, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return value;
  }
  return entries[entries.length - 1][0];
};

export interface PlayerGenerationOptions {
  /** Ano corrente do mundo, usado para converter idade em ano de nascimento. */
  currentYear: number;
  nationality: CountryCode;
  position: PlayerPosition;
  /** Nota-alvo aproximada do jogador (1 a 100). Os atributos orbitam este valor. */
  quality: number;
  age?: number;
  /** Nomes já usados no contexto (elenco, catálogo) para evitar repetição. */
  usedNames?: Set<string>;
}

const generateName = (random: ContentRandom, nationality: CountryCode, usedNames?: Set<string>): string => {
  const catalog = nameCatalogFor(nationality);
  for (let attempt = 0; attempt < 24; attempt += 1) {
    const first = random.pick(catalog.firstNames);
    // Nome curto é comum no futebol brasileiro; nas primeiras tentativas ele é permitido,
    // depois o gerador insiste no nome completo para escapar da colisão.
    const name = attempt < 8 && random.chance(0.3) ? first : `${first} ${random.pick(catalog.lastNames)}`;
    if (!usedNames || !usedNames.has(name)) {
      usedNames?.add(name);
      return name;
    }
  }
  const unique = `${random.pick(catalog.firstNames)} ${random.pick(catalog.lastNames)} ${random.int(2, 9)}`;
  usedNames?.add(unique);
  return unique;
};

const generateSkills = (random: ContentRandom, position: PlayerPosition, quality: number): PlayerSkills => {
  const archetype = ARCHETYPES[position];
  const skills = {} as PlayerSkills;
  for (const key of SKILL_KEYS) {
    skills[key] = clampScore(quality + (archetype[key] ?? -12) + random.gaussian(0, 4));
  }
  return skills;
};

const generateMental = (random: ContentRandom, position: PlayerPosition, quality: number): PlayerMentalAttributes => {
  const preset = weightedPick(random, PRESET_WEIGHTS[position]);
  const base = createMentalAttributes(preset);
  // Jogador melhor tende a decidir melhor, sem apagar o perfil do preset.
  const lift = (quality - 65) * 0.35;
  const mental = {} as PlayerMentalAttributes;
  for (const key of MENTAL_KEYS) {
    mental[key] = clampScore(base[key] + lift + random.gaussian(0, 5));
  }
  return mental;
};

const generateSecondaryPositions = (random: ContentRandom, position: PlayerPosition): PlayerPosition[] => {
  const neighbours = NEIGHBOURS[position];
  if (neighbours.length === 0 || random.chance(0.42)) return [];
  const count = random.chance(0.22) ? 2 : 1;
  return random.shuffle(neighbours).slice(0, Math.min(count, neighbours.length));
};

// Curva de idade: maioria entre 21 e 30, com cauda em jovens e veteranos.
const generateAge = (random: ContentRandom): number => {
  const roll = random.next();
  if (roll < 0.16) return random.int(17, 20);
  if (roll < 0.82) return random.int(21, 29);
  return random.int(30, 36);
};

export const generatePlayer = (
  random: ContentRandom,
  options: PlayerGenerationOptions,
): PlayerProfile => {
  const { currentYear, nationality, position, quality } = options;
  const age = options.age ?? generateAge(random);
  return {
    id: `player-${random.int(0, 0xffffff).toString(36)}${random.int(0, 0xffffff).toString(36)}`,
    name: generateName(random, nationality, options.usedNames),
    nationality,
    birthYear: currentYear - age,
    position,
    secondaryPositions: generateSecondaryPositions(random, position),
    skills: generateSkills(random, position, quality),
    mental: generateMental(random, position, quality),
  };
};

export const MENTAL_PRESET_KEYS = Object.keys(MENTAL_PRESETS) as MentalPreset[];
