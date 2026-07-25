import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP, RESTART } from "./config";
import { createMatchState, stepMatch } from "./index";
import { beginRestart } from "./runtime/restart";
import type { MatchState, Team } from "./model";

const createState = (seed = 7) => createMatchState(smallSidedMatchConfig(seed));

const stepUntil = (state: MatchState, done: (state: MatchState) => boolean, seconds: number): void => {
  for (let tick = 0; tick < seconds * 120 && !done(state); tick += 1) stepMatch(state, FIXED_STEP);
};

/**
 * Manda a bola para bem longe pela linha lateral de baixo (com o último toque de `lastTouch`) e dá
 * um tick: o motor detecta a saída e arma o lateral. Longe o bastante para ninguém reclamar a bola
 * antes da detecção.
 */
const triggerThrowIn = (state: MatchState, lastTouch: Team = "coral"): void => {
  startOpenPlay(state);
  state.ball.controllerId = null;
  state.ball.dribbleOwnerId = null;
  state.pendingPass = null;
  state.ball.lastTouch = lastTouch;
  state.ball.lastTouchPlayerId = null;
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.height = 0;
  state.ball.position = { x: FIELD.width / 2, y: FIELD.height + 20 };
  stepMatch(state, FIXED_STEP);
};

/** Tempo (em segundos após `startedAt`) até o cobrador assumir a posse — a promoção da cobrança. */
const promotionDelay = (state: MatchState): number => {
  const takerId = state.restart!.takerId;
  const startedAt = state.restart!.startedAt;
  for (let tick = 0; tick < (RESTART.maxSetupSeconds + 1) * 120; tick += 1) {
    stepMatch(state, FIXED_STEP);
    if (state.ball.controllerId === takerId) return state.elapsed - startedAt;
  }
  return Number.POSITIVE_INFINITY;
};

