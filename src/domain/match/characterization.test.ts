import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { createMatchState, stepMatch } from "./index";
import type { MatchState } from "./model";

const round = (value: number): number => Number(value.toFixed(6));

const roundNumbers = (value: unknown): unknown => {
  if (typeof value === "number") return round(value);
  if (Array.isArray(value)) return value.map(roundNumbers);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, roundNumbers(item)]));
  }
  return value;
};

const hashFingerprint = (value: unknown): string => {
  const serialized = JSON.stringify(roundNumbers(value));
  let hash = 0x811c9dc5;
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

const fingerprint = (state: MatchState) => ({
  elapsed: round(state.elapsed),
  randomSeed: state.randomSeed,
  ball: {
    position: { x: round(state.ball.position.x), y: round(state.ball.position.y) },
    velocity: { x: round(state.ball.velocity.x), y: round(state.ball.velocity.y) },
    height: round(state.ball.height),
    verticalVelocity: round(state.ball.verticalVelocity),
    controllerId: state.ball.controllerId,
    lastTouchPlayerId: state.ball.lastTouchPlayerId,
  },
  players: state.players.map((player) => ({
    id: player.profile.id,
    position: { x: round(player.position.x), y: round(player.position.y) },
    velocity: { x: round(player.velocity.x), y: round(player.velocity.y) },
    stamina: round(player.stamina),
    sprintEnergy: round(player.sprintEnergy),
  })),
  stats: {
    blue: state.stats.blue,
    coral: state.stats.coral,
  },
});

const simulate = (seed: number, seconds: number) => {
  const state = createMatchState(referenceMatchConfig(seed));
  for (let tick = 0; tick < seconds * 120; tick += 1) stepMatch(state, 1 / 120);
  return fingerprint(state);
};

// Fingerprint: dispara a CADA mudança de trajetória do motor, por desenho. Fica na suíte padrão
// justamente porque o motor está em obra — é o alarme que separa "mudei de propósito" de "mudei
// sem perceber", e é o contrato de determinismo de que o rewind da MatchSession depende.
//
// Quando ele ficar vermelho: confira que a mudança era intencional, rode a bateria de calibragem
// (CALIBRATE=1) para ver o que mexeu nas métricas de partida inteira, e só então atualize os
// hashes — sempre num commit só do rebaseline, para o diff do baseline ser auditável.
describe("caracterizacao deterministica", () => {
  it("preserva o fingerprint de duas partidas", () => {
    const actual = {
      short: simulate(12_345, 15),
      long: simulate(98_765, 45),
    };
    const hashes = {
      short: hashFingerprint(actual.short),
      long: hashFingerprint(actual.long),
    };
    // Re-baseline da reforma do valor de posse, medida em `pass-calibration` (8 sementes) e em
    // `match-regime` (2 sementes, com o HEAD como controle):
    //
    // 1. O núcleo posicional do xG ganhou **alcance** e **pressão** (`positionalGoalChance`). Nenhum
    //    dos dois muda a tabela de `pitch-value` — lá o `max` do Bellman nunca escolhia o chute de
    //    50 m —, mas mudam tudo quando a mesma função é lida como "o que sobra de um palmo apertado".
    //    Sem a pressão, o motor creditava ao atacante marcado na área um chute livre que ele não tem,
    //    e conduzir prometia sempre o chute livre um passo à frente: 3,0 chutes por partida.
    // 2. A superfície ganhou o eixo de **disponibilidade** (`possessionValue`), que aposentou o
    //    `openness` do passe e o `dribbleSpace` da condução.
    // 3. A **condução passou a pagar risco** (`carrySurvival`) — era o único dos três verbos que não
    //    pagava, e por isso levar a bola até o gol saía de graça.
    // 4. **Função × dever** virou input do plano: a âncora, a ordem de avanço, o segundo pressionador
    //    e a cobertura garantida leem a função escolhida, não mais os três valores de `PlayerRole`.
    //
    // Efeito de partida: 42,5 → 7,0 chutes (o alvo comprimido é ~5,8), xG voltou a bater com os gols
    // (1,04 contra 1,5), terço final de 8,3% para 26,7%, `interceptedShare` 0,328 → 0,301.
    expect(hashes).toEqual({ short: "42eb302f", long: "14a09307" });
    // Timeout explícito: com 22 jogadores em campo a simulação custa ~2,4× o que custava no
    // 5x5, e o padrão de 5s estourava quando a suíte roda em paralelo.
  }, 60_000);
});
