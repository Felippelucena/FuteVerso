/** Remove os diacríticos combinantes, preservando a letra base: "Ícaro" vira "Icaro". */
export const stripAccents = (value: string): string =>
  value.normalize("NFD").split("").filter((character) => {
    const code = character.charCodeAt(0);
    return code < 0x0300 || code > 0x036f;
  }).join("");

/**
 * Chave de ordenação de texto. O IndexedDB ordena índices por unidade de código, então "Ícaro"
 * viria depois de "Zé" — inaceitável numa lista de nomes em português. Guardar e comparar por
 * esta chave alinha a ordem do banco com a que o leitor espera, e sem depender de locale.
 */
export const sortKey = (value: string): string => stripAccents(value).toLowerCase();
