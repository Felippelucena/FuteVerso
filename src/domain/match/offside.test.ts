import { describe, expect, it } from "vitest";
import { referenceMatchConfig, smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP, OFFSIDE } from "./config";
import { createMatchState, stepMatch } from "./index";
import type { MatchState, PlayerRuntime } from "./model";
import { executeBallAction } from "./systems/ball-system";
import { offsideLineProgress, offsideOffendersAtPass } from "./runtime/offside";
import { CALIBRATION } from "./__fixtures__/calibration";

const createState = (seed = 909) => createMatchState(smallSidedMatchConfig(seed));

/** Espalha todo mundo longe da bola, deixando o cenário limpo para montar uma jogada isolada. */
const clearField = (state: MatchState): void => {
  state.players.forEach((player, index) => { player.position = { x: 20 + index * 6, y: 6 }; });
};

const blue = (state: MatchState, position: PlayerRuntime["profile"]["position"]): PlayerRuntime =>
  state.players.find((player) => player.team === "blue" && player.profile.position === position)!;
const coral = (state: MatchState, position: PlayerRuntime["profile"]["position"]): PlayerRuntime =>
  state.players.find((player) => player.team === "coral" && player.profile.position === position)!;

describe("Lei 11 — geometria do impedimento", () => {
  it("põe a linha no penúltimo adversário", () => {
    const state = createState();
    clearField(state);
    // Coral defende à direita (gol em x=FIELD.width). Dois mais recuados: goleiro e um zagueiro.
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 30, y: FIELD.height / 2 };
    state.players.filter((p) => p.team === "coral" && p.profile.position !== "goalkeeper" && p.profile.position !== "centerBack")
      .forEach((p) => { p.position = { x: FIELD.width / 2, y: 6 }; });

    // Penúltimo (o zagueiro) está a 30 de distância do fundo → progresso (width-30)/width.
    const line = offsideLineProgress(state, "blue");
    expect(line).toBeCloseTo((FIELD.width - 30) / FIELD.width, 5);
  });

  it("não acusa quem está atrás da linha, nem quem está no próprio campo", () => {
    const state = createState();
    clearField(state);
    const passer = blue(state, "centerMid");
    const runner = blue(state, "striker");
    passer.position = { x: FIELD.width / 2 - 10, y: FIELD.height / 2 };
    state.ball.position = { ...passer.position };
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 40, y: FIELD.height / 2 };

    // Atrás da linha do zagueiro: onside.
    runner.position = { x: FIELD.width - 50, y: FIELD.height / 2 };
    expect(offsideOffendersAtPass(state, "blue", passer.profile.id).offenders).not.toContain(runner.profile.id);

    // No próprio campo (antes do meio): onside, ainda que "à frente" de tudo por acaso.
    runner.position = { x: FIELD.width / 2 - 5, y: FIELD.height / 2 };
    expect(offsideOffendersAtPass(state, "blue", passer.profile.id).offenders).not.toContain(runner.profile.id);
  });

  it("acusa quem está à frente da bola e da penúltima linha no campo de ataque", () => {
    const state = createState();
    clearField(state);
    const passer = blue(state, "centerMid");
    const runner = blue(state, "striker");
    passer.position = { x: FIELD.width / 2 - 10, y: FIELD.height / 2 };
    state.ball.position = { ...passer.position };
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 40, y: FIELD.height / 2 };
    // Além do zagueiro (mais perto do gol que ele): offside.
    runner.position = { x: FIELD.width - 30, y: FIELD.height / 2 };
    expect(offsideOffendersAtPass(state, "blue", passer.profile.id).offenders).toContain(runner.profile.id);
  });

  it("trata empatar com a linha como posição legal", () => {
    const state = createState();
    clearField(state);
    const passer = blue(state, "centerMid");
    const runner = blue(state, "striker");
    passer.position = { x: FIELD.width / 2 - 10, y: FIELD.height / 2 };
    state.ball.position = { ...passer.position };
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    const line = { x: FIELD.width - 40, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { ...line };
    runner.position = { ...line };
    expect(offsideOffendersAtPass(state, "blue", passer.profile.id).offenders).not.toContain(runner.profile.id);
  });
});

