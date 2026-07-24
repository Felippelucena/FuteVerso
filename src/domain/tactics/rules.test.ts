import { describe, expect, it } from "vitest";
import { createTestWorld } from "../../application/__fixtures__/test-world";
import { squadOf } from "../contract/queries";
import type { PlayerProfile } from "../roster/model";
import type { World } from "../world/model";
import { autoPickPlan } from "./auto-lineup";
import { defaultFormation, findFormation } from "./formations";
import { TEAM_SIZE, type TeamTacticalPlan } from "./model";
import { createEmptyPlan, inspectPlan, isValidPlan, orderedAssignments, slotOfPlayer } from "./rules";
import { findSlot, GOALKEEPER_SLOT_ID } from "./slots";

const world: World = createTestWorld();
const squad: PlayerProfile[] = squadOf(world.players, world.contracts, world.clubs[0].id);
const basePlan = (): TeamTacticalPlan => structuredClone(world.clubs[0].defaultPlan);

describe("inspectPlan", () => {
  it("aprova o plano padrão gerado para o clube", () => {
    expect(inspectPlan(basePlan(), squad)).toEqual([]);
    expect(isValidPlan(basePlan(), squad)).toBe(true);
  });

  it("acusa plano incompleto", () => {
    const plan = basePlan();
    plan.assignments = plan.assignments.slice(0, TEAM_SIZE - 1);
    expect(inspectPlan(plan, squad).map(({ kind }) => kind)).toContain("wrong-size");
  });

  it("acusa plano sem goleiro", () => {
    const plan = basePlan();
    plan.assignments = plan.assignments.filter((assignment) => assignment.slotId !== GOALKEEPER_SLOT_ID);
    expect(inspectPlan(plan, squad).map(({ kind }) => kind)).toContain("missing-goalkeeper");
  });

  it("acusa jogador repetido e slot repetido", () => {
    const plan = basePlan();
    plan.assignments[2] = { ...plan.assignments[2], playerId: plan.assignments[3].playerId };
    plan.assignments[4] = { ...plan.assignments[4], slotId: plan.assignments[5].slotId };

    const kinds = inspectPlan(plan, squad).map(({ kind }) => kind);
    expect(kinds).toContain("duplicate-player");
    expect(kinds).toContain("duplicate-slot");
  });

  it("acusa jogador fora do elenco", () => {
    const plan = basePlan();
    plan.assignments[1] = { ...plan.assignments[1], playerId: "forasteiro" };
    expect(inspectPlan(plan, squad).map(({ kind }) => kind)).toContain("unknown-player");
  });

  it("acusa goleiro escalado na linha", () => {
    const plan = basePlan();
    const goalkeeperId = plan.assignments.find(({ slotId }) => slotId === GOALKEEPER_SLOT_ID)!.playerId;
    const outfield = plan.assignments.find(({ slotId }) => slotId !== GOALKEEPER_SLOT_ID)!;
    const outfieldId = outfield.playerId;
    plan.assignments = plan.assignments.map((assignment) => {
      if (assignment.slotId === GOALKEEPER_SLOT_ID) return { ...assignment, playerId: outfieldId };
      if (assignment.slotId === outfield.slotId) return { ...assignment, playerId: goalkeeperId };
      return assignment;
    });

    expect(inspectPlan(plan, squad).filter(({ kind }) => kind === "blocked-position")).toHaveLength(2);
  });

  it("acusa reserva que também é titular", () => {
    const plan = basePlan();
    plan.bench = [plan.assignments[0].playerId];
    expect(inspectPlan(plan, squad).map(({ kind }) => kind)).toContain("bench-conflict");
  });

  it("reprova o plano vazio", () => {
    expect(isValidPlan(createEmptyPlan(), squad)).toBe(false);
  });
});

describe("consultas do plano", () => {
  it("ordena os titulares do gol ao ataque", () => {
    const ordered = orderedAssignments(basePlan());
    const columns = ordered.map(({ slotId }) => findSlot(slotId)!.zone.column);

    expect(ordered[0].slotId).toBe(GOALKEEPER_SLOT_ID);
    expect(columns).toEqual([...columns].sort((first, second) => first - second));
  });

  it("encontra o slot de um titular e ignora quem não joga", () => {
    const plan = basePlan();
    expect(slotOfPlayer(plan, plan.assignments[2].playerId)).toBe(plan.assignments[2].slotId);
    expect(slotOfPlayer(plan, "ninguem")).toBeNull();
  });
});

describe("autoPickPlan", () => {
  it("monta uma escalação válida a partir do elenco", () => {
    const plan = autoPickPlan(squad, defaultFormation());

    expect(plan.assignments).toHaveLength(TEAM_SIZE);
    expect(plan.formationId).toBe(defaultFormation().id);
    expect(inspectPlan(plan, squad)).toEqual([]);
  });

  it("põe um goleiro no gol mesmo com o elenco embaralhado", () => {
    const shuffled = [...squad].reverse();
    const plan = autoPickPlan(shuffled, defaultFormation());
    const goalkeeperId = plan.assignments.find(({ slotId }) => slotId === GOALKEEPER_SLOT_ID)!.playerId;

    expect(squad.find(({ id }) => id === goalkeeperId)!.position).toBe("goalkeeper");
  });

  it("prefere o especialista ao improviso quando a diferença de nota é pequena", () => {
    // Um 5-3-2 abre três vagas de zaga; o elenco tem três zagueiros. Antes de pesar o
    // encaixe ao quadrado, o terceiro zagueiro perdia a vaga para um meia mais bem
    // avaliado e o time entrava sem zaga de verdade.
    const plan = autoPickPlan(squad, findFormation("5-3-2")!);
    const byId = new Map(squad.map((player) => [player.id, player]));
    const centreBackSlots = ["zag-e", "zag", "zag-d"];
    const filled = plan.assignments
      .filter(({ slotId }) => centreBackSlots.includes(slotId))
      .map(({ playerId }) => byId.get(playerId)!.position);

    expect(filled).toHaveLength(3);
    expect(filled.filter((position) => position === "centerBack").length).toBeGreaterThanOrEqual(2);
  });

  it("escala cada posição natural do elenco em pelo menos um clube gerado", () => {
    const bigWorld = createTestWorld(4);
    for (const club of bigWorld.clubs) {
      const clubSquad = squadOf(bigWorld.players, bigWorld.contracts, club.id);
      const byId = new Map(clubSquad.map((player) => [player.id, player]));
      const positions = club.defaultPlan.assignments.map(({ playerId }) => byId.get(playerId)!.position);
      expect(positions.filter((position) => position === "goalkeeper")).toHaveLength(1);
      // Nenhum plano padrão pode entrar em campo sem defensor de ofício.
      expect(positions.some((position) => ["centerBack", "rightBack", "leftBack"].includes(position))).toBe(true);
    }
  });

  it("manda para o banco quem sobra do elenco", () => {
    const plan = autoPickPlan(squad, defaultFormation());
    expect(plan.bench).toHaveLength(squad.length - TEAM_SIZE);
    expect(plan.bench.some((playerId) => plan.assignments.some((assignment) => assignment.playerId === playerId))).toBe(false);
  });
});
