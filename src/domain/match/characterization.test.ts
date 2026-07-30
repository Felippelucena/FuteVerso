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
    // Re-baseline por três mudanças medidas: (1) a latitude do apoio passou a vir da CÉLULA e não
    // do portador, e a fatia do quadro (`bodyShare`) virou por eixo — a largura que o motor PEDE
    // subiu de 40,2 m para 46,0 m, casando com as âncoras; (2) o canal de ataque ganhou histerese
    // (`TACTICS.channelHold`) — de 22,8 para 8,5 trocas por minuto, e o desvio lateral de cada
    // jogador até a própria âncora caiu de 9,2 m para 6,3 m; (3) o deslocamento por exclusividade
    // (`firstFreeCell`) passou a preferir a célula que o jogador já ocupava — de 10,1 para 9,1
    // trocas de faixa por jogador por minuto.
    expect(hashes).toEqual({ short: "feeb6a8e", long: "e961cb65" });
    // Timeout explícito: com 22 jogadores em campo a simulação custa ~2,4× o que custava no
    // 5x5, e o padrão de 5s estourava quando a suíte roda em paralelo.
  }, 60_000);
});
