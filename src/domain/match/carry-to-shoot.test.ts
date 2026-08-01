import { describe, expect, it } from "vitest";
import { smallSidedMatchConfig, startOpenPlay } from "./__fixtures__/reference-match";
import { decideAll } from "./decision";
import { perceive } from "./runtime/ball-situation";
import { FIELD } from "./config";
import { createMatchState } from "./index";

/**
 * Conduzir rumo ao gol em vez de tabelar para trás, quando o corredor está aberto e o chute daqui não
 * existe.
 *
 * O comportamento sobreviveu à troca de régua, mas o mecanismo mudou e vale registrar: existia um
 * *lookahead* explícito (`CONDUCT.carryShot*`) que avaliava o chute futuro e creditava o ganho à
 * utilidade do drible. Ele morreu com a superfície de valor de posse — ela já paga por chegar mais
 * perto, sem precisar simular a finalização de lá. Um termo somado à mão a menos para envelhecer.
 */
describe("condução rumo ao gol", () => {
  it("prefere conduzir a tabelar para trás quando o corredor à frente está aberto", () => {
    const state = createMatchState(smallSidedMatchConfig(11));
    startOpenPlay(state);
    state.elapsed = 8;
    const carrier = state.players.find((p) => p.team === "coral" && p.profile.position === "centerMid")!;
    const outlet = state.players.find((p) => p.team === "coral" && p.profile.position === "striker")!;
    // coral ataca -x (gol em x=0); portador é a ponta de lança
    carrier.position = { x: FIELD.width * 0.28, y: FIELD.height / 2 };
    carrier.velocity = { x: -2, y: 0 };
    carrier.facing = { x: -1, y: 0 };
    carrier.profile.skills.control = 90;
    carrier.profile.skills.burst = 90;
    carrier.profile.skills.kickPower = 35; // chute direto de ~72u fica FORA de alcance (~69u)
    carrier.sprintEnergy = 1;
    carrier.memory.policy.dribble = 0.6;
    carrier.memory.policy.pass = 0.4;
    carrier.profile.mental.creativity = 75;
    outlet.position = { x: FIELD.width * 0.5, y: FIELD.height / 2 }; // atrás → passe recuado disponível
    // corredor à frente livre: azuis para fora da rota ao gol
    state.players.filter((p) => p.team === "blue").forEach((p, i) => {
      p.position = { x: FIELD.width * 0.12, y: i % 2 === 0 ? 8 : FIELD.height - 8 };
    });
    const keeper = state.players.find((p) => p.team === "blue" && p.profile.position === "goalkeeper")!;
    keeper.position = { x: FIELD.width * 0.05, y: FIELD.height / 2 };
    state.ball.position = { x: carrier.position.x - 1.6, y: carrier.position.y };
    state.ball.controllerId = carrier.profile.id;
    state.ball.controlStartedAt = state.elapsed - 1;
    state.ball.lastTouch = carrier.team;
    state.ball.lastTouchPlayerId = carrier.profile.id;

    perceive(state);

    const decision = decideAll(state).get(carrier.profile.id)!;
    expect(decision.ballAction.kind).toBe("dribble");
  });
});