describe("Lei 11 — infração e reinício", () => {
  const armAndReceive = (seed: number) => {
    const state = createState(seed);
    startOpenPlay(state);
    clearField(state);
    const passer = blue(state, "centerMid");
    const runner = blue(state, "striker");
    // Deixa o alvo do passe realmente livre: goleiro e um zagueiro atrás, resto longe.
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 46, y: FIELD.height / 2 };
    state.players.filter((p) => p.team === "coral" && p.profile.position !== "goalkeeper" && p.profile.position !== "centerBack")
      .forEach((p, index) => { p.position = { x: 20, y: 8 + index * 9 }; });
    passer.position = { x: FIELD.width / 2 - 6, y: FIELD.height / 2 };
    passer.facing = { x: 1, y: 0 };
    // Corredor claramente impedido: bem à frente do zagueiro.
    runner.position = { x: FIELD.width - 30, y: FIELD.height / 2 };
    runner.facing = { x: 1, y: 0 };
    state.ball.controllerId = passer.profile.id;
    state.ball.position = { ...passer.position };
    state.ball.controlStartedAt = state.elapsed - 1;
    return { state, passer, runner };
  };

  it("arma a vigilância quando o passe sai com um companheiro impedido", () => {
    const { state, passer, runner } = armAndReceive(11);
    executeBallAction(state, passer, {
      kind: "pass", receiverId: runner.profile.id, target: { ...runner.position },
      trajectory: "ground", range: "long", targeting: "feet", power: 0.9,
    });
    expect(state.offsideWatch).toMatchObject({ team: "blue" });
    expect(state.offsideWatch?.offenders).toContain(runner.profile.id);
  });

  it("apita o impedimento quando o impedido recebe, e reinicia com tiro livre do adversário", () => {
    const { state, passer, runner } = armAndReceive(11);
    executeBallAction(state, passer, {
      kind: "pass", receiverId: runner.profile.id, target: { ...runner.position },
      trajectory: "ground", range: "long", targeting: "feet", power: 0.9,
    });

    for (let tick = 0; tick < 600 && !state.offsideCall; tick += 1) stepMatch(state, FIXED_STEP);
    expect(state.offsideCall).toMatchObject({ team: "blue", offenderId: runner.profile.id });
    expect(state.events.some((event) => event.type === "offside-called")).toBe(true);

    // Durante a bandeira a jogada fica congelada e a bola parada.
    const frozen = { ...state.ball.position };
    stepMatch(state, FIXED_STEP);
    expect(state.ball.position).toEqual(frozen);

    // Passada a janela, sai o tiro livre para o coral e o impedimento se resolve.
    for (let tick = 0; tick < OFFSIDE.freezeSeconds * 120 + 5 && state.offsideCall; tick += 1) stepMatch(state, FIXED_STEP);
    expect(state.offsideCall).toBeNull();
    expect(state.events.some((event) => event.type === "restart-awarded"
      && event.team === "coral" && event.restartKind === "freeKick")).toBe(true);
  });

  it("não apita quando um companheiro em posição legal recebe o passe", () => {
    const state = createState(11);
    startOpenPlay(state);
    clearField(state);
    const passer = blue(state, "centerMid");
    const onside = blue(state, "striker");
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 46, y: FIELD.height / 2 };
    passer.position = { x: FIELD.width / 2 - 6, y: FIELD.height / 2 };
    passer.facing = { x: 1, y: 0 };
    // Recebe atrás da linha: legal.
    onside.position = { x: FIELD.width - 60, y: FIELD.height / 2 };
    onside.facing = { x: 1, y: 0 };
    state.ball.controllerId = passer.profile.id;
    state.ball.position = { ...passer.position };
    state.ball.controlStartedAt = state.elapsed - 1;

    executeBallAction(state, passer, {
      kind: "pass", receiverId: onside.profile.id, target: { ...onside.position },
      trajectory: "ground", range: "long", targeting: "feet", power: 0.9,
    });
    expect(state.offsideWatch).toBeNull();

    for (let tick = 0; tick < 600 && !state.offsideCall && state.ball.controllerId !== onside.profile.id; tick += 1) {
      stepMatch(state, FIXED_STEP);
    }
    expect(state.offsideCall).toBeNull();
  });

  it("isenta a cobrança de escanteio, mas volta a valer no toque seguinte", () => {
    const state = createState(11);
    // Simula a chegada de um escanteio: o motor marca a isenção do próximo passe.
    state.offsideExemptRestart = true;
    startOpenPlay(state);
    clearField(state);
    const passer = blue(state, "centerMid");
    const runner = blue(state, "striker");
    coral(state, "goalkeeper").position = { x: FIELD.width - 6, y: FIELD.height / 2 };
    coral(state, "centerBack").position = { x: FIELD.width - 46, y: FIELD.height / 2 };
    passer.position = { x: FIELD.width / 2 - 6, y: FIELD.height / 2 };
    passer.facing = { x: 1, y: 0 };
    runner.position = { x: FIELD.width - 30, y: FIELD.height / 2 };
    state.ball.controllerId = passer.profile.id;
    state.ball.position = { ...passer.position };
    state.ball.controlStartedAt = state.elapsed - 1;

    // Primeiro passe (a cobrança): isento, não arma nada, e consome a isenção.
    executeBallAction(state, passer, {
      kind: "pass", receiverId: runner.profile.id, target: { ...runner.position },
      trajectory: "ground", range: "long", targeting: "feet", power: 0.9,
    });
    expect(state.offsideWatch).toBeNull();
    expect(state.offsideExemptRestart).toBe(false);
  });
});

describe("Lei 11 — numa partida inteira", () => {
  it.runIf(CALIBRATION)("marca ao menos um impedimento sem travar o jogo", () => {
    // Some sobre algumas partidas: o impedimento acontece de verdade, mas "de vez em quando" — o
    // resultado de uma única semente é ruído (uma partida pode não ter nenhum). O que importa é que
    // a Lei 11 apita ao longo do jogo sem travá-lo, e que toda partida chega ao fim.
    let offsides = 0;
    for (const seed of [2024, 2025, 2026]) {
      const state = createMatchState(referenceMatchConfig(seed));
      let hadCall = false;
      while (!state.finished) {
        stepMatch(state, FIXED_STEP);
        // Conta a borda: cada apito é um offsideCall que nasce (null → preenchido).
        if (state.offsideCall && !hadCall) offsides += 1;
        hadCall = state.offsideCall !== null;
      }
      expect(state.finished).toBe(true);
    }
    expect(offsides).toBeGreaterThan(0);
  }, 120_000);
});
