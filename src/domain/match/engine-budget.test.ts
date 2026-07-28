import { describe, expect, it } from "vitest";
import { CALIBRATION } from "./__fixtures__/calibration";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";

/**
 * Orçamento de custo do tick no formato do jogo (11x11).
 *
 * É o número que decide o que o motor consegue ser: a 137 µs/tick uma partida de 20 minutos custa
 * ~20 s sem tela, uma rodada de dez custa ~3 min e uma temporada de 380, ~2 h. Noventa minutos
 * reais nunca couberam — são 9,4 h de CPU por temporada —, e é por isso que a duração tem teto
 * (ver "Relógio comprimido" em docs/architecture.md). O teto aqui existe para uma regressão de
 * desempenho aparecer como falha, e não como "o jogo ficou pesado".
 *
 * Fica atrás de CALIBRATE=1 porque a medida depende da máquina: é régua de calibragem, como as
 * outras medidas de partida inteira, e não contrato de comportamento.
 */
const TICK_BUDGET_MICROSECONDS = 150;

/**
 * A medida é a PARTIDA INTEIRA, e não uma janela de jogo corrido: o tique de bola morta é bem mais
 * barato (o gate de falta/impedimento devolve cedo, a bola parada pula colisões), então uma janela
 * de vinte segundos mede ~193 µs onde a partida mede ~137. Quem manda na decisão de duração é a
 * média da partida, e é ela que este teto guarda.
 */
const measureMatch = (): { microsecondsPerTick: number; wallSeconds: number; ticks: number } => {
  const state = createMatchState(referenceMatchConfig());
  const started = performance.now();
  let ticks = 0;
  while (!state.finished) {
    stepMatch(state, FIXED_STEP);
    ticks += 1;
  }
  const wallSeconds = (performance.now() - started) / 1000;
  return { microsecondsPerTick: wallSeconds * 1_000_000 / ticks, wallSeconds, ticks };
};

describe("orcamento de custo do motor", () => {
  it.runIf(CALIBRATION)("mantem o tick do 11x11 dentro do teto", () => {
    const { microsecondsPerTick, wallSeconds, ticks } = measureMatch();
    console.info("ENGINE_BUDGET", JSON.stringify({
      microsecondsPerTick: Number(microsecondsPerTick.toFixed(1)),
      budget: TICK_BUDGET_MICROSECONDS,
      matchSeconds: Number(wallSeconds.toFixed(1)),
      realtimeRatio: Number((ticks * FIXED_STEP / wallSeconds).toFixed(1)),
    }));
    expect(microsecondsPerTick).toBeLessThanOrEqual(TICK_BUDGET_MICROSECONDS);
  }, 120_000);
});
