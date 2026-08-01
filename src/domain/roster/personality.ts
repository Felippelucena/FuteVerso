import { clamp } from "../shared/math";
import type { PlayerMentalAttributes, PlayerPolicy, PlayerProfile } from "./model";

export type MentalPreset = "balanced" | "cerebral" | "bold" | "intense" | "disciplined" | "creative";

export const MENTAL_PRESETS: Record<MentalPreset, PlayerMentalAttributes> = {
  balanced: { decisionMaking: 65, anticipation: 65, composure: 65, aggression: 65, teamwork: 65, creativity: 65, intensity: 65, adaptability: 65 },
  cerebral: { decisionMaking: 86, anticipation: 84, composure: 82, aggression: 45, teamwork: 82, creativity: 66, intensity: 68, adaptability: 78 },
  bold: { decisionMaking: 68, anticipation: 72, composure: 70, aggression: 78, teamwork: 60, creativity: 88, intensity: 76, adaptability: 72 },
  intense: { decisionMaking: 64, anticipation: 72, composure: 58, aggression: 90, teamwork: 72, creativity: 55, intensity: 92, adaptability: 80 },
  disciplined: { decisionMaking: 82, anticipation: 80, composure: 86, aggression: 58, teamwork: 88, creativity: 52, intensity: 78, adaptability: 65 },
  creative: { decisionMaking: 78, anticipation: 82, composure: 76, aggression: 48, teamwork: 79, creativity: 92, intensity: 70, adaptability: 85 },
};

export const MENTAL_PRESET_LABELS: Record<MentalPreset, string> = {
  balanced: "Equilibrado",
  cerebral: "Cerebral",
  bold: "Ousado",
  intense: "Intenso",
  disciplined: "Disciplinado",
  creative: "Criativo",
};

export const createMentalAttributes = (
  preset: MentalPreset = "balanced",
  overrides: Partial<PlayerMentalAttributes> = {},
): PlayerMentalAttributes => ({ ...MENTAL_PRESETS[preset], ...overrides });

/**
 * A propensão inicial de cada saída, **derivada das habilidades**.
 *
 * Antes vinha de `PlayerRole` — finisher/playmaker/defender, três rótulos de nascença que davam
 * `shoot: 0,78` a um e `0,48` a todos os outros. Aquilo era, na prática, uma função tática escondida
 * no atleta: quem decidia como o jogador jogava era um enum, não o treinador nem os atributos. A
 * função virou escolha do plano (`domain/tactics/roles`), e o que sobra aqui é o que sempre deveria
 * ter sido: quem finaliza bem chuta mais, quem passa e enxerga bem passa mais, quem defende bem
 * pressiona e marca mais.
 *
 * A escala é a mesma de antes (0,48 a 0,82 nas pontas) para o elenco não mudar de temperamento junto
 * com a reforma — só a origem do número mudou.
 */
const skillPolicy = (skills: PlayerProfile["skills"]): PlayerPolicy => {
  const from = (value: number, low: number, high: number): number => low + (high - low) * clamp(value / 100, 0, 1);
  const creator = (skills.passing + skills.vision) / 2;
  return {
    shoot: from(skills.finishing, 0.4, 0.82),
    pass: from(creator, 0.5, 0.84),
    dribble: from(skills.control, 0.44, 0.72),
    press: from(skills.defending, 0.54, 0.78),
    mark: from(skills.defending, 0.5, 0.84),
    cover: from(skills.defending, 0.52, 0.82),
  };
};

const centered = (value: number): number => (value - 65) / 100;

export const createInitialPolicy = (profile: Pick<PlayerProfile, "skills" | "mental">): PlayerPolicy => {
  const base = skillPolicy(profile.skills);
  const mental = profile.mental;
  return {
    shoot: clamp(base.shoot + centered(mental.aggression) * 0.2 + centered(mental.composure) * 0.14 + centered(mental.creativity) * 0.1, 0.1, 0.95),
    pass: clamp(base.pass + centered(mental.teamwork) * 0.22 + centered(mental.decisionMaking) * 0.16, 0.1, 0.95),
    dribble: clamp(base.dribble + centered(mental.creativity) * 0.28 + centered(mental.aggression) * 0.08, 0.1, 0.95),
    press: clamp(base.press + centered(mental.aggression) * 0.24 + centered(mental.intensity) * 0.24, 0.1, 0.95),
    mark: clamp(base.mark + centered(mental.teamwork) * 0.2 + centered(mental.anticipation) * 0.18, 0.1, 0.95),
    cover: clamp(base.cover + centered(mental.teamwork) * 0.22 + centered(mental.decisionMaking) * 0.16, 0.1, 0.95),
  };
};

export const policyLearningBounds = (
  profile: Pick<PlayerProfile, "skills" | "mental">,
  key: keyof PlayerPolicy,
): { minimum: number; maximum: number } => {
  const baseline = createInitialPolicy(profile)[key];
  const range = 0.3 * (0.45 + profile.mental.adaptability / 100 * 0.55);
  return { minimum: Math.max(0.1, baseline - range), maximum: Math.min(0.95, baseline + range) };
};

const MENTAL_LABELS: Record<keyof PlayerMentalAttributes, string> = {
  decisionMaking: "Decisão",
  anticipation: "Antecipação",
  composure: "Compostura",
  aggression: "Agressividade",
  teamwork: "Coletivo",
  creativity: "Criatividade",
  intensity: "Intensidade",
  adaptability: "Adaptabilidade",
};

export const dominantMentalTraits = (mental: PlayerMentalAttributes): string[] =>
  (Object.entries(mental) as [keyof PlayerMentalAttributes, number][])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([key]) => MENTAL_LABELS[key]);
