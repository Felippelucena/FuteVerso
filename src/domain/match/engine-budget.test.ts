import { describe, expect, it } from "vitest";
import { BUDGET } from "./__fixtures__/calibration";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";

/**
 * Orçamento de custo do tick no formato do jogo (11x11).
 *
 * É o número que decide o que o motor consegue ser: a ~87 µs/tick uma partida de 20 minutos custa
 * ~13 s sem tela, uma rodada de dez custa ~2 min e uma temporada de 380, ~1,4 h. Noventa minutos
 * reais nunca couberam — são 6,1 h de CPU por temporada —, e é por isso que a duração tem teto
 * (ver "Relógio comprimido" em docs/architecture.md).
 *
 * **Isto é um instrumento, não uma guarda, e o teto reflete isso.** A medida é de relógio de
 * parede, e a máquina de desenvolvimento manda nela mais que o motor: a MESMA build mediu 87 µs
 * com o computador livre e 180 a 600 µs com o editor e o navegador abertos. Normalizar contra uma
 * carga de referência medida junto (tentado, e o código está no histórico) derruba o espalhamento
 * de 237% para 75% — ainda longe de separar uma regressão de 40% do barulho de fundo. Então o teto
 * aqui só pega catástrofe, e quem quer comparar de verdade roda com a máquina quieta e lê o número
 * impresso. Contar trabalho em vez de tempo seria a guarda de verdade, e custaria instrumentar o
 * motor com contadores que ele hoje não tem.
 *
 * Fica atrás do gate BUDGET=1 e **roda sozinha**: a suíte inteira em paralelo infla a medida.
 * Ver `__fixtures__/calibration`.
 */
const TICK_BUDGET_MICROSECONDS = 800;

/**
 * A medida é a PARTIDA INTEIRA, e não uma janela de jogo corrido: o tique de bola morta é bem mais
 * barato (o gate de falta/impedimento devolve cedo, a bola parada pula colisões), então uma janela
 * de vinte segundos mede ~193 µs onde a partida mede ~87. Quem manda na decisão de duração é a
 * média da partida, e é ela que este número descreve.
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
  it.runIf(BUDGET)("mantem o tick do 11x11 dentro do teto", () => {
    const { microsecondsPerTick, wallSeconds, ticks } = measureMatch();
    console.info("ENGINE_BUDGET", JSON.stringify({
      microsecondsPerTick: Number(microsecondsPerTick.toFixed(1)),
      budget: TICK_BUDGET_MICROSECONDS,
      matchSeconds: Number(wallSeconds.toFixed(1)),
      realtimeRatio: Number((ticks * FIXED_STEP / wallSeconds).toFixed(1)),
      referencia: "~87 µs/tick, ~96x tempo real, com a maquina quieta",
    }));
    expect(microsecondsPerTick).toBeLessThanOrEqual(TICK_BUDGET_MICROSECONDS);
  }, 180_000);
});
