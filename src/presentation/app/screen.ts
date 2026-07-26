import type { Html } from "./html";
import type { IconName } from "./icons";

export interface Screen {
  /** Monta o conteúdo da tela. Chamado ao ativar, e pela própria tela após seus eventos. */
  render(): void;
  /** Repintura por quadro. Só telas com canvas implementam. */
  frame?(): void;
  /** Atualização no ritmo da interface. Só telas com conteúdo ao vivo implementam. */
  tick?(): void;
  resize?(): void;
}

export interface ScreenContext {
  readonly root: HTMLElement;
  readonly dialogs: ParentNode;
}

export interface ScreenDefinition {
  readonly id: string;
  readonly label: string;
  readonly icon: IconName;
  readonly template: () => Html;
  readonly dialogs?: () => Html;
  readonly mount: (context: ScreenContext) => Screen;
}