describe("bola parada — cobrança caminhada", () => {
  it("arma o lateral para o time certo, com a bola parada no ponto", () => {
    const state = createState();
    triggerThrowIn(state, "coral");
    expect(state.restart).toMatchObject({ kind: "throwIn", team: "blue", ballInPlay: false });
    expect(state.ball.controllerId).toBeNull();
  });

  it("ninguém teleporta: o cobrador caminha até a linha e os demais se reposicionam", () => {
    const state = createState();
    triggerThrowIn(state);
    expect(state.restart?.kind).toBe("throwIn");

    const previous = new Map(state.players.map((player) => [player.profile.id, { ...player.position }]));
    let maxStep = 0;
    for (let tick = 0; tick < 800 && state.restart !== null; tick += 1) {
      stepMatch(state, FIXED_STEP);
      for (const player of state.players) {
        const before = previous.get(player.profile.id)!;
        maxStep = Math.max(maxStep, Math.hypot(player.position.x - before.x, player.position.y - before.y));
        previous.set(player.profile.id, { ...player.position });
      }
    }
    // Passo por tick de quem corre, nunca um salto à linha (o teleporte antigo era de dezenas de unidades).
    expect(maxStep).toBeGreaterThan(0);
    expect(maxStep).toBeLessThan(FIELD.width * 0.03);
  });

  it("mantém a bola parada no ponto, sem dono, até a cobrança", () => {
    const state = createState();
    triggerThrowIn(state);
    const spot = { ...state.restart!.spot };
    // Menos que o preparo mínimo: a bola fica parada o tempo todo.
    for (let tick = 0; tick < 200; tick += 1) {
      stepMatch(state, FIXED_STEP);
      if (state.restart && !state.restart.ballInPlay) {
        expect(state.ball.position).toEqual(spot);
        expect(state.ball.velocity).toEqual({ x: 0, y: 0 });
        expect(state.ball.controllerId).toBeNull();
      }
    }
  });

  it("entrega a posse ao cobrador e faz do primeiro toque um passe (Regra 8)", () => {
    const state = createState();
    triggerThrowIn(state);
    const takerId = state.restart!.takerId;

    stepUntil(state, (current) => current.restart?.ballInPlay === true, 8);

    expect(state.restart?.ballInPlay).toBe(true);
    expect(state.ball.lastTouchPlayerId).toBe(takerId);
    // Passe a caminho: a bola saiu do pé para um companheiro, nunca uma condução do próprio cobrador.
    expect(state.pendingPass?.passerId).toBe(takerId);
    expect(state.ball.dribbleOwnerId).toBeNull();
  });

  it("isenta a cobrança do lateral de impedimento e consome a isenção no passe", () => {
    const state = createState();
    triggerThrowIn(state);
    expect(state.offsideExemptRestart).toBe(true);

    stepUntil(state, (current) => current.restart?.ballInPlay === true, 8);

    expect(state.offsideExemptRestart).toBe(false);
    expect(state.offsideWatch).toBeNull();
  });

  it("a saída de bola só entra em jogo depois de os dois times voltarem ao próprio campo", () => {
    const state = createState();
    startOpenPlay(state);
    // Um atacante azul largado no campo adversário quando a saída é armada (como logo após um gol).
    const intruder = state.players.find(
      (player) => player.team === "blue" && player.profile.position !== "goalkeeper",
    )!;
    intruder.position = { x: FIELD.width * 0.7, y: FIELD.height / 2 };
    beginRestart(state, "kickoff", "coral", state.ball.position);

    const inOwnHalves = (s: MatchState): boolean => s.players.every((player) =>
      player.profile.position === "goalkeeper"
      || (player.team === "blue"
        ? player.position.x <= FIELD.width / 2 + player.radius
        : player.position.x >= FIELD.width / 2 - player.radius));

    let ownHalvesAt = -1;
    let liveAt = -1;
    for (let tick = 1; tick <= RESTART.maxSetupSeconds * 120 + 120 && liveAt < 0; tick += 1) {
      stepMatch(state, FIXED_STEP);
      if (ownHalvesAt < 0 && inOwnHalves(state)) ownHalvesAt = tick;
      if (state.ball.controllerId !== null) liveAt = tick;
    }
    expect(liveAt).toBeGreaterThan(0);
    expect(ownHalvesAt).toBeGreaterThan(0);
    // Não entrou em jogo antes de os dois times estarem cada um no seu campo.
    expect(liveAt).toBeGreaterThanOrEqual(ownHalvesAt);
    // E promoveu pela readiness (não pela trava de tempo): a espera foi do reposicionamento.
    expect(liveAt).toBeLessThan(RESTART.maxSetupSeconds * 120);
  });

  it("o cobrador do lateral CHEGA ao ponto e cobra — promove pela chegada, não pela trava de tempo", () => {
    const state = createState();
    triggerThrowIn(state);
    const delay = promotionDelay(state);
    // Promoveu perto do preparo mínimo (chegou caminhando), bem antes do teto anti-deadlock.
    expect(delay).toBeGreaterThanOrEqual(RESTART.minSetupSeconds - FIXED_STEP * 3);
    expect(delay).toBeLessThan(RESTART.maxSetupSeconds - 1);
  });

  it("o cobrador do escanteio CHEGA à quina e cobra — promove pela chegada, não pela trava de tempo", () => {
    const state = createState();
    startOpenPlay(state);
    // Um atacante azul já perto da quina de cima à direita, como o ponta que sobe para a cobrança.
    const winger = state.players.find((player) => player.team === "blue" && player.profile.position !== "goalkeeper")!;
    winger.position = { x: FIELD.width - 15, y: 12 };
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = null;
    state.pendingPass = null;
    state.ball.lastTouch = "coral";
    state.ball.lastTouchPlayerId = null;
    state.ball.velocity = { x: 0, y: 0 };
    state.ball.height = 0;
    state.ball.position = { x: FIELD.width + 20, y: 6 };
    stepMatch(state, FIXED_STEP);
    expect(state.restart?.kind).toBe("corner");
    expect(state.restart?.takerId).toBe(winger.profile.id);
    const delay = promotionDelay(state);
    expect(delay).toBeGreaterThanOrEqual(RESTART.minSetupSeconds - FIXED_STEP * 3);
    expect(delay).toBeLessThan(RESTART.maxSetupSeconds - 1);
  });

  it("cobra dentro do limite mesmo com o cobrador cercado longe (trava anti-deadlock)", () => {
    const state = createState();
    triggerThrowIn(state);
    const takerId = state.restart!.takerId;
    const startedAt = state.restart!.startedAt;
    const taker = state.players.find((player) => player.profile.id === takerId)!;
    // Canto oposto: sem tempo de caminhar até a bola, a cobrança sai pela colocação forçada.
    taker.position = { x: 4, y: 4 };

    stepUntil(state, (current) => current.ball.controllerId === takerId, RESTART.maxSetupSeconds + 1);

    expect(state.ball.controllerId).toBe(takerId);
    // Promoveu pela trava (perto do teto), não por ter chegado antes.
    expect(state.elapsed - startedAt).toBeGreaterThanOrEqual(RESTART.maxSetupSeconds - FIXED_STEP * 3);
    expect(state.elapsed - startedAt).toBeLessThanOrEqual(RESTART.maxSetupSeconds + FIXED_STEP * 3);
  });
});
