import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig } from "./__fixtures__/reference-match";
import { FIXED_STEP, HALF_DURATION, MATCH_DURATION, MATCH_HALVES, STOPPAGE } from "./config";
import { createMatchState } from "./index";
import type { MatchState, RestartState } from "./model";
import { accrueAddedTime, finishMatchIfNeeded, startNextHalfIfNeeded } from "./systems/lifecycle-system";

const createState = (seed = 3) => createMatchState(smallSidedMatchConfig(seed));

/** Uma bola parada (lateral) ainda a cobrar: bola morta para o `isBallDead`. */
const parkedRestart = (): RestartState => ({
  kind: "throwIn", reason: null, team: "blue", takerId: "any",
  spot: { x: 10, y: 0 }, takerStand: { x: 10, y: -3 }, facing: { x: 1, y: 1 }, startedAt: 0, ballInPlay: false,
});

/** Ataque vivo: bola rolando, o time X com a posse e ameaçando (finalThird/counterAttack). */
const liveAttack = (state: MatchState, team: "blue" | "coral" = "blue"): void => {
  state.restart = null;
  state.offsideCall = null;
  state.possessionTeam = team;
  state.ballControlTeam = team;
  state.tactics[team].phase = "counterAttack";
};

describe("acréscimos e fim com contexto", () => {
  it("acumula acréscimo só enquanto a bola está morta", () => {
    const state = createState();
    state.stoppage.accrued = 0;

    state.restart = parkedRestart();
    accrueAddedTime(state, FIXED_STEP);
    expect(state.stoppage.accrued).toBeCloseTo(FIXED_STEP * STOPPAGE.accrualFactor, 10);

    // Bola viva: não acumula.
    const frozen = state.stoppage.accrued;
    state.restart = null;
    state.offsideCall = null;
    accrueAddedTime(state, FIXED_STEP);
    expect(state.stoppage.accrued).toBe(frozen);
  });

  it("não encerra o jogo no tempo nominal enquanto um ataque está vivo", () => {
    const state = createState();
    state.half = MATCH_HALVES;
    state.elapsed = MATCH_DURATION;
    state.stoppage.accrued = 0;
    liveAttack(state, "blue");

    finishMatchIfNeeded(state);

    expect(state.finished).toBe(false);
    // A placa de acréscimos subiu, mas o apito espera o fim do lance.
    expect(state.stoppage.awaitingEnd).toBe(true);
  });

  it("encerra na próxima bola morta depois de esgotado o tempo", () => {
    const state = createState();
    state.half = MATCH_HALVES;
    state.elapsed = MATCH_DURATION;
    state.stoppage.accrued = 0;
    liveAttack(state, "blue");
    finishMatchIfNeeded(state);
    expect(state.finished).toBe(false);

    // A bola sai: bola morta libera o apito.
    state.restart = parkedRestart();
    finishMatchIfNeeded(state);
    expect(state.finished).toBe(true);
    expect((state.events[0] as { type: string }).type).toBe("match-finished");
  });

  it("encerra quando a defesa recupera a posse (o ataque se desfez), sem bola morta", () => {
    const state = createState();
    state.half = MATCH_HALVES;
    state.elapsed = MATCH_DURATION;
    state.stoppage.accrued = 0;
    liveAttack(state, "blue");
    finishMatchIfNeeded(state);
    expect(state.finished).toBe(false);

    // A defesa recupera com clareza: o lance do time que atacava se desfez.
    state.possessionTeam = "coral";
    state.ballControlTeam = "coral";
    finishMatchIfNeeded(state);
    expect(state.finished).toBe(true);
  });

  it("respeita o teto absoluto: encerra mesmo com o ataque insistindo", () => {
    const state = createState();
    state.half = MATCH_HALVES;
    state.elapsed = MATCH_DURATION + STOPPAGE.graceCeiling;
    state.stoppage.accrued = 999; // muito além do teto anunciado
    liveAttack(state, "blue");

    finishMatchIfNeeded(state);

    expect(state.finished).toBe(true);
    expect(state.stoppage.announced).toBe(STOPPAGE.maxAddedTime);
  });

  it("anuncia o acréscimo uma única vez, limitado ao teto", () => {
    const state = createState();
    state.half = MATCH_HALVES;
    state.elapsed = MATCH_DURATION + 12;
    state.stoppage.accrued = 12;
    liveAttack(state, "blue");
    state.events = [];

    finishMatchIfNeeded(state);
    const signals = () => state.events.filter((event) => event.type === "added-time-signalled");
    expect(state.stoppage.awaitingEnd).toBe(true);
    expect(signals()[0]).toMatchObject({ type: "added-time-signalled", seconds: 12, final: true });

    // Reavaliar não re-anuncia.
    finishMatchIfNeeded(state);
    expect(signals()).toHaveLength(1);
  });

  it("no fim do 1º tempo espera o lance concluir e reseta o acréscimo na virada", () => {
    const state = createState();
    state.half = 1;
    state.elapsed = HALF_DURATION;
    state.stoppage.accrued = 0;
    liveAttack(state, "blue");

    startNextHalfIfNeeded(state);
    expect(state.half).toBe(1);
    expect(state.stoppage.awaitingEnd).toBe(true);

    // Bola morta: vira o tempo, com a saída do outro time e o acréscimo zerado.
    state.restart = parkedRestart();
    startNextHalfIfNeeded(state);
    expect(state.half).toBe(2);
    expect(state.stoppage.accrued).toBe(0);
    expect(state.stoppage.awaitingEnd).toBe(false);
    expect(state.restart?.kind).toBe("kickoff");
  });
});
