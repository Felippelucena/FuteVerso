const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escape = (value: string): string => value.replace(/[&<>"']/g, (character) => ESCAPES[character]!);

/**
 * Marcação já pronta. O campo privado torna o tipo nominal: um objeto qualquer com a mesma
 * forma não é atribuível a `Html`, então string crua não atravessa nenhuma fronteira sem escapar.
 */
class Markup {
  constructor(private readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

export type Html = Markup;

export type HtmlValue = Html | string | number | boolean | null | undefined | readonly HtmlValue[];

const resolve = (value: HtmlValue): string => {
  if (value instanceof Markup) return value.toString();
  if (typeof value === "string") return escape(value);
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(resolve).join("");
  // Booleano, nulo, indefinido e qualquer impostor: some. Falhar renderizando nada é seguro.
  return "";
};

export const html = (strings: TemplateStringsArray, ...values: readonly HtmlValue[]): Html =>
  new Markup(strings.reduce((text, part, index) => text + resolve(values[index - 1]) + part));

export const markup = (value: Html): string => value.toString();
