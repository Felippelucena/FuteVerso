import { generateCatalog, DEFAULT_CLUB_COUNT } from "../../content/generators/generate-catalog";
import type { World } from "../../domain/world/model";
import { repairWorld } from "../../domain/world/rules";
import type { WorldRepository } from "../ports/world-repository";

export interface BootstrapOptions {
  /** Semente do catálogo gerado no primeiro boot. */
  catalogSeed?: number;
  clubCount?: number;
  currentYear?: number;
}

const DEFAULT_CATALOG_SEED = 0x5eed_c10b;

/**
 * Carrega o mundo salvo ou gera um catálogo novo no primeiro boot, gravando-o em seguida.
 * É o único ponto que decide entre continuar e começar do zero, e roda antes de qualquer
 * tela aparecer.
 */
export const bootstrapWorld = async (
  repository: WorldRepository,
  options: BootstrapOptions = {},
): Promise<World> => {
  const existing = await repository.load().catch(() => null);
  if (existing) return repairWorld(existing);

  const world = generateCatalog({
    seed: options.catalogSeed ?? DEFAULT_CATALOG_SEED,
    currentYear: options.currentYear ?? new Date().getFullYear(),
    clubCount: options.clubCount ?? DEFAULT_CLUB_COUNT,
  });
  await repository.save(world).catch(() => undefined);
  return world;
};
