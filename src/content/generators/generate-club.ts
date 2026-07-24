import type { Club, ClubColors } from "../../domain/club/model";
import type { CountryCode } from "../../domain/shared/model";
import { autoPickPlan } from "../../domain/tactics/auto-lineup";
import { FORMATIONS } from "../../domain/tactics/formations";
import { NEUTRAL_MENTALITY, type TeamTacticalPlan } from "../../domain/tactics/model";
import { createEmptyPlan } from "../../domain/tactics/rules";
import { PRESS_TRIGGERS } from "../../domain/tactics/vocabulary";
import type { PlayerProfile } from "../../domain/roster/model";
import { clubNamePartsFor } from "../names";
import type { ContentRandom } from "./random";

// Paletas de uniforme. Cada entrada já traz a cor de texto legível sobre a dominante.
const PALETTES: readonly ClubColors[] = [
  { primary: "#1d4ed8", secondary: "#f8fafc", text: "#ffffff" },
  { primary: "#dc2626", secondary: "#111827", text: "#ffffff" },
  { primary: "#15803d", secondary: "#f8fafc", text: "#ffffff" },
  { primary: "#f8fafc", secondary: "#111827", text: "#111827" },
  { primary: "#111827", secondary: "#f8fafc", text: "#ffffff" },
  { primary: "#facc15", secondary: "#111827", text: "#111827" },
  { primary: "#7c3aed", secondary: "#f8fafc", text: "#ffffff" },
  { primary: "#0e7490", secondary: "#fef3c7", text: "#ffffff" },
  { primary: "#ea580c", secondary: "#111827", text: "#ffffff" },
  { primary: "#be123c", secondary: "#fef2f2", text: "#ffffff" },
  { primary: "#166534", secondary: "#facc15", text: "#ffffff" },
  { primary: "#1e293b", secondary: "#38bdf8", text: "#ffffff" },
];

const NICKNAME_PREFIXES = [
  "Os Tricolores", "O Timão", "A Máquina", "Os Alvinegros", "Os Coloradas",
  "O Furacão", "Os Leões", "Os Tubarões", "Os Guerreiros", "O Esquadrão",
];

const stripAccents = (value: string): string =>
  value.normalize("NFD").split("").filter((char) => {
    const code = char.charCodeAt(0);
    return code < 0x0300 || code > 0x036f;
  }).join("");

/** Sigla de três letras: iniciais quando dá, senão as primeiras letras da palavra principal. */
const buildShortName = (name: string, taken: Set<string>): string => {
  const words = stripAccents(name).toUpperCase().split(/\s+/).filter((word) => word.length > 1);
  const candidates: string[] = [];
  if (words.length >= 3) candidates.push(words.slice(0, 3).map((word) => word[0]).join(""));
  const main = words[words.length - 1] ?? "CLU";
  candidates.push(main.slice(0, 3));
  candidates.push((words[0] ?? main).slice(0, 3));
  for (const candidate of candidates) {
    const normalized = candidate.replace(/[^A-Z]/g, "").padEnd(3, "X").slice(0, 3);
    if (!taken.has(normalized)) {
      taken.add(normalized);
      return normalized;
    }
  }
  const base = (candidates[0] ?? "CLU").replace(/[^A-Z]/g, "").padEnd(3, "X").slice(0, 2);
  for (let suffix = 0; suffix < 26; suffix += 1) {
    const normalized = `${base}${String.fromCharCode(65 + suffix)}`;
    if (!taken.has(normalized)) {
      taken.add(normalized);
      return normalized;
    }
  }
  return "CLU";
};

export interface ClubGenerationOptions {
  nationality: CountryCode;
  /** 1 a 100: define força do elenco, formação preferida e riqueza do clube. */
  reputation: number;
  takenNames?: Set<string>;
  takenShortNames?: Set<string>;
}

const buildName = (random: ContentRandom, nationality: CountryCode, taken?: Set<string>): { name: string; city: string } => {
  const parts = clubNamePartsFor(nationality);
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const city = random.pick(parts.cities);
    const name = random.chance(0.55)
      ? `${random.pick(parts.prefixes)} ${city}`
      : `${city} ${random.pick(parts.suffixes)}`;
    if (!taken || !taken.has(name)) {
      taken?.add(name);
      return { name, city };
    }
  }
  const city = random.pick(parts.cities);
  const name = `${random.pick(parts.prefixes)} ${city} ${random.int(2, 99)}`;
  taken?.add(name);
  return { name, city };
};

/**
 * Mentalidade padrão coerente com a reputação: clube forte pressiona mais alto e arrisca
 * mais; clube pequeno recua e joga mais direto. Continua orbitando o neutro (50) porque o
 * comportamento emergente do motor é o ponto de partida, não o extremo.
 */
const buildMentality = (random: ContentRandom, reputation: number) => {
  const strength = (reputation - 50) / 50;
  const around = (base: number): number =>
    Math.max(5, Math.min(95, Math.round(base + random.gaussian(0, 7))));
  return {
    defensiveLine: around(NEUTRAL_MENTALITY.defensiveLine + strength * 16),
    pressing: around(NEUTRAL_MENTALITY.pressing + strength * 18),
    width: around(NEUTRAL_MENTALITY.width + strength * 8),
    tempo: around(NEUTRAL_MENTALITY.tempo + strength * 10),
    risk: around(NEUTRAL_MENTALITY.risk + strength * 12),
  };
};

export const generateClub = (
  random: ContentRandom,
  options: ClubGenerationOptions,
): Club => {
  const { nationality, reputation } = options;
  const { name, city } = buildName(random, nationality, options.takenNames);
  const plan: TeamTacticalPlan = {
    ...createEmptyPlan(),
    mentality: buildMentality(random, reputation),
    pressTriggers: random.chance(0.75)
      ? [...PRESS_TRIGGERS]
      : random.shuffle(PRESS_TRIGGERS).slice(0, random.int(2, 3)),
  };
  return {
    id: `club-${random.int(0, 0xffffff).toString(36)}${random.int(0, 0xffff).toString(36)}`,
    name,
    shortName: buildShortName(name, options.takenShortNames ?? new Set()),
    nickname: random.pick(NICKNAME_PREFIXES),
    nationality,
    city,
    colors: random.pick(PALETTES),
    founded: random.int(1900, 1995),
    reputation: Math.max(1, Math.min(100, Math.round(reputation))),
    defaultPlan: plan,
  };
};

/** Preenche o plano padrão do clube depois que o elenco existe. */
export const applyDefaultLineup = (random: ContentRandom, club: Club, squad: PlayerProfile[]): Club => ({
  ...club,
  defaultPlan: autoPickPlan(squad, random.pick(FORMATIONS), club.defaultPlan),
});
