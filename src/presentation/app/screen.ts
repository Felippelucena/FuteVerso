import type { Html } from "./html";
import type { IconName } from "./icons";

/**
 * O que a faixa do topo mostra enquanto a tela está ativa. Quem decide é a definição da tela,
 * não o navegador — assim o navegador continua sem conhecer nenhuma tela pelo nome.
 */
export type Chrome = "match" | "trail";

export interface Route {
  readonly screenId: string;
  readonly params?: Readonly<Record<string, string>>;
}

/** O que uma tela pode pedir ao navegador. Deliberadamente pequeno. */
export interface Navigation {
  push(route: Route): void;
  /** Troca o topo da pilha: navegar entre abas irmãs não empilha um passo a mais. */
  replace(route: Route): void;
  back(): void;
  /** Esvazia a pilha e recomeça. É o caminho de volta ao menu. */
  reset(route: Route): void;
}

export interface Screen {
  /** Monta o conteúdo da tela. Chamado ao ativar, e pela própria tela após seus eventos. */
  render(): void;
  /** Repintura por quadro. Só telas com canvas implementam. */
  frame?(): void;
  /** Atualização no ritmo da interface. Só telas com conteúdo ao vivo implementam. */
  tick?(): void;
  resize?(): void;
  /** A tela saiu de cena. Quem tem processo vivo — a partida — o congela aqui. */
  suspend?(): void;
}

export interface ScreenContext {
  readonly root: HTMLElement;
  readonly dialogs: ParentNode;
  readonly params: Readonly<Record<string, string>>;
  readonly navigation: Navigation;
}

export interface ScreenDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  /** Padrão `trail`. Só a partida pede o placar no topo. */
  readonly chrome?: Chrome;
  readonly template: () => Html;
  readonly dialogs?: () => Html;
  readonly mount: (context: ScreenContext) => Screen;
}
