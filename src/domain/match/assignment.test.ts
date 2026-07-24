import { describe, expect, it } from "vitest";
import { referenceMatchConfig } from "./__fixtures__/reference-match";
import { FIELD, FIXED_STEP } from "./config";
import { createMatchState, stepMatch } from "./index";
import { cellKey } from "./runtime/formation-geometry";
import { assignedAnchor, dutyHolders } from "./systems/assignment-system";
import { updateTacticalContext } from "./systems/tactics-system";
import { TEAM_SIZE } from "../tactics/model";
import { findSlot } from "../tactics/slots";
import type { MatchState, Team } from "./model";

const TEAMS = ["blue", "coral"] as const;

const createTestMatch = (seed = 4242) => {
  const state = createMatchState(referenceMatchConfig(seed));
  state.kickoffTimer = 0;
  state.elapsed = 20;
  return state;
};

const planOf = (state: MatchState, team: Team) => state.tactics[team].collectivePlan!;

/** Coloca a bola no pé de um meio-campista do time, para fixar quem está em posse. */
const givePossession = (state: MatchState, team: Team) => {
  const carrier = state.players.find((player) => player.team === team && player.profile.position === "centerMid")!;
  state.ball.position = { ...carrier.position };
  state.ball.velocity = { x: 0, y: 0 };
  state.ball.controllerId = carrier.profile.id;
  state.ball.lastTouch = team;
  state.ball.lastTouchPlayerId = carrier.profile.id;
  state.possessionTeam = team;
  state.ballControlTeam = team;
  return carrier;
};

