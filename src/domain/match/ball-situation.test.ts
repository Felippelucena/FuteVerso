import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { decideAll } from "./decision";
import { FIELD } from "./config";
import { createMatchState } from "./index";
import { readBallSituation, perceive } from "./runtime/ball-situation";
import type { MatchState, PlayerRuntime } from "./model";

const createTestMatch = (seed = 31) => createMatchState(smallSidedMatchConfig(seed));

/** Tira todo mundo do lance menos os nomeados: o cenário mede uma corrida, não uma multidão. */
const isolate = (state: MatchState, keep: PlayerRuntime[]): void => {
  state.players.forEach((player, index) => {
    if (keep.includes(player)) return;
    player.position = { x: FIELD.width * 0.5, y: FIELD.height + FIELD.height * 0.04 - index };
  });
};

describe("estado real da bola", () => {
  it("tira a bola adiantada do driblador quando o zagueiro chega antes", () => {
    const state = createTestMatch();
    startOpenPlay(state);
    const dribbler = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const defender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    isolate(state, [dribbler, defender]);
    // O pique: a bola já saiu do pé e corre à frente. O driblador vem atrás dela; o zagueiro
    // está goal-side, entre a bola e o próprio gol, e alcança o ponto de encontro antes.
    state.ball.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 };
    state.ball.velocity = { x: 26, y: 0 };
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = dribbler.profile.id;
    state.ball.dribbleStyle = "knockOn";
    state.ball.dribbleTouchRange = "medium";
    state.ball.dribbleStartedAt = state.elapsed;
    dribbler.position = { x: state.ball.position.x - 14, y: state.ball.position.y };
    defender.position = { x: state.ball.position.x + 16, y: state.ball.position.y };

    const situation = readBallSituation(state);

    // A bola não é mais dele por ter sido ele a tocá-la por último: é de quem chega nela.
    expect(situation.favourite?.playerId).toBe(defender.profile.id);
    expect(situation.favourite?.playerId).not.toBe(dribbler.profile.id);
  });

  it("manda o zagueiro investir na bola adiantada em vez de sustentar a posicao", () => {
    const state = createTestMatch(32);
    startOpenPlay(state);
    const dribbler = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const defender = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    isolate(state, [dribbler, defender]);
    state.ball.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 };
    state.ball.velocity = { x: 24, y: 0 };
    state.ball.controllerId = null;
    state.ball.dribbleOwnerId = dribbler.profile.id;
    state.ball.dribbleStyle = "knockOn";
    state.ball.dribbleStartedAt = state.elapsed;
    dribbler.position = { x: state.ball.position.x - 8, y: state.ball.position.y };
    // Perto da bola adiantada: a chance de dividida que o motor não enxergava, porque a "posse"
    // fazia a bola parecer colada no pé de quem a tinha empurrado.
    defender.position = { x: state.ball.position.x + 9, y: state.ball.position.y + 4 };

    perceive(state);

    const decision = decideAll(state).get(defender.profile.id)!;

    expect(decision.intent).toBe("pressing");
    expect(decision.burst).toBe(true);
  });

  it("passa a bola desviada para quem chega nela, e nao para quem o passe mirava", () => {
    const state = createTestMatch(33);
    startOpenPlay(state);
    const passer = state.players.find((p) => p.team === "blue" && p.profile.position === "centerMid")!;
    const receiver = state.players.find((p) => p.team === "blue" && p.profile.position === "striker")!;
    const rival = state.players.find((p) => p.team === "coral" && p.profile.position === "centerBack")!;
    isolate(state, [passer, receiver, rival]);
    const landing = { x: FIELD.width * 0.7, y: FIELD.height / 2 };
    passer.position = { x: FIELD.width * 0.4, y: FIELD.height / 2 };
    receiver.position = { ...landing };
    state.ball.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 };
    state.ball.controllerId = null;
    state.pendingPass = {
      id: 1, passerId: passer.profile.id, receiverId: receiver.profile.id, team: "blue",
      startedAt: state.elapsed - 0.2, trajectory: "ground", range: "long", targeting: "feet",
      selectionReason: "progressivePass", target: landing, landingPoint: landing,
      expectedArrivalAt: state.elapsed + 0.6, receiverEta: 0.5, opponentEta: 1.2,
    };

    // Rota original: vai para o destinatário, e ela é dele.
    state.ball.velocity = { x: 34, y: 0 };
    expect(readBallSituation(state).favourite?.playerId).toBe(receiver.profile.id);

    // O desvio: a bola sai da rota. Ninguém precisa reconhecer "desvio" nenhum — o ponto de
    // encontro mudou, e com ele quem chega primeiro.
    state.ball.velocity = { x: 4, y: -30 };
    rival.position = { x: state.ball.position.x + 6, y: state.ball.position.y - 20 };
    const afterDeflection = readBallSituation(state);

    expect(afterDeflection.favourite?.playerId).toBe(rival.profile.id);
    // E o destinatário para de se comportar como quem vai receber um passe que já não existe.
    perceive(state);
    expect(decideAll(state).get(receiver.profile.id)?.intent).not.toBe("supporting");
  });
});
