import { contractsOfClub, squadOf } from "../../domain/contract/queries";
import { generateCatalog } from "../../content/generators/generate-catalog";
import type { World } from "../../domain/world/model";
import type { MatchContext, MatchSetup } from "../match/build-match-config";

export const TEST_CATALOG_SEED = 20260723;
export const TEST_CURRENT_YEAR = 2026;

/**
 * Mundo pequeno e determinístico para testes de aplicação e apresentação. Usa o gerador de
 * verdade, e não um catálogo escrito à mão, porque assim os testes também cobrem o caminho
 * que o jogo percorre no primeiro boot.
 */
export const createTestWorld = (clubCount = 2): World => generateCatalog({
  seed: TEST_CATALOG_SEED,
  currentYear: TEST_CURRENT_YEAR,
  clubCount,
  matchSeed: 2026,
});

const clone = <T>(value: T): T => structuredClone(value);

export const createTestSetup = (world: World): MatchSetup => ({
  blue: { clubId: world.clubs[0].id, plan: clone(world.clubs[0].defaultPlan) },
  coral: { clubId: world.clubs[1].id, plan: clone(world.clubs[1].defaultPlan) },
});

/**
 * Resolve um mundo e uma escolha de clubes no contexto que a partida consome. Fora dos testes
 * quem faz isso é a aplicação, lendo o catálogo; aqui o mundo inteiro já está à mão.
 */
export const createTestContext = (
  world: World,
  setup: MatchSetup = createTestSetup(world),
  overrides: Partial<Pick<MatchContext, "seed" | "learningEnabled">> = {},
): MatchContext => {
  const side = (clubId: string, plan: MatchSetup["blue"]["plan"]) => ({
    club: world.clubs.find(({ id }) => id === clubId)!,
    squad: squadOf(world.players, world.contracts, clubId),
    contracts: contractsOfClub(world.contracts, clubId),
    plan,
  });
  return {
    blue: side(setup.blue.clubId, setup.blue.plan),
    coral: side(setup.coral.clubId, setup.coral.plan),
    memories: clone(world.memories),
    seed: overrides.seed ?? world.settings.randomSeed,
    learningEnabled: overrides.learningEnabled ?? world.settings.learningEnabled,
  };
};
