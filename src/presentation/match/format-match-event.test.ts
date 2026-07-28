import { describe, expect, it } from "vitest";
import { REFERENCE_PLAYERS } from "../../domain/match/__fixtures__/reference-match";
import type { MatchEvent } from "../../domain/match/model";
import type { TeamNames } from "../app/labels";
import { formatMatchEvent } from "./format-match-event";

const TEAM_NAMES: TeamNames = { blue: "NIL", coral: "MAY" };

const format = (event: MatchEvent) => formatMatchEvent(event, REFERENCE_PLAYERS, TEAM_NAMES);

describe("formatMatchEvent", () => {
  it("formata o ciclo da partida", () => {
    expect(format({ id: 1, time: 0, type: "match-started" })).toBe("Partida iniciada");
    expect(format({ id: 2, time: 600, type: "match-finished", addedTime: 0 })).toBe("Fim de partida");
    expect(format({ id: 3, time: 622, type: "match-finished", addedTime: 22 })).toBe("Fim de partida (+00:22)");
    expect(format({ id: 4, time: 305, type: "half-ended", half: 1, addedTime: 5 })).toBe("Fim do 1º tempo (+00:05)");
  });

  it("formata a placa de acréscimos", () => {
    expect(format({ id: 5, time: 300, type: "added-time-signalled", half: 1, seconds: 22, final: false })).toBe("Acréscimos: +00:22");
    expect(format({ id: 6, time: 600, type: "added-time-signalled", half: 2, seconds: 18, final: true })).toBe("Acréscimos finais: +00:18");
  });

  it("formata ações com os nomes do elenco", () => {
    expect(format({ id: 2, time: 1, type: "save-made", team: "blue", playerId: "nilo-gk" })).toBe("Caio defendeu");
    expect(format({ id: 3, time: 2, type: "shot-taken", team: "coral", playerId: "maya-fw" })).toBe("Maya finalizou");
    expect(format({ id: 4, time: 3, type: "goal-scored", team: "blue", playerId: "nilo-fw", origin: "pass" })).toBe("Gol de Nilo (passe)");
  });

  it("usa o nome do clube quando o jogador não está no elenco informado", () => {
    expect(format({ id: 5, time: 4, type: "shot-taken", team: "coral", playerId: "desconhecido" })).toBe("MAY finalizou");
  });

  it("formata os quatro reinícios com o clube de cada lado", () => {
    expect(format({ id: 2, time: 1, type: "restart-awarded", team: "blue", restartKind: "throwIn" })).toBe("Lateral para NIL");
    expect(format({ id: 3, time: 2, type: "restart-awarded", team: "coral", restartKind: "corner" })).toBe("Escanteio para MAY");
    expect(format({ id: 4, time: 3, type: "restart-awarded", team: "blue", restartKind: "goalKick" })).toBe("Tiro de meta para NIL");
    expect(format({ id: 5, time: 4, type: "restart-awarded", team: "coral", restartKind: "freeKick" })).toBe("Tiro livre para MAY");
  });

  it("formata o impedimento com o nome do infrator", () => {
    const geometry = { lineProgress: 0.7, passAt: 4 };
    expect(format({ id: 6, time: 5, type: "offside-called", team: "blue", playerId: "nilo-fw", ...geometry })).toBe("Impedimento de Nilo");
    expect(format({ id: 7, time: 6, type: "offside-called", team: "coral", playerId: "desconhecido", ...geometry })).toBe("Impedimento de MAY");
  });
});
