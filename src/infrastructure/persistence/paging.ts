import type { Page, PageQuery } from "../../application/ports/catalog";
import { sortKey } from "../../domain/shared/text";

export type FieldReader<T> = (entity: T, field: string) => string | number | undefined;

/** Campos de texto ordenados pela chave normalizada, e não pelo valor exibido. */
export const SORT_KEY_FIELDS = new Set(["name"]);

export const readField = <T>(entity: T, field: string): string | number | undefined => {
  const value = (entity as Record<string, unknown>)[field];
  if (typeof value === "number") return value;
  if (typeof value !== "string") return undefined;
  return SORT_KEY_FIELDS.has(field) ? sortKey(value) : value;
};

/**
 * Comparação por unidade de código, e não `localeCompare`: é a ordem que o índice do IndexedDB
 * impõe, e os dois adapters têm de concordar. O acento sai antes, na chave de ordenação.
 */
const compare = (first: string | number | undefined, second: string | number | undefined): number => {
  if (first === second) return 0;
  if (first === undefined) return -1;
  if (second === undefined) return 1;
  if (typeof first === "string" && typeof second === "string") return first < second ? -1 : 1;
  return Number(first) - Number(second);
};

/** O valor buscado passa pela mesma normalização do campo, senão "Sil" não acha "Silva". */
export const filterValue = (filter: NonNullable<PageQuery["filter"]>): string =>
  SORT_KEY_FIELDS.has(filter.field) ? sortKey(String(filter.value)) : String(filter.value);

export const matchesFilter = <T>(
  entity: T,
  filter: NonNullable<PageQuery["filter"]>,
  fieldOf: FieldReader<T>,
): boolean => {
  const value = String(fieldOf(entity, filter.field) ?? "");
  const wanted = filterValue(filter);
  return filter.match === "prefix" ? value.startsWith(wanted) : value === wanted;
};

/**
 * Semântica única de paginação, compartilhada pelos dois adapters: filtra, ordena e fatia.
 * O desempate pela chave primária não é detalhe — sem ele, dois registros de mesmo valor podem
 * trocar de lugar entre uma página e outra e o usuário vê um sumindo e outro repetido.
 *
 * O adapter de IndexedDB usa isto no caminho filtrado, e não um cursor sobre o índice do
 * filtro, para que filtrar e ordenar sejam independentes — o índice não cruza os dois. O
 * conjunto filtrado é pequeno por natureza (o elenco de um clube; um prefixo digitado), então
 * ordenar em memória custa menos que a alternativa de restringir a ordenação.
 */
export const pageFromArray = <T>(
  source: readonly T[],
  query: PageQuery,
  keyOf: (entity: T) => string,
  fieldOf: FieldReader<T>,
): Page<T> => {
  const rows = query.filter
    ? source.filter((entity) => matchesFilter(entity, query.filter!, fieldOf))
    : [...source];
  const sign = query.direction === "desc" ? -1 : 1;
  const field = query.sort;
  // Sem `sort`, a ordem é a da chave primária — a única que uma store garante de graça, e a que
  // o cursor do IndexedDB devolve. Deixar "sem ordem" significar ordem de inserção faria os dois
  // adapters discordarem. O desempate leva o mesmo sinal porque um cursor `prev` inverte também
  // a chave primária dentro de um mesmo valor de índice.
  rows.sort((first, second) => sign * (
    (field ? compare(fieldOf(first, field), fieldOf(second, field)) : 0)
    || (keyOf(first) < keyOf(second) ? -1 : keyOf(first) > keyOf(second) ? 1 : 0)));
  const offset = query.offset ?? 0;
  const limit = query.limit ?? rows.length;
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
};
