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
    expect(format({ id: 2, time: 600, type: "match-finished" })).toBe("Fim de partida");
  });

  it("formata ações com os nomes do elenco", () => {
    expect(format({ id: 2, time: 1, type: "save-made", team: "blue", playerId: "nilo-gk" })).toBe("Caio defendeu");
    expect(format({ id: 3, time: 2, type: "shot-taken", team: "coral", playerId: "maya-fw" })).toBe("Maya finalizou");
    expect(format({ id: 4, time: 3, type: "goal-scored", team: "blue", playerId: "nilo-fw", origin: "pass" })).toBe("Gol de Nilo (passe)");
  });

  it("usa o nome do clube quando o jogador não está no elenco informado", () => {
    expect(format({ id: 5, time: 4, type: "shot-taken", team: "coral", playerId: "desconhecido" })).toBe("MAY finalizou");
  });

  it("formata os três reinícios com o clube de cada lado", () => {
    expect(format({ id: 2, time: 1, type: "restart-awarded", team: "blue", restartKind: "throwIn" })).toBe("Lateral para NIL");
    expect(format({ id: 3, time: 2, type: "restart-awarded", team: "coral", restartKind: "corner" })).toBe("Escanteio para MAY");
    expect(format({ id: 4, time: 3, type: "restart-awarded", team: "blue", restartKind: "goalKick" })).toBe("Tiro de meta para NIL");
  });
});
