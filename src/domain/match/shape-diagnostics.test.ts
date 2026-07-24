import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";
import { assignedAnchor } from "./systems/assignment-system";
import type { MatchState, Team } from "./model";

/**
 * Diagnóstico de forma: mede se os dois times **se misturam** ou se ocupam metades separadas.
 *
 * No futebol as linhas se interpenetram — a última linha de um time convive com o ataque do
 * outro, e os meios se cruzam. Um modelo em que cada time vive na sua metade produz dois blocos
 * que se olham de longe, o que parece futebol de mesa e não futebol.
 *
 * Fica `it.skip` porque simula partidas inteiras; roda sob demanda trocando para `it`.
 */
const SEEDS = [12_345, 98_765, 2026];

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

const percent = (x: number): number => x / FIELD.width * 100;

const outfieldOf = (state: MatchState, team: Team) =>
  state.players.filter((player) => player.team === team && player.profile.position !== "goalkeeper");

const simulate = (seed: number) => {
  const state = createMatchState(referenceMatchConfig(seed));
  const samples: {
    blueSpan: [number, number];
    coralSpan: [number, number];
    overlap: number;
    opponentsInsideMySpan: number;
    ownDepth: number;
    anchorSpan: [number, number];
    goalSide: number | null;
    ballDepth: number;
  }[] = [];

  while (!state.finished) {
    stepMatch(state, FIXED_STEP);
    if (Math.abs(state.elapsed % 1) >= FIXED_STEP) continue;

    const spanOf = (team: Team): [number, number] => {
      const xs = outfieldOf(state, team).map((player) => percent(player.position.x));
      return [Math.min(...xs), Math.max(...xs)];
    };
    const blueSpan = spanOf("blue");
    const coralSpan = spanOf("coral");
    // Jaccard das duas faixas: 0 = blocos que não se tocam, 1 = times perfeitamente misturados.
    const intersection = Math.max(0, Math.min(blueSpan[1], coralSpan[1]) - Math.max(blueSpan[0], coralSpan[0]));
    const union = Math.max(blueSpan[1], coralSpan[1]) - Math.min(blueSpan[0], coralSpan[0]);

    const insideShare = (["blue", "coral"] as const).map((team) => {
      const [low, high] = team === "blue" ? blueSpan : coralSpan;
      const opponents = outfieldOf(state, team === "blue" ? "coral" : "blue");
      return opponents.filter((player) => percent(player.position.x) >= low && percent(player.position.x) <= high).length
        / Math.max(1, opponents.length);
    });

    // Onde as células atribuídas colocam o time — a estrutura, sem o efeito da bola.
    const anchors = outfieldOf(state, "blue")
      .map((player) => percent(assignedAnchor(state.tactics.blue.collectivePlan, player).x));

    // Quantos jogadores de linha o time SEM a bola tem entre a bola e o próprio gol. É a conta
    // que decide se dá para defender: no futebol, com a bola no próprio terço, são oito ou nove.
    const defending = state.possessionTeam === "blue" ? "coral" : state.possessionTeam === "coral" ? "blue" : null;
    const goalSide = defending === null ? null : (() => {
      const ballDepth = defending === "blue" ? state.ball.position.x : FIELD.width - state.ball.position.x;
      return outfieldOf(state, defending)
        .filter((player) => (defending === "blue" ? player.position.x : FIELD.width - player.position.x) < ballDepth)
        .length;
    })();

    samples.push({
      blueSpan,
      coralSpan,
      overlap: union > 0 ? intersection / union : 0,
      opponentsInsideMySpan: average(insideShare),
      ownDepth: average([blueSpan[1] - blueSpan[0], coralSpan[1] - coralSpan[0]]),
      anchorSpan: [Math.min(...anchors), Math.max(...anchors)],
      goalSide,
      ballDepth: defending === null
        ? 50
        : percent(defending === "blue" ? state.ball.position.x : FIELD.width - state.ball.position.x),
    });
  }

  return {
    sobreposicaoDasFaixas: average(samples.map((sample) => sample.overlap)),
    adversariosDentroDaMinhaFaixa: average(samples.map((sample) => sample.opponentsInsideMySpan)),
    profundidadeDoBloco: average(samples.map((sample) => sample.ownDepth)),
    faixaAzul: [average(samples.map((s) => s.blueSpan[0])), average(samples.map((s) => s.blueSpan[1]))] as const,
    faixaCoral: [average(samples.map((s) => s.coralSpan[0])), average(samples.map((s) => s.coralSpan[1]))] as const,
    faixaDasCelulas: [average(samples.map((s) => s.anchorSpan[0])), average(samples.map((s) => s.anchorSpan[1]))] as const,
    celulaMaisAvancada: Math.max(...samples.map((s) => s.anchorSpan[1])),
    defensoresAtrasDaBola: average(samples.filter((s) => s.goalSide !== null).map((s) => s.goalSide!)),
    // A mesma conta, só nos momentos em que a bola está no terço defensivo de quem defende.
    defensoresAtrasDaBolaNoProprioTerco: average(samples
      .filter((s) => s.goalSide !== null && s.ballDepth < 33)
      .map((s) => s.goalSide!)),
  };
};

const round = (value: number): number => Number(value.toFixed(1));

describe("diagnóstico de forma", () => {
  it.skip("mede se os dois times se misturam ou vivem em metades separadas", () => {
    const runs = SEEDS.map(simulate);
    const mean = (pick: (run: typeof runs[number]) => number) => round(average(runs.map(pick)));
    const meanPair = (pick: (run: typeof runs[number]) => readonly [number, number]) =>
      [round(average(runs.map((run) => pick(run)[0]))), round(average(runs.map((run) => pick(run)[1])))];

    const report = {
      sobreposicaoDasFaixas: mean((run) => run.sobreposicaoDasFaixas * 100),
      adversariosDentroDaMinhaFaixa: mean((run) => run.adversariosDentroDaMinhaFaixa * 100),
      profundidadeDoBloco: mean((run) => run.profundidadeDoBloco),
      faixaAzul: meanPair((run) => run.faixaAzul),
      faixaCoral: meanPair((run) => run.faixaCoral),
      faixaDasCelulas: meanPair((run) => run.faixaDasCelulas),
      celulaMaisAvancada: mean((run) => run.celulaMaisAvancada),
      defensoresAtrasDaBola: mean((run) => run.defensoresAtrasDaBola),
      defensoresAtrasDaBolaNoProprioTerco: mean((run) => run.defensoresAtrasDaBolaNoProprioTerco),
    };
    // eslint-disable-next-line no-console
    console.info("SHAPE_DIAGNOSTICS", JSON.stringify(report, null, 2));
    expect(report.sobreposicaoDasFaixas).toBeGreaterThan(0);
  }, 900_000);
});
