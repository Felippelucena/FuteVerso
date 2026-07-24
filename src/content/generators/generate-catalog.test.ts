import { describe, expect, it } from "vitest";
import { isValidClub } from "../../domain/club/rules";
import { contractsOfClub, squadOf } from "../../domain/contract/queries";
import { isValidContract } from "../../domain/contract/rules";
import { playerAge, isValidProfile } from "../../domain/roster/rules";
import { TEAM_SIZE } from "../../domain/tactics/model";
import { inspectPlan } from "../../domain/tactics/rules";
import { inspectWorld } from "../../domain/world/rules";
import { COUNTRIES } from "../countries";
import { generateCatalog } from "./generate-catalog";
import { SQUAD_SIZE } from "./generate-squad";

const CURRENT_YEAR = 2026;

const catalog = (seed = 99, clubCount = 4) => generateCatalog({ seed, currentYear: CURRENT_YEAR, clubCount });

describe("generateCatalog", () => {
  it("é determinístico: a mesma semente produz o mesmo mundo", () => {
    expect(catalog()).toEqual(catalog());
  });

  it("sementes diferentes produzem clubes diferentes", () => {
    expect(catalog(1).clubs.map(({ name }) => name)).not.toEqual(catalog(2).clubs.map(({ name }) => name));
  });

  it("gera clubes, contratos e jogadores válidos", () => {
    const world = catalog();

    expect(world.clubs).toHaveLength(4);
    expect(world.players).toHaveLength(4 * SQUAD_SIZE);
    expect(world.players.every(isValidProfile)).toBe(true);
    expect(world.clubs.every(isValidClub)).toBe(true);
    expect(world.contracts.every(isValidContract)).toBe(true);
    expect(inspectWorld(world)).toEqual([]);
  });

  it("dá a cada clube elenco suficiente e plano padrão jogável", () => {
    const world = catalog();
    for (const club of world.clubs) {
      const squad = squadOf(world.players, world.contracts, club.id);
      expect(squad.length).toBe(SQUAD_SIZE);
      expect(squad.filter((player) => player.position === "goalkeeper").length).toBeGreaterThanOrEqual(2);
      expect(club.defaultPlan.assignments).toHaveLength(TEAM_SIZE);
      expect(inspectPlan(club.defaultPlan, squad)).toEqual([]);
    }
  });

  it("não repete camisa dentro do clube nem nome de clube no catálogo", () => {
    const world = catalog(7, 8);
    expect(new Set(world.clubs.map(({ name }) => name)).size).toBe(8);
    expect(new Set(world.clubs.map(({ shortName }) => shortName)).size).toBe(8);
    for (const club of world.clubs) {
      const shirts = contractsOfClub(world.contracts, club.id).map(({ shirtNumber }) => shirtNumber);
      expect(new Set(shirts).size).toBe(shirts.length);
    }
  });

  it("espalha a reputação em vez de gerar clubes iguais", () => {
    const reputations = catalog(7, 8).clubs.map(({ reputation }) => reputation);
    expect(Math.max(...reputations) - Math.min(...reputations)).toBeGreaterThan(15);
  });

  it("dá idades plausíveis e nacionalidades conhecidas", () => {
    const world = catalog();
    const codes = new Set(COUNTRIES.map(({ code }) => code));
    for (const player of world.players) {
      const age = playerAge(player, CURRENT_YEAR);
      expect(age).toBeGreaterThanOrEqual(17);
      expect(age).toBeLessThanOrEqual(36);
      expect(codes).toContain(player.nationality);
    }
  });

  it("nomeia todo jogador mesmo quando o país não tem lista própria", () => {
    const world = catalog(7, 8);
    const foreign = world.players.filter((player) => player.nationality !== "BR");
    expect(foreign.length).toBeGreaterThan(0);
    expect(world.players.every((player) => player.name.trim().length > 0)).toBe(true);
  });

  it("guarda a semente do catálogo para reproduzir o mundo", () => {
    const world = catalog(1234);
    expect(world.settings.catalogSeed).toBe(1234);
    expect(world.settings.currentYear).toBe(CURRENT_YEAR);
  });
});
