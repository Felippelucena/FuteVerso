import { markup, type Html } from "./html";

export const find = <T extends Element>(scope: ParentNode, selector: string): T => {
  const element = scope.querySelector<T>(selector);
  if (!element) throw new Error(`Elemento ${selector} não encontrado.`);
  return element;
};

/** Único ponto do projeto que escreve innerHTML. Só aceita marcação vinda do `html`. */
export const render = (target: Element, content: Html): void => {
  target.innerHTML = markup(content);
};
