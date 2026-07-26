import { find, findAll, render } from "../app/dom";
import { html, type Html } from "../app/html";
import { icon } from "../app/icons";
import type { BindContext, EntityDescriptor, EntityTab } from "./entity";

const template = (descriptor: EntityDescriptor<unknown, unknown>): Html => html`
  <dialog class="entity-dialog">
    <form data-role="form" method="dialog">
      <div class="dialog-heading">
        <div><span class="eyebrow" data-role="eyebrow"></span><h2 data-role="title"></h2></div>
        <button class="icon-button" type="button" data-role="close" aria-label="Fechar" title="Fechar">${icon("X")}</button>
      </div>
      <nav class="dialog-tabs" role="tablist" aria-label="Seções">
        ${descriptor.tabs.map((tab, index) => html`<button type="button" role="tab"
          data-tab="${tab.id}" class="${index === 0 ? "is-active" : ""}"
          aria-selected="${index === 0 ? "true" : "false"}">${tab.label}</button>`)}
      </nav>
      <div class="dialog-panels" data-role="panels">
        ${descriptor.tabs.map((tab, index) => html`<section class="dialog-panel" role="tabpanel"
          data-panel="${tab.id}" ${index === 0 ? "" : html`hidden`}></section>`)}
      </div>
      <p class="dialog-message" data-role="message" aria-live="polite"></p>
      <div class="dialog-actions">
        <button type="button" class="secondary-button" data-role="cancel">Cancelar</button>
        <button type="submit" class="primary-button">${icon("Save")}Salvar</button>
      </div>
    </form>
  </dialog>`;

/**
 * Modal de criar/editar. Trabalha sobre um **rascunho** — uma cópia da entidade —, então as
 * abas editam à vontade e só o Salvar comita. Cancelar é gratuito, e com abas isso importa: o
 * usuário mexe em dados, elenco e tática antes de decidir.
 *
 * Todos os painéis são montados de uma vez e os inativos ficam escondidos. Trocar de aba não
 * pode custar o que já foi digitado, e reconstruir o painel a cada troca custaria.
 */
export class EntityModal<TRow, TDraft> {
  private readonly dialog: HTMLDialogElement;
  private readonly form: HTMLFormElement;
  private draft: TDraft | null = null;
  private creating = false;

  constructor(
    host: ParentNode,
    private readonly descriptor: EntityDescriptor<TRow, TDraft>,
    private readonly onSaved: () => void,
  ) {
    const holder = document.createElement("div");
    render(holder, template(descriptor as unknown as EntityDescriptor<unknown, unknown>));
    this.dialog = find<HTMLDialogElement>(holder, ".entity-dialog");
    host.append(this.dialog);
    this.form = this.at<HTMLFormElement>("form");

    for (const button of findAll<HTMLButtonElement>(this.dialog, "[data-tab]")) {
      button.addEventListener("click", () => this.activate(button.dataset.tab!));
    }
    this.at("close").addEventListener("click", () => this.dialog.close());
    this.at("cancel").addEventListener("click", () => this.dialog.close());
    this.form.addEventListener("submit", (event) => this.submit(event));

    for (const tab of descriptor.tabs) tab.bind?.(this.contextOf(tab));
  }

  private contextOf(tab: EntityTab<TDraft>): BindContext<TDraft> {
    return {
      panel: this.panelOf(tab),
      draft: () => this.draft as TDraft,
      refresh: () => this.refresh(tab),
    };
  }

  async open(id: string | null): Promise<void> {
    this.creating = id === null;
    this.draft = await this.descriptor.draft(id);
    this.at("eyebrow").textContent = this.descriptor.singular.toUpperCase();
    this.at("title").textContent = `${this.creating ? "Novo" : "Editar"} ${this.descriptor.singular.toLowerCase()}`;
    this.setMessage("");
    for (const tab of this.descriptor.tabs) {
      if (tab.render) render(this.panelOf(tab), tab.render(this.draft));
    }
    this.activate(this.descriptor.tabs[0].id);
    this.dialog.showModal();
  }

  private refresh(tab: EntityTab<TDraft>): void {
    if (!this.draft || !tab.render) return;
    const panel = this.panelOf(tab);
    // Recolhe antes de repintar: o que estava digitado neste painel morreria com a marcação.
    tab.collect?.({ panel, draft: this.draft, data: new FormData(this.form) });
    render(panel, tab.render(this.draft));
  }

  private activate(id: string): void {
    for (const button of findAll<HTMLButtonElement>(this.dialog, "[data-tab]")) {
      const active = button.dataset.tab === id;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", String(active));
    }
    for (const panel of findAll<HTMLElement>(this.dialog, "[data-panel]")) {
      panel.hidden = panel.dataset.panel !== id;
    }
    const active = this.descriptor.tabs.find((tab) => tab.id === id);
    if (active && this.draft) active.activate?.(this.contextOf(active));
  }

  private submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!this.draft) return;
    const data = new FormData(this.form);
    for (const tab of this.descriptor.tabs) {
      tab.collect?.({ panel: this.panelOf(tab), draft: this.draft, data });
    }
    void this.descriptor.save(this.draft).then((result) => {
      if (!result.ok) {
        this.setMessage(MESSAGES[result.reason], true);
        return;
      }
      this.dialog.close();
      this.onSaved();
    });
  }

  private setMessage(message: string, error = false): void {
    const element = this.at("message");
    element.textContent = message;
    element.classList.toggle("is-error", error);
  }

  private panelOf(tab: EntityTab<TDraft>): HTMLElement {
    return find<HTMLElement>(this.dialog, `[data-panel="${tab.id}"]`);
  }

  private at<T extends HTMLElement>(role: string): T {
    return find<T>(this.dialog, `[data-role="${role}"]`);
  }
}

const MESSAGES: Record<string, string> = {
  "invalid-player": "Revise os dados do jogador antes de salvar.",
  "invalid-club": "Revise os dados do clube: sigla com três letras e cores em hexadecimal.",
  "player-not-found": "O jogador não existe mais.",
  "club-not-found": "O clube não existe mais.",
  "invalid-plan": "Essa alteração deixaria um plano tático inválido.",
};
