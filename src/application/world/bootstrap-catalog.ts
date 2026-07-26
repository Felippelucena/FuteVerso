import { generateCatalog, DEFAULT_CLUB_COUNT } from "../../content/generators/generate-catalog";
import type { WorldSettings } from "../../domain/world/model";
import { repairWorld } from "../../domain/world/rules";
import type { Catalog } from "../ports/catalog";

export interface BootstrapOptions {
  /** Semente do catálogo gerado no primeiro boot. */
  catalogSeed?: number;
  clubCount?: number;
  currentYear?: number;
}

const DEFAULT_CATALOG_SEED = 0x5eed_c10b;

/**
 * Decide entre continuar e começar do zero, e roda antes de qualquer tela aparecer. Devolve só
 * as configurações: o catálogo fica no banco e é consultado sob demanda, porque um mundo
 * construído pelo usuário não cabe em memória por princípio.
 *
 * `repairWorld` continua valendo aqui — no mundo recém-gerado ou importado, que é onde uma
 * incoerência pode entrar de uma vez. Depois do boot, a integridade é mantida por edição.
 */
export const bootstrapCatalog = async (
  catalog: Catalog,
  options: BootstrapOptions = {},
): Promise<WorldSettings> => {
  const existing = await catalog.loadSettings().catch(() => null);
  if (existing) return existing;

  const world = repairWorld(generateCatalog({
    seed: options.catalogSeed ?? DEFAULT_CATALOG_SEED,
    currentYear: options.currentYear ?? new Date().getFullYear(),
    clubCount: options.clubCount ?? DEFAULT_CLUB_COUNT,
  }));
  await catalog.importWorld(world).catch(() => undefined);
  return world.settings;
};