const duplicatedCells = (state: MatchState, team: Team): string[] => {
  const seen = new Map<string, number>();
  for (const assignment of Object.values(planOf(state, team).assignments)) {
    const key = cellKey(assignment.zone);
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  return [...seen.entries()].filter(([, count]) => count > 1).map(([key]) => key);
};

const averageRow = (state: MatchState, team: Team): number => {
  const zones = Object.values(planOf(state, team).assignments).map((assignment) => assignment.zone.row);
  return zones.reduce((sum, row) => sum + row, 0) / zones.length;
};

describe("incumbências coletivas", () => {
  it("dá um dever a cada um dos onze, dos dois lados", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);

    for (const team of TEAMS) {
      const plan = planOf(state, team);
      const squad = state.players.filter((player) => player.team === team);
      expect(squad).toHaveLength(TEAM_SIZE);
      // Função total: nenhum jogador de linha sobra, nem em posse nem fora dela.
      for (const player of squad) expect(plan.assignments[player.profile.id]).toBeDefined();
      expect(Object.keys(plan.assignments)).toHaveLength(TEAM_SIZE);
    }
  });

  it("nunca coloca dois jogadores na mesma célula da grade", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);
    for (const team of TEAMS) expect(duplicatedCells(state, team)).toEqual([]);
  });

  it("mantém o goleiro no dever de goleiro", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);
    for (const team of TEAMS) {
      const keeper = state.players.find((player) => player.team === team && player.profile.position === "goalkeeper")!;
      expect(planOf(state, team).assignments[keeper.profile.id].duty).toBe("goalkeep");
    }
  });

  it("com a bola, escala corredores e retaguarda ao mesmo tempo", () => {
    const state = createTestMatch();
    const carrier = givePossession(state, "blue");
    state.tactics.blue.phase = "finalThird";
    state.tactics.blue.phaseStartedAt = state.elapsed;
    updateTacticalContext(state, 0);
    const plan = planOf(state, "blue");

    const runners = dutyHolders(plan, "runInBehind");
    const rest = dutyHolders(plan, "restDefense");
    expect(runners.length).toBeGreaterThanOrEqual(1);
    expect(rest.length).toBeGreaterThanOrEqual(1);
    expect(runners.filter((id) => rest.includes(id))).toEqual([]);
    expect(plan.assignments[carrier.profile.id].duty).toBe("carry");

    // Quem segura a retaguarda vive atrás de quem ataca as costas da linha.
    const column = (id: string) => plan.assignments[id].zone.column;
    expect(Math.max(...rest.map(column))).toBeLessThan(Math.min(...runners.map(column)));
  });

  it("defende em zona por padrão, sem ninguém perseguindo um número", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);
    const plan = planOf(state, "coral");

    // A instrução padrão é `zone`; ninguém deve sair marcando homem por conta própria.
    expect(dutyHolders(plan, "trackRunner")).toEqual([]);
    expect(dutyHolders(plan, "holdLine").length).toBeGreaterThan(0);
    expect(dutyHolders(plan, "press").length).toBeGreaterThanOrEqual(1);
  });

  it("passa a marcar homem quando o treinador pede, e só quem ele pediu", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    const marker = state.players.find((player) => player.team === "coral" && player.profile.position === "centerBack")!;
    marker.instruction = { ...marker.instruction, marking: "man" };
    updateTacticalContext(state, 0);
    const plan = planOf(state, "coral");

    expect(dutyHolders(plan, "trackRunner")).toEqual([marker.profile.id]);
    const assignment = plan.assignments[marker.profile.id];
    expect(assignment.targetPlayerId).not.toBeNull();
    const mark = state.players.find((player) => player.profile.id === assignment.targetPlayerId)!;
    expect(mark.team).toBe("blue");
    expect(mark.profile.position).not.toBe("goalkeeper");
  });

  it("desliza o bloco para o lado em que a bola está", () => {
    const nearLeft = createTestMatch();
    const carrier = givePossession(nearLeft, "blue");
    carrier.position = { x: FIELD.width * 0.5, y: FIELD.height * 0.15 };
    nearLeft.ball.position = { ...carrier.position };
    updateTacticalContext(nearLeft, 0);

    const nearRight = createTestMatch();
    const other = givePossession(nearRight, "blue");
    other.position = { x: FIELD.width * 0.5, y: FIELD.height * 0.85 };
    nearRight.ball.position = { ...other.position };
    updateTacticalContext(nearRight, 0);

    // O time sem a bola acompanha a bola como bloco: as células inteiras andam de lado.
    expect(averageRow(nearRight, "coral")).toBeGreaterThan(averageRow(nearLeft, "coral"));
  });

  it("sobe a linha do time com a bola adiantada e recua com ela no próprio campo", () => {
    const deep = createTestMatch();
    const carrierDeep = givePossession(deep, "blue");
    carrierDeep.position = { x: FIELD.width * 0.18, y: FIELD.height / 2 };
    deep.ball.position = { ...carrierDeep.position };
    updateTacticalContext(deep, 0);

    const high = createTestMatch();
    const carrierHigh = givePossession(high, "blue");
    carrierHigh.position = { x: FIELD.width * 0.82, y: FIELD.height / 2 };
    high.ball.position = { ...carrierHigh.position };
    updateTacticalContext(high, 0);

    expect(planOf(high, "blue").placement.lineHeight)
      .toBeGreaterThan(planOf(deep, "blue").placement.lineHeight + 20);
    // O time sem a bola faz o caminho contrário: recua quando a bola sobe contra ele.
    expect(planOf(high, "coral").placement.lineHeight)
      .toBeLessThan(planOf(deep, "coral").placement.lineHeight);
  });

  it("abre a formação com a bola e fecha o bloco sem ela", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);
    expect(planOf(state, "blue").placement.width).toBeGreaterThan(planOf(state, "coral").placement.width);
  });

  it("coloca os dois times na mesma região do campo, e não um em cada metade", () => {
    const state = createTestMatch();
    const carrier = givePossession(state, "blue");
    carrier.position = { x: FIELD.width * 0.62, y: FIELD.height / 2 };
    state.ball.position = { ...carrier.position };
    updateTacticalContext(state, 0);

    const spanOf = (team: Team): [number, number] => {
      const plan = planOf(state, team);
      const xs = state.players
        .filter((player) => player.team === team && player.profile.position !== "goalkeeper")
        .map((player) => assignedAnchor(plan, player).x);
      return [Math.min(...xs), Math.max(...xs)];
    };
    const [blueLow, blueHigh] = spanOf("blue");
    const [coralLow, coralHigh] = spanOf("coral");
    const intersection = Math.min(blueHigh, coralHigh) - Math.max(blueLow, coralLow);
    const union = Math.max(blueHigh, coralHigh) - Math.min(blueLow, coralLow);
    // As linhas têm que se interpenetrar: metade da área ocupada é compartilhada pelos dois.
    expect(intersection / union).toBeGreaterThan(0.5);
  });

  it("faz o apoio subir para o espaço que o corredor abriu", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    state.tactics.blue.phase = "finalThird";
    state.tactics.blue.phaseStartedAt = state.elapsed;
    updateTacticalContext(state, 0);
    const plan = planOf(state, "blue");

    expect(dutyHolders(plan, "runInBehind").length).toBeGreaterThan(0);
    const supports = dutyHolders(plan, "support");
    expect(supports.length).toBeGreaterThan(0);
    // Com companheiros atacando as costas da linha, o apoio não fica parado na célula da
    // escalação: ele sobe para a faixa entre as linhas que a corrida abriu.
    const climbers = supports.filter((id) => {
      const support = state.players.find((player) => player.profile.id === id)!;
      return plan.assignments[id].zone.column > findSlot(support.slotId)!.zone.column;
    });
    expect(climbers.length).toBeGreaterThan(0);
  });

  it("estica quem segura a amplitude para fora da forma", () => {
    const state = createTestMatch();
    givePossession(state, "blue");
    updateTacticalContext(state, 0);
    const plan = planOf(state, "blue");
    const wingerId = dutyHolders(plan, "width")[0];
    expect(wingerId).toBeDefined();

    const winger = state.players.find((player) => player.profile.id === wingerId)!;
    const assignment = plan.assignments[wingerId];
    expect(assignment.lateralPull).toBeGreaterThan(0);

    const stretched = Math.abs(assignedAnchor(plan, winger).y - FIELD.height / 2);
    assignment.lateralPull = 0;
    const flat = Math.abs(assignedAnchor(plan, winger).y - FIELD.height / 2);
    expect(stretched).toBeGreaterThan(flat);
  });

  it("sustenta as duas invariantes ao longo de uma partida de verdade", () => {
    const state = createTestMatch(9182);
    let samples = 0;
    for (let tick = 0; tick < 60 * 120; tick += 1) {
      stepMatch(state, FIXED_STEP);
      if (Math.abs(state.elapsed % 2) >= FIXED_STEP) continue;
      samples += 1;
      for (const team of TEAMS) {
        const plan = state.tactics[team].collectivePlan;
        if (!plan) continue;
        expect(Object.keys(plan.assignments)).toHaveLength(TEAM_SIZE);
        expect(duplicatedCells(state, team)).toEqual([]);
      }
    }
    expect(samples).toBeGreaterThan(20);
  }, 60_000);
});
