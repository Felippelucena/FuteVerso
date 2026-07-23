import { describe, expect, it } from "vitest";
import { createDefaultProfile } from "../../application/profile/create-default-profile";
import type { MatchEvent } from "../../domain/match/model";
import { formatMatchEvent } from "./format-match-event";

const format = (event: MatchEvent) => formatMatchEvent(event, createDefaultProfile().players);

describe("formatMatchEvent", () => {
  it("formata o ciclo da partida", () => {
    expect(format({ id: 1, time: 0, type: "match-started" })).toBe("Simulacao 5 x 5 iniciada");
    expect(format({ id: 2, time: 600, type: "match-finished" })).toBe("Fim de partida");
  });

  it("formata ações com os nomes do elenco", () => {
    expect(format({ id: 2, time: 1, type: "save-made", team: "blue", playerId: "nilo-gk" })).toBe("Caio defendeu");
    expect(format({ id: 3, time: 2, type: "shot-taken", team: "coral", playerId: "maya-fw" })).toBe("Maya finalizou");
    expect(format({ id: 4, time: 3, type: "goal-scored", team: "blue", playerId: "nilo-fw", origin: "pass" })).toBe("Gol de Nilo (passe)");
  });

  it("formata os três reinícios", () => {
    expect(format({ id: 2, time: 1, type: "restart-awarded", team: "blue", restartKind: "throwIn" })).toBe("Lateral para NILO");
    expect(format({ id: 3, time: 2, type: "restart-awarded", team: "coral", restartKind: "corner" })).toBe("Escanteio para MAYA");
    expect(format({ id: 4, time: 3, type: "restart-awarded", team: "blue", restartKind: "goalKick" })).toBe("Tiro de meta para NILO");
  });
});
