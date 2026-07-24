/// <reference types="vite/client" />
import type { CountryCode } from "../../domain/shared/model";

export interface ClubNameParts {
  cities: string[];
  prefixes: string[];
  suffixes: string[];
}

export interface NameCatalog {
  country: CountryCode;
  firstNames: string[];
  lastNames: string[];
  clubNames?: ClubNameParts;
}

// Rede de segurança: se a pasta ficar vazia ou todos os arquivos forem inválidos, o jogo
// continua gerando conteúdo em vez de quebrar na tela inicial.
const FALLBACK: NameCatalog = {
  country: "ZZ",
  firstNames: ["Alex", "Bruno", "Carlos", "Diego", "Elias", "Felipe", "Gabriel", "Hugo"],
  lastNames: ["Alves", "Barros", "Costa", "Dias", "Esteves", "Faria", "Gomes", "Henriques"],
  clubNames: {
    cities: ["Central", "Norte", "Sul", "Litoral"],
    prefixes: ["Atlético", "Esporte Clube", "União"],
    suffixes: ["FC", "EC"],
  },
};

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim().length > 0);

const parseCatalog = (path: string, value: unknown): NameCatalog | null => {
  if (!value || typeof value !== "object") return null;
  const candidate = value as NameCatalog;
  if (typeof candidate.country !== "string" || candidate.country.length !== 2) return null;
  if (!isStringList(candidate.firstNames) || !isStringList(candidate.lastNames)) return null;
  const parts = candidate.clubNames;
  const clubNames = parts && isStringList(parts.cities) && isStringList(parts.prefixes) && isStringList(parts.suffixes)
    ? { cities: [...parts.cities], prefixes: [...parts.prefixes], suffixes: [...parts.suffixes] }
    : undefined;
  // O nome do arquivo manda: evita dois arquivos declarando o mesmo país por engano.
  const fileCode = path.replace(/^.*\//, "").replace(/\.json$/, "").toUpperCase();
  if (fileCode !== candidate.country.toUpperCase()) return null;
  return {
    country: fileCode,
    firstNames: [...candidate.firstNames],
    lastNames: [...candidate.lastNames],
    clubNames,
  };
};

const loadCatalogs = (): Map<CountryCode, NameCatalog> => {
  const modules = import.meta.glob("./*.json", { eager: true, import: "default" }) as Record<string, unknown>;
  const catalogs = new Map<CountryCode, NameCatalog>();
  for (const path of Object.keys(modules).sort()) {
    const catalog = parseCatalog(path, modules[path]);
    if (!catalog) {
      console.warn(`[futeverso] lista de nomes ignorada por formato inválido: ${path}`);
      continue;
    }
    catalogs.set(catalog.country, catalog);
  }
  return catalogs;
};

const CATALOGS = loadCatalogs();

/** Países que têm lista própria, em ordem estável. */
export const countriesWithNames = (): CountryCode[] => [...CATALOGS.keys()].sort();

const merge = (catalogs: NameCatalog[]): NameCatalog => {
  if (catalogs.length === 0) return FALLBACK;
  const firstNames = new Set<string>();
  const lastNames = new Set<string>();
  const cities = new Set<string>();
  const prefixes = new Set<string>();
  const suffixes = new Set<string>();
  for (const catalog of catalogs) {
    for (const name of catalog.firstNames) firstNames.add(name);
    for (const name of catalog.lastNames) lastNames.add(name);
    for (const city of catalog.clubNames?.cities ?? []) cities.add(city);
    for (const prefix of catalog.clubNames?.prefixes ?? []) prefixes.add(prefix);
    for (const suffix of catalog.clubNames?.suffixes ?? []) suffixes.add(suffix);
  }
  return {
    country: "ZZ",
    firstNames: [...firstNames].sort(),
    lastNames: [...lastNames].sort(),
    clubNames: {
      cities: cities.size > 0 ? [...cities].sort() : FALLBACK.clubNames!.cities,
      prefixes: prefixes.size > 0 ? [...prefixes].sort() : FALLBACK.clubNames!.prefixes,
      suffixes: suffixes.size > 0 ? [...suffixes].sort() : FALLBACK.clubNames!.suffixes,
    },
  };
};

let mixedCatalog: NameCatalog | null = null;

/** União de todas as listas disponíveis, usada por países sem arquivo próprio. */
export const mixedNameCatalog = (): NameCatalog => {
  mixedCatalog ??= merge([...CATALOGS.values()]);
  return mixedCatalog;
};

/**
 * Lista de nomes de um país. Sem arquivo próprio, devolve a união das listas existentes —
 * o jogador mantém a nacionalidade escolhida e só toma emprestados os nomes.
 */
export const nameCatalogFor = (country: CountryCode): NameCatalog =>
  CATALOGS.get(country) ?? mixedNameCatalog();

export const hasOwnNames = (country: CountryCode): boolean => CATALOGS.has(country);

/** Partes de nome de clube, caindo para a união quando o país não define as suas. */
export const clubNamePartsFor = (country: CountryCode): ClubNameParts =>
  CATALOGS.get(country)?.clubNames ?? mixedNameCatalog().clubNames ?? FALLBACK.clubNames!;
